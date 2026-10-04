import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { channelVault, loadConfig, VAULT_ROLE_NAMES } from '../lib/config';
import { VettidOrgVaultHostStack } from '../lib/stacks/vault-host-stack';
import { VettidOrgVaultReleaseStack, releaseStackId } from '../lib/stacks/vault-release-stack';
import { vaultEnv } from '../lib/stacks/vault-stack';
import { renderBuildComponent } from '../lib/vault/image-component';
import { VaultReleaseSpec, validateReleaseList, validateReleaseSpec } from '../lib/vault/releases';

/** A synthetic release (never deployed): the release stack's shape is tested on it. */
const SPEC: VaultReleaseSpec = {
  release: 7,
  channel: 'prod',
  tag: 'release/prod/7',
  sourceCommit: 'c'.repeat(40),
  pcr0: 'ab'.repeat(48),
  measurementsSha256: '1'.repeat(64),
  hostFilesSha256: '2'.repeat(64),
  nitroCliVersion: '1.5.0',
  baseAmi: 'ami-065b1b834d2a83a7a',
  amiRevision: 0,
  minInstances: 0,
  maxInstances: 2,
};

function host(stage = 'prod', releases: VaultReleaseSpec[] = []) {
  const app = new cdk.App({ context: { stage } });
  const config = loadConfig(app.node);
  const stack = new VettidOrgVaultHostStack(app, 'VettidOrgVaultHostStack', { config, env: vaultEnv(config, config.vault!), releases });
  return { config, stack, json: Template.fromStack(stack).toJSON(), t: Template.fromStack(stack) };
}
function release(spec: VaultReleaseSpec = SPEC, stage = 'prod') {
  const app = new cdk.App({ context: { stage } });
  const config = loadConfig(app.node);
  const stack = new VettidOrgVaultReleaseStack(app, releaseStackId(spec.release), { config, env: vaultEnv(config, config.vault!), spec });
  return { config, stack, json: Template.fromStack(stack).toJSON(), t: Template.fromStack(stack) };
}

const H = host('prod', [SPEC]);
const R = release();
const resources = (json: any, type: string) => Object.entries<any>(json.Resources).filter(([, r]) => r.Type === type).map(([id, r]) => ({ id, ...r }));
const statements = (json: any) => resources(json, 'AWS::IAM::Policy').flatMap((p) => p.Properties.PolicyDocument.Statement);
const asList = (x: unknown) => (Array.isArray(x) ? x : [x]);
const str = (x: unknown) => JSON.stringify(x);

describe('VettidOrgVaultHostStack: placement and guardrails', () => {
  test('vault account only', () => {
    expect(H.stack.account).toBe('369484479783');
    const app = new cdk.App();
    const config = loadConfig(app.node);
    expect(() => new VettidOrgVaultHostStack(app, 'X', { config, env: { account: '449757308783', region: 'us-east-1' }, releases: [] })).toThrow(/vault account/);
  });

  test.each([['host', H.json], ['release', R.json]])('%s stack: ≤ 200 resources, no Fn::ImportValue', (_n, json) => {
    expect(Object.keys(json.Resources).length).toBeLessThanOrEqual(200);
    expect(str(json)).not.toContain('Fn::ImportValue');
  });

  test('the fixed-name roles and instance profile are not created or changed here (VaultStack owns them)', () => {
    for (const json of [H.json, R.json]) {
      const names = [
        ...resources(json, 'AWS::IAM::Role').map((r) => r.Properties.RoleName),
        ...resources(json, 'AWS::IAM::InstanceProfile').map((r) => r.Properties.InstanceProfileName),
      ];
      for (const fixed of Object.values(VAULT_ROLE_NAMES)) expect(names).not.toContain(fixed);
      for (const p of resources(json, 'AWS::IAM::Policy')) expect(str(p.Properties.Roles)).not.toMatch(/vettid-org-vault-(host|key-retirement)"/);
    }
  });

  test('no IAM statement grants a service wildcard', () => {
    for (const s of statements(H.json)) {
      for (const a of asList(s.Action)) expect(a).not.toMatch(/^(\*|[a-z0-9-]+:\*)$/);
    }
  });
});

describe('VettidOrgVaultHostStack: network and egress (§8.4)', () => {
  test('host VPC: two AZs, public subnets only, no NAT, no interface endpoints', () => {
    expect(resources(H.json, 'AWS::EC2::NatGateway')).toHaveLength(0);
    const hostVpc = resources(H.json, 'AWS::EC2::VPC').find((v) => v.Properties.CidrBlock === '10.45.0.0/24')!;
    const subnets = resources(H.json, 'AWS::EC2::Subnet').filter((s) => str(s.Properties.VpcId).includes(hostVpc.id));
    expect(subnets.map((s) => s.Properties.AvailabilityZone).sort()).toEqual(['us-east-1a', 'us-east-1b']);
    expect(subnets.every((s) => s.Properties.MapPublicIpOnLaunch === true)).toBe(true);
    const eps = resources(H.json, 'AWS::EC2::VPCEndpoint');
    expect(eps.every((e) => (e.Properties.VpcEndpointType ?? 'Gateway') === 'Gateway')).toBe(true);
    expect(eps.map((e) => str(e.Properties.ServiceName)).sort()).toEqual([expect.stringContaining('dynamodb'), expect.stringContaining('s3')]);
  });

  test('gateway endpoints admit only this account’s buckets and tables', () => {
    for (const e of resources(H.json, 'AWS::EC2::VPCEndpoint')) {
      expect(e.Properties.PolicyDocument.Statement).toEqual([
        expect.objectContaining({ Effect: 'Allow', Condition: { StringEquals: { 'aws:ResourceAccount': '369484479783' } } }),
      ]);
    }
  });

  test('host security group: no inbound; outbound TCP 443 only', () => {
    const sg = resources(H.json, 'AWS::EC2::SecurityGroup').find((g) => g.Properties.GroupName === 'vettid-org-vault-host')!;
    expect(sg.Properties.SecurityGroupIngress).toBeUndefined();
    expect(sg.Properties.SecurityGroupEgress).toEqual([
      expect.objectContaining({ CidrIp: '0.0.0.0/0', IpProtocol: 'tcp', FromPort: 443, ToPort: 443 }),
    ]);
    expect(resources(H.json, 'AWS::EC2::SecurityGroupIngress')).toHaveLength(0);
  });

  test('flow logs on the host VPC, logs retained one month', () => {
    expect(resources(H.json, 'AWS::EC2::FlowLog')).toHaveLength(1);
    for (const g of resources(H.json, 'AWS::Logs::LogGroup')) expect(g.Properties.RetentionInDays).toBe(30);
  });

  // A change to this list is a security review item (VAULT-RELEASES §8.4).
  test('DNS Firewall allowlist (snapshot)', () => {
    const lists = resources(H.json, 'AWS::Route53Resolver::FirewallDomainList');
    expect(lists.find((l) => l.Properties.Name === 'vettid-org-vault-host-allow')!.Properties.Domains).toEqual([
      'relay.vettid.org',
      'kms.us-east-1.amazonaws.com',
      'android.googleapis.com',
      'sqs.us-east-1.amazonaws.com',
      'dynamodb.us-east-1.amazonaws.com',
      '369484479783.ddb.us-east-1.amazonaws.com',
      's3.us-east-1.amazonaws.com',
      'vettid-org-vault-data-369484479783.s3.us-east-1.amazonaws.com',
      'ssm.us-east-1.amazonaws.com',
      'ssmmessages.us-east-1.amazonaws.com',
      'ec2messages.us-east-1.amazonaws.com',
      'logs.us-east-1.amazonaws.com',
      'monitoring.us-east-1.amazonaws.com',
      'autoscaling.us-east-1.amazonaws.com',
      '*.ec2.internal',
    ]);
    expect(lists.find((l) => l.Properties.Name === 'vettid-org-vault-host-block-all')!.Properties.Domains).toEqual(['*']);
  });

  test('DNS Firewall rules: allow the list (redirections trusted), NXDOMAIN for everything else; associated, mutation-protected', () => {
    const [group] = resources(H.json, 'AWS::Route53Resolver::FirewallRuleGroup');
    const rules = group.Properties.FirewallRules.map((r: any) => [r.Priority, r.Action, r.BlockResponse ?? null, r.FirewallDomainRedirectionAction ?? null]);
    expect(rules).toEqual([[100, 'ALLOW', null, 'TRUST_REDIRECTION_DOMAIN'], [200, 'BLOCK', 'NXDOMAIN', null]]);
    const [assoc] = resources(H.json, 'AWS::Route53Resolver::FirewallRuleGroupAssociation');
    expect(assoc.Properties.MutationProtection).toBe('ENABLED');
    expect(resources(H.json, 'AWS::Route53Resolver::ResolverQueryLoggingConfigAssociation')).toHaveLength(1);
  });

  test('no interface endpoint for KMS (public endpoint, TLS ends in the enclave)', () => {
    expect(str(H.json)).not.toMatch(/com\.amazonaws\.us-east-1\.kms/);
  });
});

describe('VettidOrgVaultHostStack: Image Builder infrastructure (§8.3)', () => {
  test('builds in the separate build VPC, as its own role, IMDSv2', () => {
    const [infra] = resources(H.json, 'AWS::ImageBuilder::InfrastructureConfiguration');
    expect(infra.Properties.InstanceMetadataOptions).toEqual({ HttpTokens: 'required', HttpPutResponseHopLimit: 1 });
    expect(infra.Properties.TerminateInstanceOnFailure).toBe(true);
    const buildVpc = resources(H.json, 'AWS::EC2::VPC').find((v) => v.Properties.CidrBlock === '10.46.0.0/26')!;
    const subnetId = infra.Properties.SubnetId.Ref;
    expect(str(H.json.Resources[subnetId].Properties.VpcId)).toContain(buildVpc.id);
    expect(infra.Properties.InstanceProfileName).not.toBe(VAULT_ROLE_NAMES.host);
    // The build VPC has no DNS Firewall association (it needs GitHub and the repos).
    const [assoc] = resources(H.json, 'AWS::Route53Resolver::FirewallRuleGroupAssociation');
    expect(str(assoc.Properties.VpcId)).not.toContain(buildVpc.id);
  });
});

describe('VettidOrgVaultHostStack: scaler (§8.6)', () => {
  const fn = () => resources(H.json, 'AWS::Lambda::Function').find((f) => f.Properties.FunctionName === 'vettid-org-vault-scaler')!;

  test('one at a time (reserved concurrency 1); caps 2 per release, 6 total, 30 idle minutes', () => {
    expect(fn().Properties.ReservedConcurrentExecutions).toBe(1);
    expect(fn().Properties.Environment.Variables).toMatchObject({ CAP_PER_RELEASE: '2', CAP_TOTAL: '6', IDLE_MINUTES: '30', TABLE_VAULT_RELEASES: 'vettid-org-vault-releases' });
  });

  test('triggered by start requests on the vault-releases stream (from SSM) and every minute', () => {
    const [esm] = resources(H.json, 'AWS::Lambda::EventSourceMapping');
    expect(str(esm.Properties.EventSourceArn)).toMatch(/vaultvaultreleasesstreamarn/);
    expect(JSON.parse(esm.Properties.FilterCriteria.Filters[0].Pattern)).toEqual({
      eventName: ['MODIFY'],
      dynamodb: { NewImage: { start_requested_at: { S: [{ exists: true }] } } },
    });
    const rules = resources(H.json, 'AWS::Events::Rule').map((r) => r.Properties.ScheduleExpression).filter(Boolean);
    expect(rules.sort()).toEqual(['rate(1 minute)', 'rate(5 minutes)']);
  });

  test('least privilege: desired capacity only on tagged vault groups; only its own markers on release rows', () => {
    const role = fn().Properties.Role['Fn::GetAtt'][0];
    const st = resources(H.json, 'AWS::IAM::Policy').filter((p) => str(p.Properties.Roles).includes(role)).flatMap((p) => p.Properties.PolicyDocument.Statement);
    const actions = st.flatMap((s) => asList(s.Action)).sort();
    expect(actions).toEqual(
      [
        'autoscaling:DescribeAutoScalingGroups', 'autoscaling:SetDesiredCapacity', 'dynamodb:DescribeStream', 'dynamodb:GetRecords',
        'dynamodb:GetShardIterator', 'dynamodb:ListStreams', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:UpdateItem',
      ].sort(),
    );
    const set = st.find((s) => s.Action === 'autoscaling:SetDesiredCapacity')!;
    expect(set.Resource).toBe('arn:aws:autoscaling:us-east-1:369484479783:autoScalingGroup:*:autoScalingGroupName/vettid-org-vault-r*');
    expect(set.Condition).toEqual({ StringEquals: { 'aws:ResourceTag/vettid:vault-scaler': 'managed' } });
    const upd = st.find((s) => s.Action === 'dynamodb:UpdateItem')!;
    expect(upd.Condition['ForAllValues:StringEquals']['dynamodb:Attributes']).toEqual(['release', 'start_issued_at', 'busy_at']);
  });
});

describe('VettidOrgVaultHostStack: manifest sync (§7)', () => {
  const fn = () => resources(H.json, 'AWS::Lambda::Function').find((f) => f.Properties.FunctionName === 'vettid-org-vault-manifest-sync')!;

  test('fetches the channel’s manifest; pinned keys from config', () => {
    expect(fn().Properties.Environment.Variables).toMatchObject({
      MANIFEST_URL: 'https://vettid.org/.well-known/vettid/pcr-manifest.json',
      PINNED_KEYS: JSON.stringify(channelVault('prod').vault.manifestKeys), // key A (W7)
      DATA_BUCKET: 'vettid-org-vault-data-369484479783',
      SSM_RELEASES_PATH: '/vettid-org/prod/vault/releases/',
    });
    expect(host('staging').json.Resources).toBeDefined();
  });

  test('writes routing attributes only, never start requests, rescue or scaler markers; never writes manifests/', () => {
    const role = fn().Properties.Role['Fn::GetAtt'][0];
    const st = resources(H.json, 'AWS::IAM::Policy').filter((p) => str(p.Properties.Roles).includes(role)).flatMap((p) => p.Properties.PolicyDocument.Statement);
    const upd = st.find((s) => s.Action === 'dynamodb:UpdateItem')!;
    const attrs: string[] = upd.Condition['ForAllValues:StringEquals']['dynamodb:Attributes'];
    for (const a of ['start_requested_at', 'start_requests', 'rescue', 'start_issued_at', 'busy_at']) expect(attrs).not.toContain(a);
    expect(st.flatMap((s) => asList(s.Action))).not.toContain('s3:PutObject');
  });
});

describe('VettidOrgVaultHostStack: queue, logs, alarms, refs (§8.5, §8.7)', () => {
  test('the shared DLQ and the host log group carry the names the host role is granted', () => {
    H.t.hasResourceProperties('AWS::SQS::Queue', { QueueName: 'vettid-org-vault-dlq', SqsManagedSseEnabled: true });
    H.t.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: '/vettid-org/prod/vault-host', RetentionInDays: 30 });
  });

  test('every alarm notifies the vault alerts topic (admin email)', () => {
    H.t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'admin@vettid.org' });
    const alarms = resources(H.json, 'AWS::CloudWatch::Alarm');
    expect(alarms.length).toBeGreaterThanOrEqual(9);
    for (const a of alarms) expect(str(a.Properties.AlarmActions)).toContain('Alerts');
    const names = alarms.map((a) => a.Properties.AlarmName).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        'vettid-org-vault-dlq-not-empty', 'vettid-org-vault-control-queue-age', 'vettid-org-vault-start-unfulfilled', 'vettid-org-vault-start-blocked',
        'vettid-org-vault-active-release-down', 'vettid-org-vault-manifest-rejected', 'vettid-org-vault-manifest-not-in-bucket',
      ]),
    );
  });

  test('CloudTrail rules: key deletion/rescue/policy, lockout bypass, the pinned roles', () => {
    const patterns = resources(H.json, 'AWS::Events::Rule').map((r) => r.Properties.EventPattern).filter(Boolean);
    const names = patterns.flatMap((p) => p.detail.eventName);
    expect(names).toEqual(expect.arrayContaining(['ScheduleKeyDeletion', 'CancelKeyDeletion', 'EnableKey', 'PutKeyPolicy', 'CreateKey', 'DeleteRole', 'UpdateAssumeRolePolicy']));
    const bypass = patterns.find((p) => p.detail.eventName.includes('CreateKey'));
    expect(bypass.detail.requestParameters).toEqual({ bypassPolicyLockoutSafetyCheck: [true] });
    expect(str(patterns)).toContain('vettid-org-vault-host');
    expect(str(patterns)).toContain('vettid-org-vault-key-retirement');
  });

  test('the smoke key admits the configured releases’ PCR0s only; none without releases', () => {
    const key = (json: any) => resources(json, 'AWS::KMS::Key')[0];
    const attested = (json: any) => key(json).Properties.KeyPolicy.Statement.filter((s: any) => s.Condition?.StringEqualsIgnoreCase);
    expect(attested(H.json).map((s: any) => s.Condition.StringEqualsIgnoreCase['kms:RecipientAttestation:ImageSha384'])).toEqual([[SPEC.pcr0], [SPEC.pcr0]]);
    expect(attested(host('prod').json)).toEqual([]);
  });

  test('refs for the release stacks and the hosts’ boot', () => {
    const names = resources(H.json, 'AWS::SSM::Parameter').map((p) => p.Properties.Name).sort();
    expect(names).toEqual(
      [
        'alerts-topic-arn', 'dlq-arn', 'host-log-group', 'host-security-group-id', 'host-subnet-ids', 'image-builder-infra-arn', 'relay-host', 'smoke-key-arn',
      ].map((k) => `/vettid-org/prod/vault/${k}`),
    );
  });
});

describe('VettidOrgVaultRelease<N>Stack (synthetic release 7)', () => {
  test('release entries are validated', () => {
    expect(() => validateReleaseSpec({ ...SPEC, tag: 'v7' }, 'prod')).toThrow(/tag/);
    expect(() => validateReleaseSpec({ ...SPEC, pcr0: '0'.repeat(96) }, 'prod')).toThrow(/debug/);
    expect(() => validateReleaseSpec({ ...SPEC, maxInstances: 3 as never }, 'prod')).toThrow(/maxInstances/);
    expect(() => validateReleaseSpec(SPEC, 'staging')).toThrow(/channel/);
    expect(() => validateReleaseList([SPEC, { ...SPEC }], 'prod')).toThrow(/twice/);
    expect(() => validateReleaseList([SPEC, { ...SPEC, release: 8, tag: 'release/prod/8' }], 'prod')).toThrow(/PCR0/);
  });

  test('launch template: m7g.large, enclaves, IMDSv2 hop 1, the host instance profile, no key pair, encrypted gp3', () => {
    const [lt] = resources(R.json, 'AWS::EC2::LaunchTemplate');
    const d = lt.Properties.LaunchTemplateData;
    expect(d).toMatchObject({
      InstanceType: 'm7g.large',
      EnclaveOptions: { Enabled: true },
      MetadataOptions: { HttpTokens: 'required', HttpPutResponseHopLimit: 1 },
      IamInstanceProfile: { Name: 'vettid-org-vault-host' },
      BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { VolumeSize: 20, VolumeType: 'gp3', Encrypted: true } }],
      NetworkInterfaces: [expect.objectContaining({ AssociatePublicIpAddress: true })],
    });
    expect(d.KeyName).toBeUndefined();
    expect(str(d.NetworkInterfaces[0].Groups)).toMatch(/vaulthostsecuritygroupid/);
    expect(str(d.ImageId)).toMatch(/ImageId/);
  });

  test('user data only writes host.env: SSM prefix, region, release, group and hook', () => {
    const [lt] = resources(R.json, 'AWS::EC2::LaunchTemplate');
    const ud = lt.Properties.LaunchTemplateData.UserData['Fn::Base64'];
    expect(ud).toBe(
      [
        '#cloud-config', 'write_files:', '  - path: /etc/vettid/host.env', '    owner: root:root', "    permissions: '0644'", '    content: |',
        '      VETTID_SSM_PREFIX=/vettid-org/prod/vault', '      VETTID_REGION=us-east-1', '      VETTID_RELEASE=7',
        '      VETTID_ASG_NAME=vettid-org-vault-r7', '      VETTID_LIFECYCLE_HOOK=vault-drain', '',
      ].join('\n'),
    );
  });

  test('group: min/max from the entry, no desired capacity (the scaler owns it), no update policy, drain hook, scaler tags', () => {
    const [g] = resources(R.json, 'AWS::AutoScaling::AutoScalingGroup');
    expect(g.Properties).toMatchObject({ AutoScalingGroupName: 'vettid-org-vault-r7', MinSize: '0', MaxSize: '2' });
    expect(g.Properties.DesiredCapacity).toBeUndefined();
    expect(g.UpdatePolicy).toBeUndefined();
    expect(g.Properties.LifecycleHookSpecificationList).toEqual([
      { LifecycleHookName: 'vault-drain', LifecycleTransition: 'autoscaling:EC2_INSTANCE_TERMINATING', HeartbeatTimeout: 300, DefaultResult: 'CONTINUE' },
    ]);
    expect(g.Properties.Tags).toEqual(
      expect.arrayContaining([
        { Key: 'vettid:vault-scaler', Value: 'managed', PropagateAtLaunch: false },
        { Key: 'vettid:vault-release', Value: '7', PropagateAtLaunch: true },
        { Key: 'vettid:vault-pcr0', Value: SPEC.pcr0, PropagateAtLaunch: true },
      ]),
    );
    expect(str(g.Properties.VPCZoneIdentifier)).toMatch(/vaulthostsubnetids/);
    R.t.hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/prod/vault/releases/7/group-name', Value: 'vettid-org-vault-r7' });
  });

  test('AMI: Image Builder on the pinned base AMI, content-hashed names, built in the host stack’s infrastructure', () => {
    const [recipe] = resources(R.json, 'AWS::ImageBuilder::ImageRecipe');
    expect(recipe.Properties.ParentImage).toBe(SPEC.baseAmi);
    expect(recipe.Properties.Name).toMatch(/^vettid-org-vault-r7-[0-9a-f]{10}$/);
    const [image] = resources(R.json, 'AWS::ImageBuilder::Image');
    expect(str(image.Properties.InfrastructureConfigurationArn)).toMatch(/vaultimagebuilderinfraarn/);
    // A new base AMI is a new recipe (and image); the same inputs keep the name.
    expect(release({ ...SPEC, baseAmi: 'ami-0123456789abcdef0' }).json).not.toEqual(R.json);
    expect(resources(release().json, 'AWS::ImageBuilder::ImageRecipe')[0].Properties.Name).toBe(recipe.Properties.Name);
  });

  test('the build component pins and verifies every input, and never runs a debug enclave', () => {
    const [c] = resources(R.json, 'AWS::ImageBuilder::Component');
    const doc: string = c.Properties.Data;
    expect(doc).toBe(renderBuildComponent(SPEC));
    for (const pin of [SPEC.pcr0, SPEC.measurementsSha256, SPEC.hostFilesSha256, SPEC.sourceCommit, SPEC.tag, SPEC.nitroCliVersion]) expect(doc).toContain(pin);
    expect(doc).toContain('https://github.com/${REPO}/releases/download/${TAG}');
    expect(doc).toContain('https://raw.githubusercontent.com/${REPO}/${COMMIT}/deploy/host');
    expect(doc).toContain('nitro-cli describe-eif');
    expect(doc).toContain('sha256sum --quiet --strict -c SHA256SUMS');
    expect(doc).not.toMatch(/debug-mode/);
  });

  test('the component script is valid bash', () => {
    const doc = renderBuildComponent(SPEC);
    const script = doc.split('            - |\n')[1].split('\n').map((l) => l.replace(/^ {14}/, '')).join('\n');
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vault-comp-')), 'build.sh');
    fs.writeFileSync(f, script);
    expect(() => execFileSync('bash', ['-n', f])).not.toThrow();
    expect(script.startsWith('set -euo pipefail\n')).toBe(true);
  });

  test('a staging release gets staging names', () => {
    const s = release({ ...SPEC, channel: 'staging', tag: 'release/staging/7' }, 'staging');
    expect(s.stack.account).toBe('347272280361');
    s.t.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', { AutoScalingGroupName: 'vettid-org-staging-vault-r7' });
    s.t.hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/staging/vault/releases/7/group-name' });
  });

  test('an alarm when the group cannot keep its desired capacity in service', () => {
    R.t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'vettid-org-vault-r7-short',
      AlarmActions: [Match.objectLike({ Ref: Match.stringLikeRegexp('alertstopicarn') })],
    });
  });
});
