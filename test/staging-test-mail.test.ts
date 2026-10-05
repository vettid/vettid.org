import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../lib/app';
import { loadConfig } from '../lib/config';
import { TEST_MAIL_RETENTION_DAYS, VettidOrgStageTestMailStack } from '../lib/stacks/stage-test-mail-stack';
import { decide } from '../lambda/staging/test-mail-rule-set';
import { addresses, decodeHeader, extractLinks, htmlToText, parseMail } from '../scripts/staging/mime';
import { TEST_MAIL_BUCKET, TEST_MAIL_DOMAIN, TEST_MAIL_PREFIX, firstLink, matches, newAddress, testAddress } from '../scripts/staging/mail';

/**
 * Staging's test mailbox (RUNBOOK "Test mail"): the stack, the rule-set
 * activation logic, and the CLI's MIME reading. Lambda bundling is skipped.
 */

const STAGING = '347272280361';
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'mail', name));
const resources = (json: any, type: string) => Object.values<any>(json.Resources ?? {}).filter((r) => r.Type === type);
const str = (x: unknown) => JSON.stringify(x);

function stagingStack(): { stack: cdk.Stack; json: any } {
  const app = new cdk.App({ context: { stage: 'staging', 'aws:cdk:bundling-stacks': [] } });
  const config = loadConfig(app.node);
  const stack = new VettidOrgStageTestMailStack(app, 'VettidOrgStageTestMailStack', { config, env: { account: STAGING, region: 'us-east-1' } });
  return { stack, json: Template.fromStack(stack).toJSON() };
}

describe('VettidOrgStageTestMailStack', () => {
  const { stack, json } = stagingStack();
  const t = Template.fromStack(stack);

  test('MX for test.staging.vettid.org → SES inbound, in the stage zone by its SSM ref; no other records', () => {
    const records = resources(json, 'AWS::Route53::RecordSet');
    expect(records).toHaveLength(1);
    expect(records[0].Properties).toMatchObject({ Name: 'test.staging.vettid.org.', Type: 'MX', ResourceRecords: ['10 inbound-smtp.us-east-1.amazonaws.com'] });
    expect(str(records[0].Properties.HostedZoneId)).toContain('SsmParameterValuevettidorgstagingdnszoneid');
    // The parent domain identity covers sending to the subdomain (sandbox): no new identity.
    expect(resources(json, 'AWS::SES::EmailIdentity')).toHaveLength(0);
  });

  test('bucket: private, SSE-S3, owner-enforced, unversioned, 7-day expiry, destroyed with the stack', () => {
    const [bucket] = resources(json, 'AWS::S3::Bucket');
    expect(bucket.Properties.BucketName).toBe(TEST_MAIL_BUCKET);
    expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({ BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true });
    expect(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm).toBe('AES256');
    expect(bucket.Properties.OwnershipControls.Rules).toEqual([{ ObjectOwnership: 'BucketOwnerEnforced' }]);
    expect(bucket.Properties.VersioningConfiguration).toBeUndefined();
    expect(bucket.Properties.LifecycleConfiguration.Rules[0]).toMatchObject({ ExpirationInDays: TEST_MAIL_RETENTION_DAYS, Status: 'Enabled' });
    expect(bucket.DeletionPolicy).toBe('Delete');
  });

  test('bucket policy: TLS only; SES may put inbound/* for exactly this rule', () => {
    const [policy] = resources(json, 'AWS::S3::BucketPolicy');
    const statements = policy.Properties.PolicyDocument.Statement;
    expect(statements).toEqual(expect.arrayContaining([expect.objectContaining({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } })]));
    const sesWrites = statements.filter((s: any) => s.Principal?.Service === 'ses.amazonaws.com');
    expect(sesWrites).toHaveLength(1);
    expect(sesWrites[0]).toMatchObject({
      Effect: 'Allow',
      Action: 's3:PutObject',
      Condition: {
        StringEquals: {
          'aws:SourceAccount': STAGING,
          'aws:SourceArn': `arn:aws:ses:us-east-1:${STAGING}:receipt-rule-set/vettid-org-staging-test-mail:receipt-rule/vettid-org-staging-test-mail-s3`,
        },
      },
    });
    expect(str(sesWrites[0].Resource)).toContain('/inbound/*');
    // Nothing else may write (the auto-delete role only deletes/lists).
    for (const s of statements.filter((x: any) => x.Effect === 'Allow' && x !== sesWrites[0])) expect([s.Action].flat()).not.toContain('s3:PutObject');
  });

  test('one rule: the whole test domain, TLS, scanning, S3 inbound/ then stop; created after the bucket policy', () => {
    t.hasResourceProperties('AWS::SES::ReceiptRuleSet', { RuleSetName: 'vettid-org-staging-test-mail' });
    const [ruleId, rule] = Object.entries<any>(json.Resources).find(([, r]) => r.Type === 'AWS::SES::ReceiptRule')!;
    expect(rule.Properties.Rule).toMatchObject({
      Name: 'vettid-org-staging-test-mail-s3',
      Recipients: [TEST_MAIL_DOMAIN],
      Enabled: true,
      ScanEnabled: true,
      TlsPolicy: 'Require',
    });
    const actions = rule.Properties.Rule.Actions;
    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({ S3Action: { BucketName: { Ref: expect.any(String) }, ObjectKeyPrefix: TEST_MAIL_PREFIX } });
    expect(actions[1]).toEqual({ StopAction: { Scope: 'RuleSet' } });
    const policyId = Object.keys(json.Resources).find((k) => json.Resources[k].Type === 'AWS::S3::BucketPolicy')!;
    expect(rule.DependsOn).toContain(policyId);
    // Activated after the rule exists (and so deactivated before it goes).
    const [active] = resources(json, 'Custom::VettidActiveReceiptRuleSet');
    expect(active.Properties.RuleSetName).toBe('vettid-org-staging-test-mail');
    expect(active.DependsOn).toContain(ruleId);
  });

  test('the activator may only describe and set the active rule set; nothing sends mail here', () => {
    const allowed = resources(json, 'AWS::IAM::Policy').flatMap((p) => p.Properties.PolicyDocument.Statement).flatMap((s: any) => [s.Action].flat());
    expect(allowed).toEqual(expect.arrayContaining(['ses:DescribeActiveReceiptRuleSet', 'ses:SetActiveReceiptRuleSet']));
    expect(allowed.filter((a: string) => a.startsWith('ses:')).sort()).toEqual(['ses:DescribeActiveReceiptRuleSet', 'ses:SetActiveReceiptRuleSet']);
  });

  test('reader role: fixed name, owner only, list + get on inbound/ and nothing else', () => {
    const roles = Object.entries<any>(json.Resources).filter(([, r]) => r.Type === 'AWS::IAM::Role' && r.Properties.RoleName);
    expect(roles.map(([, r]) => r.Properties.RoleName)).toEqual(['vettid-org-staging-test-mail-reader']);
    const [readerId, reader] = roles[0];
    expect(reader.Properties.MaxSessionDuration).toBe(3600);
    expect(reader.Properties.AssumeRolePolicyDocument.Statement).toEqual([
      {
        Action: 'sts:AssumeRole',
        Effect: 'Allow',
        Principal: { AWS: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:iam::${STAGING}:root`]] } },
        Condition: { ArnLike: { 'aws:PrincipalArn': `arn:aws:iam::${STAGING}:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_VettIDAdmin_*` } },
      },
    ]);
    const policies = resources(json, 'AWS::IAM::Policy').filter((p) => str(p.Properties.Roles).includes(readerId));
    expect(policies).toHaveLength(1);
    const stmts = policies[0].Properties.PolicyDocument.Statement;
    expect(stmts.map((s: any) => s.Action)).toEqual(['s3:ListBucket', 's3:GetObject']);
    expect(stmts[0].Condition).toEqual({ StringLike: { 's3:prefix': ['inbound/*'] } });
    expect(str(stmts[1].Resource)).toContain('/inbound/*');
    expect(resources(json, 'AWS::IAM::ManagedPolicy')).toHaveLength(0);
    expect(reader.Properties.ManagedPolicyArns).toBeUndefined();
  });

  test('SSM refs and outputs', () => {
    t.hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/staging/test-mail/bucket-name' });
    t.hasResourceProperties('AWS::SSM::Parameter', { Name: '/vettid-org/staging/test-mail/reader-role-arn' });
    expect(Object.keys(json.Outputs)).toEqual(expect.arrayContaining(['ReaderRoleArn', 'BucketName', 'MailDomain']));
  });

  test('refuses prod', () => {
    const app = new cdk.App();
    expect(() => new VettidOrgStageTestMailStack(app, 'X', { config: loadConfig(app.node), env: { account: '449757308783', region: 'us-east-1' } })).toThrow(/never in prod/);
  });
});

describe('the app: staging has the test mailbox, prod never does', () => {
  const stacks = (context: Record<string, unknown>) => {
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
    buildApp(app);
    return app.node.children.filter((c): c is cdk.Stack => c instanceof cdk.Stack);
  };

  test('staging', () => {
    const s = stacks({ stage: 'staging' }).find((x) => x.stackName === 'VettidOrgStageTestMailStack');
    expect(s?.account).toBe(STAGING);
  });

  test('prod (with and without the staging delegation)', () => {
    for (const ctx of [{}, { stagingZoneNs: 'ns-1.awsdns-01.org,ns-2.awsdns-02.co.uk,ns-3.awsdns-03.com,ns-4.awsdns-04.net' }]) {
      const all = stacks(ctx);
      expect(all.length).toBeGreaterThan(5);
      for (const s of all) {
        expect(s.stackName).not.toMatch(/TestMail/);
        expect(str(Template.fromStack(s).toJSON())).not.toMatch(/test-mail|AWS::SES::ReceiptRule/);
      }
    }
  });
});

describe('activating the receipt rule set (one per account and region)', () => {
  const ours = 'vettid-org-staging-test-mail';
  test.each([
    ['Create', undefined, undefined, 'activate'],
    ['Create', undefined, ours, 'none'],
    ['Update', 'old-name', 'old-name', 'activate'],
    ['Update', ours, ours, 'none'],
    ['Delete', undefined, ours, 'deactivate'],
    ['Delete', undefined, 'someone-else', 'none'],
    ['Delete', undefined, undefined, 'none'],
  ] as const)('%s (previous %s, active %s) → %s', (type, previous, active, step) => {
    expect(decide(type, ours, previous, active)).toBe(step);
  });

  test('refuses to replace another active rule set', () => {
    expect(() => decide('Create', ours, undefined, 'production-inbound')).toThrow(/"production-inbound" is active.*Refusing/);
    expect(() => decide('Update', ours, 'old-name', 'production-inbound')).toThrow(/Refusing/);
  });
});

describe('the CLI helpers', () => {
  test('new addresses are fresh and at the test domain', () => {
    const a = newAddress();
    expect(a).toMatch(/^tester-[0-9a-f]{12}@test\.staging\.vettid\.org$/);
    expect(newAddress()).not.toBe(a);
    expect(newAddress('Signup')).toMatch(/^signup-[0-9a-f]{12}@/);
    expect(() => newAddress('bad prefix')).toThrow();
  });

  test('--to must be a test address', () => {
    expect(testAddress(' Tester-1@TEST.staging.vettid.org ')).toBe('tester-1@test.staging.vettid.org');
    expect(() => testAddress('someone@vettid.org')).toThrow(/test\.staging\.vettid\.org/);
    expect(() => testAddress('x@test.staging.vettid.org.evil.com')).toThrow();
    expect(() => testAddress(undefined)).toThrow();
  });

  test('the bucket the CLI reads is the stack\'s', () => {
    const { json } = stagingStack();
    expect(resources(json, 'AWS::S3::Bucket')[0].Properties.BucketName).toBe(TEST_MAIL_BUCKET);
  });
});

describe('reading the stored messages', () => {
  test('VettID sign-in link: quoted-printable, CRLF, soft line breaks, =3D in the link', () => {
    const m = parseMail(fixture('signin-qp.eml'));
    expect(m.from).toBe('VettID <no-reply@staging.vettid.org>');
    expect(m.to).toEqual(['tester-1a2b3c4d5e6f@test.staging.vettid.org']);
    expect(m.subject).toBe('Your VettID sign-in link');
    expect(m.date).toBe('Mon, 5 Oct 2026 12:00:00 +0000');
    expect(m.text).toContain('ignore this email — nobody can use the link');
    const link = 'https://account.staging.vettid.org/auth/#t=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0&e=tester-1a2b3c4d5e6f%40test.staging.vettid.org';
    expect(m.links).toEqual([link]);
    expect(firstLink(m, /\/auth\/#t=/)).toBe(link);
    expect(matches(m, 'tester-1a2b3c4d5e6f@test.staging.vettid.org', /sign-in/i)).toBe(true);
    expect(matches(m, 'tester-1a2b3c4d5e6f@test.staging.vettid.org', /verification/i)).toBe(false);
    expect(matches(m, 'other@test.staging.vettid.org')).toBe(false);
  });

  test('SES verification email: multipart/alternative, base64 parts, encoded subject, &amp; in the HTML', () => {
    const m = parseMail(fixture('ses-verification-base64.eml'));
    expect(m.subject).toBe('Amazon Web Services – Email Address Verification Request in region US East (N. Virginia)');
    expect(m.to).toEqual(['tester-9f8e7d6c5b4a@test.staging.vettid.org']);
    expect(m.text).toMatch(/^Dear Amazon Web Services Customer,/);
    expect(m.html).toContain('<a href=');
    // The same link from text and HTML (entities decoded), once.
    expect(m.links).toHaveLength(1);
    const link = firstLink(m, /email-verification\.us-east-1\.amazonaws\.com/)!;
    expect(link).toMatch(/^https:\/\/email-verification\.us-east-1\.amazonaws\.com\/\?Context=347272280361&X-Amz-Date=/);
    expect(link).toContain('&Identity.IdentityName=tester-9f8e7d6c5b4a%40test.staging.vettid.org&');
    expect(link).toMatch(/&X-Amz-Signature=0123456789abcdef$/);
  });

  test('HTML only, quoted-printable, LF line endings: text derived from the HTML; hrefs decoded', () => {
    const m = parseMail(fixture('html-only-qp.eml'));
    expect(m.from).toBe('VettID — Staging <no-reply@staging.vettid.org>');
    expect(m.subject).toBe('Café confirmation');
    expect(m.to).toEqual(['tester-html@test.staging.vettid.org', 'other@example.com']);
    expect(m.text).toContain('Hello & welcome to VettID — café.');
    expect(m.text).not.toContain('color: red');
    expect(m.links).toEqual([
      'https://account.staging.vettid.org/request/confirm?t=abc123&e=tester-html%40test.staging.vettid.org',
      'https://staging.vettid.org/help',
    ]);
  });

  test('nested multipart/mixed: first text/plain (8bit UTF-8) wins, attachments skipped, Cc counts as a recipient', () => {
    const m = parseMail(fixture('nested-mixed-8bit.eml'));
    expect(m.to).toEqual(['tester-cc@test.staging.vettid.org']);
    expect(m.text).toContain('Grüße');
    expect(m.links).toEqual(['https://account.staging.vettid.org/pin/#r=xyz789']);
    expect(m.links.join()).not.toContain('attachment.example.com');
  });

  test('pieces', () => {
    expect(decodeHeader('=?utf-8?q?a_b?= =?utf-8?b?w6k=?=')).toBe('a bé');
    expect(addresses('"A, B" <A@Test.staging.vettid.org>, c@d.org')).toEqual(['a@test.staging.vettid.org', 'c@d.org']);
    expect(extractLinks('see (https://a.example/x_(y)) and https://b.example/z.', undefined)).toEqual(['https://a.example/x_(y)', 'https://b.example/z']);
    expect(htmlToText('<p>a<br>b</p><script>x()</script><p>c&nbsp;&#x41;</p>')).toBe('a\nb\nc A');
  });
});
