import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { mockClient } from 'aws-sdk-client-mock';
import { CreateKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { AppConfig, loadConfig, VAULT_RELEASE_KEY_FUNCTION_NAME, VAULT_ROLE_NAMES, vaultDataBucketNames, vaultRecoveryBucketName } from '../lib/config';
import { VettidOrgVaultStack, vaultEnv } from '../lib/stacks/vault-stack';
import { VettidOrgMemberApiStack } from '../lib/stacks/member-api-stack';
import { checkPolicy, failedCheck, ManifestRelease } from '../lambda/shared/keypolicy';
import { vaultApiRoleName, VAULT_API_CONSUMERS } from '../lib/vault/access';
import { handler, parseProps, preflight, propsHash } from '../lambda/vault/release-key';
import { VAULT_DATA_VERSIONS, VAULT_RECOVERY_HOST_BUCKET_ACTIONS, VAULT_RECOVERY_HOST_OBJECT_ACTIONS, VAULT_RECOVERY_NONCURRENT_DAYS } from '../lib/stacks/vault-stack';

const pcr = (b: string) => b.repeat(48);
const P1 = pcr('a1');
const P2 = pcr('b2');
const P3 = pcr('c3');

function synth(stage: string, releaseKeys = [{ release: 3, pcr0: P3, admittedPcr0s: [P1, P2] }]) {
  const app = new cdk.App({ context: { stage } });
  const config = loadConfig(app.node);
  const stack = new VettidOrgVaultStack(app, 'VettidOrgVaultStack', { config, env: vaultEnv(config, config.vault!), terminationProtection: true, releaseKeys });
  return { config, stack, t: Template.fromStack(stack), json: Template.fromStack(stack).toJSON() };
}

const prod = synth('prod');
const resources = (json: any, type: string) => Object.entries<any>(json.Resources).filter(([, r]) => r.Type === type);
const statements = (json: any) => resources(json, 'AWS::IAM::Policy').flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
const str = (x: unknown) => JSON.stringify(x);

describe('VettidOrgVaultStack: accounts and channels', () => {
  test('prod deploys into the vault production account, staging into the staging account', () => {
    expect(prod.stack.account).toBe('369484479783');
    expect(prod.config.vault).toMatchObject({ channel: 'prod', apiAccount: '449757308783', retirementWindowDays: 30 });
    const staging = loadConfig(new cdk.App({ context: { stage: 'staging' } }).node);
    expect(staging.vault).toMatchObject({ channel: 'staging', account: '347272280361', apiAccount: '347272280361', retirementWindowDays: 7 });
  });

  // The whole staging stack set (W9) is checked in staging-stacks.test.ts.

  test('refuses any other account', () => {
    const app = new cdk.App();
    const config = loadConfig(app.node);
    expect(() => new VettidOrgVaultStack(app, 'X', { config, env: { account: '449757308783', region: 'us-east-1' } })).toThrow(/vault account 369484479783/);
  });
});

describe('VettidOrgVaultStack: the roles named in key policies (guardrail, VAULT-RELEASES §6.3)', () => {
  // If this test fails because a name changed: STOP. Every release key's
  // policy names these roles forever; a renamed or deleted role makes every
  // key fail the enclave's check 8 and (host role) every vault unopenable.
  test('fixed names, never changed', () => {
    expect(VAULT_ROLE_NAMES.host).toBe('vettid-org-vault-host');
    expect(VAULT_ROLE_NAMES.retirement).toBe('vettid-org-vault-key-retirement');
    expect(VAULT_ROLE_NAMES.releaseKeyCreator).toBe('vettid-org-vault-release-key-creator');
    expect(VAULT_RELEASE_KEY_FUNCTION_NAME).toBe('vettid-org-vault-release-key-creator');
    // No stage suffix: the staging channel file pins the same retirement role name.
    const staging = synth('staging', []);
    for (const s of [prod, staging]) {
      const names = resources(s.json, 'AWS::IAM::Role').map(([, r]) => r.Properties.RoleName);
      expect(names).toEqual(expect.arrayContaining(['vettid-org-vault-host', 'vettid-org-vault-key-retirement']));
    }
  });

  test('the host and retirement roles, the instance profile, signer role, tables, bucket and keys are retained', () => {
    const mustRetain = ['AWS::IAM::Role', 'AWS::IAM::InstanceProfile', 'AWS::DynamoDB::GlobalTable', 'AWS::S3::Bucket', 'AWS::KMS::Key', 'Custom::VettidReleaseKey'];
    for (const type of mustRetain) {
      const rs = resources(prod.json, type);
      expect(rs.length).toBeGreaterThan(0);
      for (const [id, r] of rs) {
        // The creator's role is replaceable (no key policy names it).
        if (type === 'AWS::IAM::Role' && r.Properties.RoleName === VAULT_ROLE_NAMES.releaseKeyCreator) continue;
        expect({ id, d: r.DeletionPolicy, u: r.UpdateReplacePolicy }).toEqual({ id, d: 'Retain', u: 'Retain' });
      }
    }
    const roleNames = resources(prod.json, 'AWS::IAM::Role').map(([, r]) => r.Properties.RoleName);
    expect(roleNames.every((n) => typeof n === 'string')).toBe(true); // every role here has a fixed name
  });

  test('the tables use DynamoDB\'s own key: the API account\'s roles can read them with no KMS permission', () => {
    // The account's AWS-managed aws/dynamodb key can't be used from another
    // account, so the production member API (API account) could not read
    // these tables at all.
    for (const stage of ['prod', 'staging']) {
      const tables = resources(stage === 'prod' ? prod.json : synth('staging').json, 'AWS::DynamoDB::GlobalTable');
      expect(tables).toHaveLength(4);
      for (const [id, r] of tables) {
        const sse = r.Properties.SSESpecification;
        expect({ id, kms: sse?.SSEType ?? null, enabled: sse?.SSEEnabled ?? false }).toEqual({ id, kms: null, enabled: false });
      }
    }
  });

  test('the host role holds no KMS permission (the key policies name it)', () => {
    const host = resources(prod.json, 'AWS::IAM::Role').find(([, r]) => r.Properties.RoleName === VAULT_ROLE_NAMES.host)![0];
    const hostStmts = resources(prod.json, 'AWS::IAM::Policy')
      .filter(([, p]) => str(p.Properties.Roles).includes(host))
      .flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
    expect(hostStmts.length).toBeGreaterThan(5);
    expect(str(hostStmts)).not.toContain('kms:');
  });

  test('nothing in the stack may change a key policy; only the creator may bypass the lockout check', () => {
    const all = str(statements(prod.json));
    expect(all).not.toContain('kms:PutKeyPolicy');
    const creates = statements(prod.json).filter((s: any) => str(s.Action).includes('kms:CreateKey'));
    expect(creates).toHaveLength(1);
    expect(creates[0].Condition.Bool).toEqual({ 'kms:BypassPolicyLockoutSafetyCheck': 'true', 'kms:MultiRegion': 'false' });
    expect(creates[0].Condition.StringEquals).toEqual({ 'kms:KeySpec': 'SYMMETRIC_DEFAULT', 'kms:KeyUsage': 'ENCRYPT_DECRYPT', 'kms:KeyOrigin': 'AWS_KMS' });
    prod.t.hasResourceProperties('AWS::Lambda::Function', { FunctionName: VAULT_RELEASE_KEY_FUNCTION_NAME });
    prod.t.hasResourceProperties('AWS::Lambda::EventInvokeConfig', { MaximumRetryAttempts: 0 });
  });

  test('the signer and retirement roles: only the owner (Identity Center permission set) may assume them', () => {
    for (const name of [VAULT_ROLE_NAMES.retirement, VAULT_ROLE_NAMES.manifestSigner]) {
      const [, role] = resources(prod.json, 'AWS::IAM::Role').find(([, r]) => r.Properties.RoleName === name)!;
      const trust = role.Properties.AssumeRolePolicyDocument.Statement;
      expect(trust).toHaveLength(1);
      expect(trust[0].Condition).toEqual({
        ArnLike: { 'aws:PrincipalArn': 'arn:aws:iam::369484479783:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_VettIDAdmin_*' },
      });
      expect(role.Properties.MaxSessionDuration).toBe(3600);
    }
  });
});

describe('VettidOrgVaultStack: release keys (VAULT-RELEASES §6.2)', () => {
  const keys = resources(prod.json, 'Custom::VettidReleaseKey');
  const props = keys[0][1].Properties;
  const releases: ManifestRelease[] = [
    { number: 1, pcr0: P1, sealKey: '' },
    { number: 2, pcr0: P2, sealKey: '' },
    { number: 3, pcr0: P3, sealKey: 'arn:aws:kms:us-east-1:369484479783:key/00000003-0000-4000-8000-000000000003' },
  ];
  const input = { keyArn: releases[2].sealKey, account: '369484479783', releases, retirementPrincipal: 'arn:aws:iam::369484479783:role/vettid-org-vault-key-retirement', retirementWindowDays: 30 };

  test('one immutable custom resource per release, ARN published to SSM', () => {
    expect(keys).toHaveLength(1);
    expect(props).toMatchObject({ Release: '3', Channel: 'prod', Account: '369484479783', Region: 'us-east-1', Pcr0: P3, AdmittedPcr0s: [P1, P2], RetirementWindowDays: '30' });
    prod.t.hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/prod/vault/releases/3/seal-key-arn' });
    // The roles the policy names exist before the key.
    expect(keys[0][1].DependsOn).toEqual(expect.arrayContaining([expect.stringMatching(/^HostRole/), expect.stringMatching(/^RetirementRole/)]));
  });

  test('the synthesized policy passes the enclave check (§11.10.7) for the release and its admitted releases', () => {
    expect(failedCheck(() => checkPolicy(props.Policy, input, releases[2]))).toBe(0);
    const policy = JSON.parse(props.Policy);
    expect(str(policy)).not.toMatch(/:root"|kms:\*|PutKeyPolicy|CreateGrant|DisableKey/);
    expect(policy.Statement.find((s: any) => s.Sid === 'RetireAfterNotice').Condition.NumericEquals).toEqual({ 'kms:ScheduleKeyDeletionPendingWindowInDays': '30' });
  });

  test('…but not for a manifest that lacks an admitted release, nor for another release', () => {
    expect(failedCheck(() => checkPolicy(props.Policy, { ...input, releases: [releases[1], releases[2]] }, releases[2]))).toBe(6);
    expect(failedCheck(() => checkPolicy(props.Policy, input, releases[1]))).toBe(6);
  });

  test('staging keys: the same shape with the 7-day window (deletable after use)', () => {
    const staging = synth('staging', [{ release: 1, pcr0: P1, admittedPcr0s: [] }]);
    const [[, key]] = resources(staging.json, 'Custom::VettidReleaseKey');
    expect(key.Properties).toMatchObject({ Channel: 'staging', Account: '347272280361', RetirementWindowDays: '7' });
    const sInput = { keyArn: 'arn:aws:kms:us-east-1:347272280361:key/00000001-0000-4000-8000-000000000001', account: '347272280361',
      releases: [{ number: 1, pcr0: P1, sealKey: '' }], retirementPrincipal: 'arn:aws:iam::347272280361:role/vettid-org-vault-key-retirement', retirementWindowDays: 7 };
    expect(failedCheck(() => checkPolicy(key.Properties.Policy, sInput, sInput.releases[0]))).toBe(0);
    // A production image (30 days) refuses a staging key.
    expect(failedCheck(() => checkPolicy(key.Properties.Policy, { ...sInput, retirementWindowDays: 30 }, sInput.releases[0]))).toBe(7);
  });

  test('the app holds no release key yet (W7 adds releases.json)', () => {
    const app = new cdk.App();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../lib/app').buildApp(app);
    const vault = app.node.findChild('VettidOrgVaultStack') as cdk.Stack;
    expect(resources(Template.fromStack(vault).toJSON(), 'Custom::VettidReleaseKey')).toHaveLength(0);
  });
});

describe('release-key custom resource handler', () => {
  const env = {
    account: '369484479783',
    region: 'us-east-1',
    hostRoleArn: 'arn:aws:iam::369484479783:role/vettid-org-vault-host',
    retirementRoleArn: 'arn:aws:iam::369484479783:role/vettid-org-vault-key-retirement',
  };
  const raw = resources(prod.json, 'Custom::VettidReleaseKey')[0][1].Properties;
  const cfnProps = { ...raw, ServiceToken: 'arn:aws:lambda:us-east-1:369484479783:function:vettid-org-vault-release-key-creator' };

  test('preflight accepts the synthesized properties', () => {
    expect(() => preflight(parseProps(cfnProps), env)).not.toThrow();
  });

  test.each<[string, Record<string, unknown>, RegExp]>([
    ['another account', { Account: '449757308783' }, /not this account/],
    ['the wrong window for the channel', { RetirementWindowDays: '7' }, /retirement window 30/],
    ['an unknown channel', { Channel: 'dev' }, /channel dev/],
    ['a policy with an admin statement', { Policy: raw.Policy.replace('"Statement": [', '"Statement": [{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::369484479783:root"},"Action":"kms:*","Resource":"*"},') }, /check 6/],
    ['a policy for another host role', { Policy: raw.Policy.split('vettid-org-vault-host').join('other-host') }, /host role/],
  ])('preflight refuses %s', (_n, over, re) => {
    expect(() => preflight(parseProps({ ...cfnProps, ...over }), env)).toThrow(re);
  });

  describe('lifecycle', () => {
    const kms = mockClient(KMSClient);
    const responses: any[] = [];
    const realFetch = global.fetch;
    beforeEach(() => {
      kms.reset();
      responses.length = 0;
      process.env.AWS_REGION = 'us-east-1';
      process.env.HOST_ROLE_ARN = env.hostRoleArn;
      process.env.RETIREMENT_ROLE_ARN = env.retirementRoleArn;
      global.fetch = (async (_url: string, init: { body: string }) => {
        responses.push(JSON.parse(init.body));
        return { ok: true, status: 200 };
      }) as unknown as typeof fetch;
    });
    afterAll(() => {
      global.fetch = realFetch;
    });
    const ctx = { invokedFunctionArn: 'arn:aws:lambda:us-east-1:369484479783:function:vettid-org-vault-release-key-creator' };
    const event = (type: string, extra: Record<string, unknown> = {}) =>
      ({ RequestType: type, ResponseURL: 'https://cfn.example/r', StackId: 's', RequestId: 'r1', LogicalResourceId: 'K', ResourceProperties: cfnProps, ...extra }) as any;
    const arn = 'arn:aws:kms:us-east-1:369484479783:key/11111111-2222-4333-8444-555555555555';

    test('create: CreateKey with exactly the policy and the lockout bypass, tags, no alias', async () => {
      kms.on(CreateKeyCommand).resolves({ KeyMetadata: { Arn: arn, KeyId: '11111111-2222-4333-8444-555555555555', AWSAccountId: '369484479783' } });
      await handler(event('Create'), ctx);
      const call = kms.commandCalls(CreateKeyCommand)[0].args[0].input;
      expect(call).toEqual({
        Policy: raw.Policy,
        BypassPolicyLockoutSafetyCheck: true,
        KeySpec: 'SYMMETRIC_DEFAULT',
        KeyUsage: 'ENCRYPT_DECRYPT',
        Origin: 'AWS_KMS',
        MultiRegion: false,
        Description: raw.Description,
        Tags: [{ TagKey: 'vettid:release', TagValue: '3' }, { TagKey: 'vettid:channel', TagValue: 'prod' }],
      });
      expect(responses[0]).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: `${arn}|${propsHash(cfnProps)}`, Data: { KeyArn: arn } });
    });

    test('create: a refused policy never reaches KMS', async () => {
      await handler(event('Create', { ResourceProperties: { ...cfnProps, RetirementWindowDays: '7' } }), ctx);
      expect(kms.commandCalls(CreateKeyCommand)).toHaveLength(0);
      expect(responses[0].Status).toBe('FAILED');
    });

    test('create: a KMS error is reported, never thrown (no async retry creates a second key)', async () => {
      kms.on(CreateKeyCommand).rejects(new Error('AccessDenied'));
      await expect(handler(event('Create'), ctx)).resolves.toBeUndefined();
      expect(responses[0]).toMatchObject({ Status: 'FAILED', Reason: 'AccessDenied' });
    });

    test('update: any property change fails; the same properties (a rollback, or a new service token) succeed', async () => {
      const physical = `${arn}|${propsHash(cfnProps)}`;
      await handler(event('Update', { PhysicalResourceId: physical, ResourceProperties: { ...cfnProps, Pcr0: P2 } }), ctx);
      expect(responses[0]).toMatchObject({ Status: 'FAILED', PhysicalResourceId: physical });
      expect(responses[0].Reason).toMatch(/immutable/);
      await handler(event('Update', { PhysicalResourceId: physical, ResourceProperties: { ...cfnProps, ServiceToken: 'arn:aws:lambda:us-east-1:369484479783:function:other' } }), ctx);
      expect(responses[1]).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: physical, Data: { KeyArn: arn } });
      expect(kms.calls()).toHaveLength(0);
    });

    test('delete: nothing is called; the key outlives the stack', async () => {
      await handler(event('Delete', { PhysicalResourceId: `${arn}|x` }), ctx);
      expect(kms.calls()).toHaveLength(0);
      expect(responses[0]).toMatchObject({ Status: 'SUCCESS', PhysicalResourceId: `${arn}|x` });
    });
  });
});

describe('VettidOrgVaultStack: data bucket and manifest key', () => {
  test('versioned, SSE, public access blocked, TLS only; old versions: all for a day, then the 5 newest, none past 7 days', () => {
    prod.t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'vettid-org-vault-data-369484479783',
      VersioningConfiguration: { Status: 'Enabled' },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
    // Exact, on both channels: the 7-day rule is unchanged (it is what
    // removes a deleted vault's last versions and its delete marker), the
    // cap is a second rule, and neither has a prefix or a tag filter.
    for (const s of [prod, synth('staging', [])]) {
      const [, bucket] = resources(s.json, 'AWS::S3::Bucket').find(([, b]) => b.Properties.BucketName.includes('vault-data'))!;
      expect(bucket.Properties.LifecycleConfiguration).toEqual({
        Rules: [
          { NoncurrentVersionExpiration: { NoncurrentDays: 7 }, ExpiredObjectDeleteMarker: true, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }, Status: 'Enabled' },
          { Id: 'KeepNewestNoncurrentVersions', NoncurrentVersionExpiration: { NoncurrentDays: 1, NewerNoncurrentVersions: 5 }, Status: 'Enabled' },
        ],
      });
      expect(bucket.DeletionPolicy).toBe('Retain');
      expect(bucket.UpdateReplacePolicy).toBe('Retain');
    }
    expect(VAULT_DATA_VERSIONS).toEqual({ keepAllDays: 1, keepNewest: 5, maxDays: 7 });
  });

  test('vault data is denied to every principal but the host role; manifests are written by the signer only', () => {
    const [, policy] = resources(prod.json, 'AWS::S3::BucketPolicy').find(([, p]) => str(p.Properties.Bucket).includes('DataBucket'))!;
    const st = policy.Properties.PolicyDocument.Statement;
    expect(st.some((s: any) => s.Effect === 'Deny' && str(s.Condition).includes('aws:SecureTransport'))).toBe(true);
    const data = st.find((s: any) => s.Sid === 'VaultDataHostOnly');
    expect(data).toMatchObject({ Effect: 'Deny', Principal: { AWS: '*' }, Action: 's3:*Object*', Condition: { ArnNotEquals: { 'aws:PrincipalArn': 'arn:aws:iam::369484479783:role/vettid-org-vault-host' } } });
    expect(str(data.Resource)).toMatch(/vaults\/\*.*users\/\*.*smoke\/\*/);
    expect(st.find((s: any) => s.Sid === 'ManifestsWrittenBySignerOnly').Condition).toEqual({ ArnNotEquals: { 'aws:PrincipalArn': 'arn:aws:iam::369484479783:role/vettid-org-vault-manifest-signer' } });
  });

  test('manifest key A: P-256 signing key, kms:Sign only for the signer role', () => {
    const [[, key]] = resources(prod.json, 'AWS::KMS::Key');
    expect(key.Properties).toMatchObject({ KeySpec: 'ECC_NIST_P256', KeyUsage: 'SIGN_VERIFY' });
    const st = key.Properties.KeyPolicy.Statement;
    const signers = st.filter((s: any) => str(s.Action).includes('kms:Sign') || str(s.Action) === '"kms:*"');
    expect(signers).toHaveLength(1);
    expect(signers[0].Principal).toEqual({ AWS: 'arn:aws:iam::369484479783:role/vettid-org-vault-manifest-signer' });
    prod.t.hasResourceProperties('AWS::KMS::Alias', { AliasName: 'alias/vettid-org-vault-manifest' });
  });
});

describe('VettidOrgVaultStack: recovery attempt counter bucket (release R, VAULT-HOST-PROTOCOL §8.1, VAULT-RELEASES §8.2)', () => {
  const staging = synth('staging', []);
  const counterOf = (json: any) => resources(json, 'AWS::S3::Bucket').find(([, b]) => String(b.Properties.BucketName).includes('vault-recovery'))!;
  const hostStatements = (json: any) => {
    const role = resources(json, 'AWS::IAM::Role').find(([, r]) => r.Properties.RoleName === VAULT_ROLE_NAMES.host)![0];
    return resources(json, 'AWS::IAM::Policy').filter(([, p]) => str(p.Properties.Roles).includes(role)).flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
  };
  const touchesCounter = (st: any, id: string) => str(st.Resource).includes(id) || [].concat(st.Resource).includes('*' as never);

  // The vault release pins exactly these (vettid-vault
  // enclave/releasecfg/<channel>.json `recovery_counter`); the release build
  // refuses another prefix or another channel's account.
  test('one per channel, named vettid-org-vault-recovery-<vault account> (no stage), as the release pins it', () => {
    expect(vaultRecoveryBucketName('369484479783')).toBe('vettid-org-vault-recovery-369484479783');
    expect(counterOf(prod.json)[1].Properties.BucketName).toBe('vettid-org-vault-recovery-369484479783');
    expect(counterOf(staging.json)[1].Properties.BucketName).toBe('vettid-org-vault-recovery-347272280361');
    expect(resources(prod.json, 'AWS::S3::Bucket')).toHaveLength(2);
    prod.t.hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/prod/vault/recovery-bucket-name' });
  });

  test('Object Lock enabled at creation with NO default retention; versioned; SSE-S3; public access blocked; owner-enforced; retained', () => {
    for (const s of [prod, staging]) {
      const [, b] = counterOf(s.json);
      expect(b.Properties.ObjectLockEnabled).toBe(true);
      // No ObjectLockConfiguration, so no `Rule`: a default retention would
      // lock objects the enclave did not mean to lock; the enclave sets and
      // reads back every lock itself.
      expect(b.Properties.ObjectLockConfiguration).toBeUndefined();
      expect(str(b.Properties)).not.toMatch(/DefaultRetention|"Mode"|LegalHold/);
      expect(b.Properties.VersioningConfiguration).toEqual({ Status: 'Enabled' });
      expect(b.Properties.BucketEncryption).toEqual({ ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] });
      expect(b.Properties.PublicAccessBlockConfiguration).toEqual({ BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true });
      expect(b.Properties.OwnershipControls).toEqual({ Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] });
      expect({ d: b.DeletionPolicy, u: b.UpdateReplacePolicy }).toEqual({ d: 'Retain', u: 'Retain' });
      // No replication, notification, website, inventory or logging target.
      expect(Object.keys(b.Properties).sort()).toEqual([
        'BucketEncryption', 'BucketName', 'LifecycleConfiguration', 'ObjectLockEnabled', 'OwnershipControls',
        'PublicAccessBlockConfiguration', 'Tags', 'VersioningConfiguration',
      ].filter((k) => k !== 'Tags' || 'Tags' in b.Properties));
    }
  });

  test('no lifecycle rule expires a current version (so never a vault\'s newest present record) or a delete marker', () => {
    for (const s of [prod, staging]) {
      const rules = counterOf(s.json)[1].Properties.LifecycleConfiguration.Rules;
      expect(rules).toEqual([
        { Id: 'OldVersionsOfUnlockedRecords', NoncurrentVersionExpiration: { NoncurrentDays: 30 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }, Status: 'Enabled' },
      ]);
      for (const r of rules) {
        expect(r.ExpirationInDays).toBeUndefined();
        expect(r.ExpirationDate).toBeUndefined();
        expect(r.ExpiredObjectDeleteMarker).toBeUndefined();
        expect(r.Transitions ?? r.NoncurrentVersionTransitions).toBeUndefined();
        // Longer than the 96-hour lock of a present record; S3 never removes a locked version anyway.
        expect(r.NoncurrentVersionExpiration.NoncurrentDays).toBeGreaterThan(4);
      }
    }
    expect(VAULT_RECOVERY_NONCURRENT_DAYS).toBe(30);
  });

  test('bucket policy: TLS only, and nothing that allows anyone anything', () => {
    const [id] = counterOf(prod.json);
    const [, policy] = resources(prod.json, 'AWS::S3::BucketPolicy').find(([, p]) => str(p.Properties.Bucket).includes(id))!;
    const st = policy.Properties.PolicyDocument.Statement;
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ Effect: 'Deny', Principal: { AWS: '*' }, Action: 's3:*', Condition: { Bool: { 'aws:SecureTransport': 'false' } } });
  });

  test('the host role: exactly the five calls of §8.1, on that bucket only', () => {
    for (const s of [prod, staging]) {
      const [id] = counterOf(s.json);
      const st = hostStatements(s.json).filter((x: any) => str(x.Resource).includes(id));
      expect(st.map((x: any) => [x.Action, x.Resource])).toEqual([
        [['s3:PutObject', 's3:PutObjectRetention', 's3:GetObjectVersion', 's3:GetObjectRetention'], { 'Fn::Join': ['', [{ 'Fn::GetAtt': [id, 'Arn'] }, '/*']] }],
        ['s3:ListBucketVersions', { 'Fn::GetAtt': [id, 'Arn'] }],
      ]);
      for (const x of st) expect(x.Condition).toBeUndefined();
    }
    expect([...VAULT_RECOVERY_HOST_OBJECT_ACTIONS, ...VAULT_RECOVERY_HOST_BUCKET_ACTIONS]).toHaveLength(5);
  });

  // P18 (VAULT-HOST-PROTOCOL §12): the instance role MUST NOT hold a delete,
  // bypass-governance, legal-hold or bucket-configuration permission on the
  // counter bucket. Checked over every statement of the role (its inline
  // policies; the one managed policy, AmazonSSMManagedInstanceCore, has no
  // S3 action at all) and over every policy in the stack.
  test('P18: no role in the stack may delete, bypass, hold or reconfigure on the counter bucket', () => {
    const forbidden = [
      /^s3:\*$/, /^s3:Delete/i, /^s3:Bypass/i, /LegalHold/i, /^s3:PutBucket/i, /^s3:PutLifecycle/i, /^s3:PutObjectLockConfiguration$/i,
      /^s3:PutEncryption/i, /^s3:PutReplication/i, /^s3:PutAccelerate/i, /^s3:PutIntelligent/i, /^s3:PutInventory/i, /^s3:PutAnalytics/i, /^s3:PutMetrics/i,
      /^s3:CreateAccessPoint/i, /^s3:PutAccessPoint/i, /^s3:RestoreObject/i, /^s3:ReplicateDelete/i, /^s3:ObjectOwnerOverrideToBucketOwner/i, /^s3:PutObjectAcl/i, /^s3:PutBucketAcl/i,
    ];
    const isForbidden = (a: string) => forbidden.some((re) => re.test(a)) || a === '*';
    expect(isForbidden('s3:DeleteObjectVersion') && isForbidden('s3:BypassGovernanceRetention') && isForbidden('s3:PutObjectLegalHold')).toBe(true);
    expect(isForbidden('s3:PutBucketObjectLockConfiguration') && isForbidden('s3:PutLifecycleConfiguration') && isForbidden('s3:PutBucketPolicy')).toBe(true);
    for (const s of [prod, staging]) {
      const [id] = counterOf(s.json);
      for (const st of hostStatements(s.json)) {
        const actions: string[] = [].concat(st.Action ?? st.NotAction);
        if (st.NotAction) expect(st.Effect).toBe('Deny');
        if (st.Effect !== 'Allow') continue;
        // An allow that reaches the counter bucket (by name or by "*") holds none of them.
        if (touchesCounter(st, id)) for (const a of actions) expect({ a, forbidden: isForbidden(a) }).toEqual({ a, forbidden: false });
        // No S3 wildcard and no S3 grant on "*" anywhere on the role.
        for (const a of actions) if (a.startsWith('s3:')) expect({ a, resource: st.Resource }).not.toEqual({ a, resource: '*' });
      }
      for (const st of statements(s.json)) {
        if (st.Effect !== 'Allow' || !touchesCounter(st, id)) continue;
        for (const a of [].concat(st.Action) as string[]) expect({ a, forbidden: isForbidden(a) }).toEqual({ a, forbidden: false });
      }
      // The managed policy the role carries is the SSM agent's only.
      const [, role] = resources(s.json, 'AWS::IAM::Role').find(([, r]) => r.Properties.RoleName === VAULT_ROLE_NAMES.host)!;
      expect(str(role.Properties.ManagedPolicyArns)).toMatch(/AmazonSSMManagedInstanceCore/);
      expect(role.Properties.ManagedPolicyArns).toHaveLength(1);
      expect(role.Properties.Policies).toBeUndefined();
    }
  });

  test('release R: the request table admits the attempts sweep (Scan) and no other member API role to Scan', () => {
    const reqs = resources(prod.json, 'AWS::DynamoDB::GlobalTable').find(([, t]) => t.Properties.TableName === 'vettid-org-vault-requests')![1];
    const st = reqs.Properties.Replicas[0].ResourcePolicy.PolicyDocument.Statement;
    const scans = st.filter((x: any) => str(x.Action).includes('dynamodb:Scan'));
    expect(scans.map((x: any) => x.Condition.ArnEquals['aws:PrincipalArn'])).toEqual(['arn:aws:iam::449757308783:role/vettid-org-member-vault-attempts']);
    const vaults = resources(prod.json, 'AWS::DynamoDB::GlobalTable').find(([, t]) => t.Properties.TableName === 'vettid-org-vaults')![1];
    const w = vaults.Properties.Replicas[0].ResourcePolicy.PolicyDocument.Statement.filter((x: any) => str(x.Condition).includes('member-vault-attempts"') && str(x.Action).includes('UpdateItem'));
    expect(w.map((x: any) => x.Condition['ForAllValues:StringEquals']['dynamodb:Attributes'])).toEqual([['vault_id', 'recovery', 'updated_at']]);
  });

  test('release R slot members and app_key_next: the host may write them, on those tables only', () => {
    const slotWrites = hostStatements(prod.json).filter((x: any) => x.Action === 'dynamodb:UpdateItem' && str(x.Resource).includes('Tablevaultrequests'));
    expect(slotWrites).toHaveLength(1);
    expect(slotWrites[0].Condition['ForAllValues:StringEquals']['dynamodb:Attributes']).toEqual(
      ['request_id', 'status', 'envelope', 'code', 'not_before', 'expires', 'earliest', 'retry_at', 'reason'],
    );
    // The member API never writes app_key_next (only the host does; the API reads it).
    const vaults = resources(prod.json, 'AWS::DynamoDB::GlobalTable').find(([, t]) => t.Properties.TableName === 'vettid-org-vaults')![1];
    expect(str(vaults.Properties.Replicas[0].ResourcePolicy.PolicyDocument)).not.toContain('app_key_next');
  });
});

describe('cross-account access (VAULT-RELEASES §8.1)', () => {
  const app = new cdk.App();
  const config: AppConfig = loadConfig(app.node);
  const api = Template.fromStack(new VettidOrgMemberApiStack(app, 'MemberApi', { config, env: { account: '449757308783', region: 'us-east-1' } })).toJSON();

  test('the four vault tables live in the vault account, deletion-protected, with the member API grants in their resource policies', () => {
    const tables = resources(prod.json, 'AWS::DynamoDB::GlobalTable');
    expect(tables.map(([, t]) => t.Properties.TableName).sort()).toEqual(['vettid-org-vault-instances', 'vettid-org-vault-releases', 'vettid-org-vault-requests', 'vettid-org-vaults']);
    for (const [, t] of tables) {
      const replica = t.Properties.Replicas[0];
      expect(replica.DeletionProtectionEnabled).toBe(true);
      for (const s of replica.ResourcePolicy?.PolicyDocument.Statement ?? []) {
        expect(s.Principal).toEqual({ AWS: 'arn:aws:iam::449757308783:root' });
        expect(s.Condition.ArnEquals['aws:PrincipalArn']).toMatch(/^arn:aws:iam::449757308783:role\/vettid-org-member-(vault|cleanup|vault-alarms|vault-notices|account-push|vault-names|member-vaults|vault-attempts)$/);
        expect(str(s.Action)).not.toMatch(/dynamodb:\*|BatchWrite|DeleteTable|UpdateTable/);
      }
    }
    // The instance registry is read-only to the API; nobody across accounts writes a lease.
    const instances = tables.find(([, t]) => t.Properties.TableName === 'vettid-org-vault-instances')![1];
    expect(str(instances.Properties.Replicas[0].ResourcePolicy.PolicyDocument)).not.toMatch(/PutItem|UpdateItem|DeleteItem/);
    for (const [, t] of tables) expect(str(t.Properties.Replicas[0].ResourcePolicy ?? {})).not.toMatch(/"lease"|"sealed_release"/);
  });

  test('the vaults stream admits the alarm mailer and (2.2.0) the vault-names job only', () => {
    const vaults = resources(prod.json, 'AWS::DynamoDB::GlobalTable').find(([, t]) => t.Properties.TableName === 'vettid-org-vaults')![1];
    const st = vaults.Properties.Replicas[0].ReplicaStreamSpecification.ResourcePolicy.PolicyDocument.Statement;
    expect(st.map((s: any) => s.Condition)).toEqual([
      { ArnEquals: { 'aws:PrincipalArn': 'arn:aws:iam::449757308783:role/vettid-org-member-vault-alarms' } },
      { ArnEquals: { 'aws:PrincipalArn': 'arn:aws:iam::449757308783:role/vettid-org-member-vault-names' } },
    ]);
  });

  test('2.2.0: only the host writes name_change; the vault-names job only clears the flag and writes the result', () => {
    const vaults = resources(prod.json, 'AWS::DynamoDB::GlobalTable').find(([, t]) => t.Properties.TableName === 'vettid-org-vaults')![1];
    const writes = vaults.Properties.Replicas[0].ResourcePolicy.PolicyDocument.Statement.filter((s: any) => str(s.Action).match(/PutItem|UpdateItem/));
    const attrsOf = (role: string) => writes.filter((s: any) => str(s.Condition).includes(role)).flatMap((s: any) => s.Condition['ForAllValues:StringEquals']?.['dynamodb:Attributes'] ?? []);
    expect(attrsOf('member-vault-names"')).toEqual(['vault_id', 'name_change', 'name_change_pending', 'name_change_result']);
    for (const role of ['member-vault"', 'member-cleanup"', 'member-vault-alarms"', 'member-account-push"']) expect(attrsOf(role)).not.toEqual(expect.arrayContaining(['name_change']));
    const reads = vaults.Properties.Replicas[0].ResourcePolicy.PolicyDocument.Statement.filter((s: any) => str(s.Condition).includes('member-vault-names"') && !str(s.Action).match(/PutItem|UpdateItem/));
    expect(reads.map((s: any) => s.Action)).toEqual(['dynamodb:GetItem']);
  });

  test('the member API roles the resource policies name exist with exactly those names', () => {
    const names = resources(api, 'AWS::IAM::Role').map(([, r]) => r.Properties.RoleName).filter(Boolean).sort();
    expect(names).toEqual(VAULT_API_CONSUMERS.map((c) => vaultApiRoleName(config, c)).sort());
  });

  test('the member API addresses vault tables and queues in the vault account', () => {
    const fns = resources(api, 'AWS::Lambda::Function').map(([, f]) => f.Properties.Environment.Variables);
    for (const v of fns) expect(v.TABLE_VAULTS).toBe('arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vaults');
    const withQueues = fns.filter((v) => v.VAULT_QUEUE_URL_PREFIX);
    expect(withQueues).toHaveLength(3); // the vault routes, the cleanup job and the account push (MEMBER-API 2.0.0)
    for (const v of withQueues) expect(v.VAULT_QUEUE_URL_PREFIX).toBe('https://sqs.us-east-1.amazonaws.com/369484479783/vettid-org-vault-control-');
    const vaultStmts = statements(api).filter((s: any) => str(s.Resource).includes('vettid-org-vault'));
    for (const s of vaultStmts) expect(str(s.Resource)).toContain(':369484479783:');
  });

  test('the release notice job (W8) reads the release rows and the sealed-release index only, on both sides', () => {
    const vaultsArn = 'arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vaults';
    const role = resources(api, 'AWS::IAM::Role').find(([, r]) => r.Properties.RoleName === 'vettid-org-member-vault-notices')![0];
    const pol = resources(api, 'AWS::IAM::Policy').filter(([, p]) => str(p.Properties.Roles).includes(role)).flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
    const vaultStmts = pol.filter((s: any) => str(s.Resource).includes(':369484479783:'));
    expect(vaultStmts.map((s: any) => [s.Action, s.Resource])).toEqual([
      ['dynamodb:Query', ['arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vault-releases', 'arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vault-releases/index/*']],
      ['dynamodb:Query', `${vaultsArn}/index/sealed-release-index`],
    ]);
    expect(str(pol)).toContain('ses:SendEmail');
    const vaults = resources(prod.json, 'AWS::DynamoDB::GlobalTable').find(([, t]) => t.Properties.TableName === 'vettid-org-vaults')![1];
    const st = vaults.Properties.Replicas[0].ResourcePolicy.PolicyDocument.Statement.filter((s: any) => str(s.Condition).includes('vault-notices'));
    expect(st).toEqual([expect.objectContaining({ Action: 'dynamodb:Query', Resource: `${vaultsArn}/index/sealed-release-index` })]);
    const rule = resources(api, 'AWS::Events::Rule').find(([, r]) => r.Properties.ScheduleExpression === 'cron(0 15 * * ? *)');
    expect(rule).toBeDefined();
    const fn = resources(api, 'AWS::Lambda::Function').find(([, f]) => f.Properties.Environment.Variables.RELEASE_LOG_URL)![1];
    expect(fn.Properties.Environment.Variables.RELEASE_LOG_URL).toBe('https://vettid.org/security/releases/');
  });

  test('app keys (MEMBER-API 2.0.0): only the enclave host writes app_key; the API only its pending key and the setup-code pointer', () => {
    const vaults = resources(prod.json, 'AWS::DynamoDB::GlobalTable').find(([, t]) => t.Properties.TableName === 'vettid-org-vaults')![1];
    const writes = vaults.Properties.Replicas[0].ResourcePolicy.PolicyDocument.Statement.filter((s: any) => str(s.Action).match(/PutItem|UpdateItem/));
    const attrs = writes.flatMap((s: any) => s.Condition['ForAllValues:StringEquals']?.['dynamodb:Attributes'] ?? []);
    expect(attrs).toEqual(expect.arrayContaining(['app_key_pending', 'enroll_live']));
    expect(attrs).not.toContain('app_key');
    const hostVaultWrites = statements(prod.json).filter((s: any) => s.Action === 'dynamodb:UpdateItem' && (s.Condition?.['ForAllValues:StringEquals']?.['dynamodb:Attributes'] ?? []).includes('lease'));
    expect(hostVaultWrites).toHaveLength(1);
    expect(hostVaultWrites[0].Condition['ForAllValues:StringEquals']['dynamodb:Attributes']).toEqual(
      ['vault_id', 'lease', 'updated_at', 'sealed_release', 'vault_version', 'state_version', 'state', 'alarm', 'alarm_pending', 'app_key', 'credential_backup', 'name_change', 'name_change_pending', 'att_sweep_pending', 'app_key_next'],
    );
  });

  describe('P15, the attachment sweep (VAULT-HOST-PROTOCOL 0.1.11, release A)', () => {
    const vaultsArn = { 'Fn::GetAtt': [expect.stringMatching(/^Tablevaults/), 'Arn'] };
    const hostPolicy = () => {
      const role = resources(prod.json, 'AWS::IAM::Role').find(([, r]) => r.Properties.RoleName === VAULT_ROLE_NAMES.host)![0];
      return resources(prod.json, 'AWS::IAM::Policy').filter(([, p]) => str(p.Properties.Roles).includes(role)).flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
    };

    test('the host may Scan the vaults table only for vault_id and att_sweep_pending, and no other table', () => {
      const scans = hostPolicy().filter((s: any) => [].concat(s.Action).some((a: string) => a === 'dynamodb:Scan' || a === 'dynamodb:*'));
      expect(scans).toEqual([
        {
          Effect: 'Allow',
          Action: 'dynamodb:Scan',
          Resource: vaultsArn,
          Condition: {
            'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['vault_id', 'att_sweep_pending'] },
            StringEqualsIfExists: { 'dynamodb:Select': 'SPECIFIC_ATTRIBUTES' },
            // A Scan naming no attributes carries no dynamodb:Attributes key
            // (ForAllValues would pass on the empty set): it must be refused.
            Null: { 'dynamodb:Attributes': 'false' },
          },
        },
      ]);
      expect(hostPolicy().filter((s: any) => str(s.Action).includes('dynamodb:Query'))).toEqual([]);
    });

    test('the host lists the data bucket (no prefix condition: missing objects are NoSuchKey) and deletes under vaults/*, which holds att/', () => {
      const st = hostPolicy();
      // s3:ListBucket itself (release R adds s3:ListBucketVersions on the counter bucket, not here).
      const lists = st.filter((s: any) => [].concat(s.Action).includes('s3:ListBucket' as never));
      expect(lists).toHaveLength(1);
      expect(lists[0].Condition).toBeUndefined();
      expect(str(lists[0].Resource)).toContain('DataBucket');
      expect(str(lists[0].Resource)).not.toContain('/*');
      const deletes = st.filter((s: any) => str(s.Action).includes('s3:DeleteObject'));
      expect(deletes).toHaveLength(1);
      expect(str(deletes[0].Resource)).toContain('"/vaults/*"');
    });

    test('a same-account principal: the table resource policy carries no host statement and denies nothing', () => {
      const vaults = resources(prod.json, 'AWS::DynamoDB::GlobalTable').find(([, t]) => t.Properties.TableName === 'vettid-org-vaults')![1];
      const rp = vaults.Properties.Replicas[0].ResourcePolicy.PolicyDocument.Statement;
      expect(rp.filter((s: any) => s.Effect !== 'Allow')).toEqual([]);
      expect(str(rp)).not.toContain(VAULT_ROLE_NAMES.host);
    });
  });

  test('2.1.0: only the host writes credential_backup; the API (and the cleanup job) write the start-over `deletion`', () => {
    const vaults = resources(prod.json, 'AWS::DynamoDB::GlobalTable').find(([, t]) => t.Properties.TableName === 'vettid-org-vaults')![1];
    const writes = vaults.Properties.Replicas[0].ResourcePolicy.PolicyDocument.Statement.filter((s: any) => str(s.Action).match(/PutItem|UpdateItem/));
    const attrsOf = (role: string) => writes.filter((s: any) => str(s.Condition).includes(role)).flatMap((s: any) => s.Condition['ForAllValues:StringEquals']?.['dynamodb:Attributes'] ?? []);
    expect(writes.flatMap((s: any) => s.Condition['ForAllValues:StringEquals']?.['dynamodb:Attributes'] ?? [])).not.toContain('credential_backup');
    expect(attrsOf('member-vault"')).toContain('deletion');
    expect(attrsOf('member-cleanup"')).toEqual(['vault_id', 'deletion_requested_at', 'deletion', 'orphan_seen_at']); // 2.6.5: the orphan mark
  });

  test("2.6.5: the admin API's member-vaults check may only Query the vaults table and its user-index, nothing else anywhere", () => {
    const tables = resources(prod.json, 'AWS::DynamoDB::GlobalTable');
    const mine = tables.flatMap(([, t]) => t.Properties.Replicas[0].ResourcePolicy?.PolicyDocument.Statement ?? []).filter((s: any) => str(s.Condition).includes('member-member-vaults"'));
    expect(mine.flatMap((s: any) => [].concat(s.Action))).toEqual(['dynamodb:Query', 'dynamodb:Query']);
    expect(mine.flatMap((s: any) => [].concat(s.Resource)).map((r: string) => r.replace(/^.*:table\//, ''))).toEqual(['vettid-org-vaults', 'vettid-org-vaults/index/user-index']);
  });

  test('the control-queue policy the parent applies admits the three senders only', () => {
    const param = resources(prod.json, 'AWS::SSM::Parameter').find(([, p]) => p.Properties.Name === '/vettid-org/prod/vault/control-queue-policy')![1];
    const policy = JSON.parse(param.Properties.Value);
    expect(policy.Statement).toEqual([
      {
        Sid: 'MemberApiSends',
        Effect: 'Allow',
        Principal: { AWS: 'arn:aws:iam::449757308783:root' },
        Action: 'sqs:SendMessage',
        Resource: 'arn:aws:sqs:us-east-1:369484479783:vettid-org-vault-control-*',
        Condition: { ArnEquals: { 'aws:PrincipalArn': ['arn:aws:iam::449757308783:role/vettid-org-member-vault', 'arn:aws:iam::449757308783:role/vettid-org-member-cleanup', 'arn:aws:iam::449757308783:role/vettid-org-member-account-push'] } },
      },
    ]);
  });

  test('a stream ARN from context feeds the alarm mailer; one from another table is refused', () => {
    const streamArn = 'arn:aws:dynamodb:us-east-1:369484479783:table/vettid-org-vaults/stream/2026-10-05T00:00:00.000';
    const a2 = new cdk.App({ context: { vaultsStreamArn: streamArn } });
    const t2 = Template.fromStack(new VettidOrgMemberApiStack(a2, 'M', { config: loadConfig(a2.node), env: { account: '449757308783', region: 'us-east-1' } }));
    t2.hasResourceProperties('AWS::Lambda::EventSourceMapping', { EventSourceArn: streamArn });
    const a3 = new cdk.App({ context: { vaultsStreamArn: 'arn:aws:dynamodb:us-east-1:449757308783:table/vettid-org-vaults/stream/x' } });
    expect(() => new VettidOrgMemberApiStack(a3, 'M', { config: loadConfig(a3.node), env: { account: '449757308783', region: 'us-east-1' } })).toThrow(/vaultsStreamArn/);
  });
});

describe('VettidOrgVaultStack: tables (moved from VettidOrgDataStack)', () => {
  const t = prod.t;
  test('vault tables: routing indexes; ephemeral ones expire via TTL; the vault table is point-in-time recoverable', () => {
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'vettid-org-vaults',
      KeySchema: [{ AttributeName: 'vault_id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        Match.objectLike({ IndexName: 'user-index' }),
        // the notice job (W8): vaults by sealed release, three attributes only
        Match.objectLike({
          IndexName: 'sealed-release-index',
          KeySchema: [{ AttributeName: 'sealed_release', KeyType: 'HASH' }, { AttributeName: 'vault_id', KeyType: 'RANGE' }],
          Projection: { ProjectionType: 'INCLUDE', NonKeyAttributes: ['user_guid', 'state'] },
        }),
      ],
      Replicas: [Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } })],
      // credential-clone alarms reach the alarm mailer (VAULT-MESSAGING 0.9.0 §11.5)
      StreamSpecification: { StreamViewType: 'NEW_IMAGE' },
    });
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'vettid-org-vault-instances',
      KeySchema: [{ AttributeName: 'instance_id', KeyType: 'HASH' }],
      TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true },
      GlobalSecondaryIndexes: [
        Match.objectLike({
          IndexName: 'release-index',
          KeySchema: [{ AttributeName: 'release', KeyType: 'HASH' }, { AttributeName: 'heartbeat_at', KeyType: 'RANGE' }],
          Projection: { ProjectionType: 'INCLUDE', NonKeyAttributes: ['load'] },
        }),
      ],
    });
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'vettid-org-vault-requests',
      KeySchema: [{ AttributeName: 'request_id', KeyType: 'HASH' }],
      TimeToLiveSpecification: { AttributeName: 'expires_at', Enabled: true },
    });
    t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'vettid-org-vault-releases',
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'status-index' })],
      // start requests reach the scaler (VAULT-RELEASES §8.6)
      StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
    });
    t.hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/prod/vault/vault-releases-stream-arn' });
  });

  test('table names, the control-queue prefix and its policy are published for the enclave host', () => {
    t.hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/prod/vault/control-queue-prefix', Value: 'vettid-org-vault-control-' });
    for (const k of ['vaults', 'vault-instances', 'vault-requests', 'vault-releases']) {
      t.hasResourceProperties('AWS::SSM::Parameter', { Name: `/vettid-org/prod/vault/${k}-table-name` });
    }
  });
});

describe('Vault OU SCP (lib/org/scp-vault.json)', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'lib', 'org', 'scp-vault.json'), 'utf8');
  const scp = JSON.parse(raw);

  test('fits the SCP size limit and only denies', () => {
    expect(JSON.stringify(scp).length).toBeLessThanOrEqual(5120);
    for (const s of scp.Statement) expect(s.Effect).toBe('Deny');
  });

  test('protects the roles named in key policies, by their fixed names', () => {
    const protect = scp.Statement.find((s: any) => s.Sid === 'ProtectKeyPolicyRoles');
    expect(protect.Action).toEqual(expect.arrayContaining(['iam:DeleteRole', 'iam:UpdateAssumeRolePolicy']));
    expect(protect.Resource).toEqual(expect.arrayContaining([`arn:aws:iam::*:role/${VAULT_ROLE_NAMES.host}`, `arn:aws:iam::*:role/${VAULT_ROLE_NAMES.retirement}`]));
    expect(protect.Condition).toBeUndefined(); // no exception inside the account: break-glass is the management account
  });

  test('the lockout bypass is denied to everyone but the release-key creator role', () => {
    const bypass = scp.Statement.find((s: any) => s.Sid === 'LockoutBypassOnlyByReleaseKeyCreator');
    expect(bypass.Action).toEqual(['kms:CreateKey', 'kms:PutKeyPolicy']);
    expect(bypass.Condition).toEqual({
      Bool: { 'kms:BypassPolicyLockoutSafetyCheck': 'true' },
      ArnNotLike: { 'aws:PrincipalArn': `arn:aws:iam::*:role/${VAULT_ROLE_NAMES.releaseKeyCreator}` },
    });
    expect(raw).toContain(`function:${VAULT_RELEASE_KEY_FUNCTION_NAME}`);
  });

  describe('the vault data buckets', () => {
    const s = scp.Statement.find((x: any) => x.Sid === 'ProtectVaultDataBuckets');
    const bucketOf = (stage: string) =>
      resources(synth(stage, []).json, 'AWS::S3::Bucket').map(([, b]) => b.Properties.BucketName).find((n: string) => n.includes('vault-data'));

    test('exactly the data bucket of each channel, as the vault stack names it', () => {
      expect(vaultDataBucketNames()).toEqual([bucketOf('prod'), bucketOf('staging')]);
      expect(s.Resource).toEqual(vaultDataBucketNames().map((b) => `arn:aws:s3:::${b}`));
      // Bucket ARNs only: no object call is denied here (the bucket policy keeps objects to the host role).
      for (const r of s.Resource) expect(r).not.toMatch(/[*/]/);
    });

    test('denies the calls that can destroy or expose the data: lifecycle, versioning, bucket policy, deletion', () => {
      expect([...s.Action].sort()).toEqual(['s3:DeleteBucket', 's3:DeleteBucketPolicy', 's3:PutBucketPolicy', 's3:PutBucketVersioning', 's3:PutLifecycleConfiguration']);
    });

    test('a deploy still can: only the CDK execution role is exempt (as in the other SCP statements)', () => {
      expect(s.Condition).toEqual({ ArnNotLike: { 'aws:PrincipalArn': 'arn:aws:iam::*:role/cdk-*-cfn-exec-role-*' } });
    });

    test('nothing a release needs: no other statement touches S3, and this one no object, tag or notification call', () => {
      const s3Statements = scp.Statement.filter((x: any) => [x.Action].flat().some((a: string) => a.startsWith('s3:')));
      expect(s3Statements.map((x: any) => x.Sid)).toEqual(['ProtectVaultDataBuckets']);
      for (const a of s.Action) expect(a).not.toMatch(/Object|\*/);
    });
  });

  describe('no interactive access to an instance', () => {
    const s = scp.Statement.find((x: any) => x.Sid === 'NoInteractiveSessions');

    test('sessions of every kind, EC2 Instance Connect and the serial console are denied', () => {
      // StartSession is the one call behind every session document (shell,
      // interactive command, port forwarding, SSH over Session Manager).
      expect([...s.Action].sort()).toEqual([
        'ec2-instance-connect:*',
        'ec2:CreateInstanceConnectEndpoint',
        'ec2:EnableSerialConsoleAccess',
        'ssm:ResumeSession',
        'ssm:StartSession',
      ]);
      expect(s.Resource).toBe('*');
    });

    test('to everyone: no exception inside the account, the CDK execution role included (no deploy opens a session)', () => {
      expect(s.Condition).toBeUndefined();
      expect(s.NotAction).toBeUndefined();
    });

    test('Run Command stays: nothing in the policy denies SendCommand or the agent\'s channels', () => {
      const actions: string[] = scp.Statement.flatMap((x: any) => [x.Action].flat());
      const denies = (action: string) => actions.some((a) => new RegExp('^' + a.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(action));
      expect(denies('ssm:StartSession')).toBe(true);
      expect(denies('ec2-instance-connect:SendSSHPublicKey')).toBe(true);
      for (const a of ['ssm:SendCommand', 'ssm:GetCommandInvocation', 'ssm:ListCommandInvocations', 'ssm:UpdateInstanceInformation', 'ssmmessages:OpenControlChannel', 'ec2messages:GetMessages']) {
        expect({ a, denied: denies(a) }).toEqual({ a, denied: false });
      }
    });
  });
});
