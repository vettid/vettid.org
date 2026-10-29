import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../lib/app';
import { loadConfig } from '../lib/config';
import { VettidOrgCallsStack, CALLS_STUB_CODE } from '../lib/stacks/calls-stack';
import { VettidOrgCallsDataStack } from '../lib/stacks/calls-data-stack';

/** The calling service's first stacks (CALLING-SERVICE §8.2; CALLS-PLAN §13.3 step 2). */
const STAGING = '347272280361';
const cfg = (context: Record<string, unknown>) => loadConfig(new cdk.App({ context }).node);
const of = (json: any, type: string): any[] => Object.values<any>(json.Resources ?? {}).filter((r) => r.Type === type);

function synth(context: Record<string, unknown>) {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], stage: 'staging', ...context } });
  buildApp(app);
  const out = new Map<string, any>();
  for (const c of app.node.children) if (c instanceof cdk.Stack) out.set(c.stackName, Template.fromStack(c).toJSON());
  return out;
}

const dir = mkdtempSync(join(tmpdir(), 'calls-'));
const zip = join(dir, 'issuer.zip');
writeFileSync(zip, 'not really a zip');
const SHA = createHash('sha256').update('not really a zip').digest('hex');
const ARCHIVE = { stagingCallsIssuer: `https://example.org/issuer.zip@sha256:${SHA}`, stagingCallsIssuerFile: zip };

describe('context', () => {
  test('nothing without callsStages; the prod app ignores the staging keys', () => {
    expect(cfg({ stage: 'staging' }).calls).toBeUndefined();
    expect(cfg({ callsStages: 'staging', callsIssuerStub: true }).calls).toBeUndefined();
    expect(cfg({ stage: 'staging', callsStages: 'staging' }).calls?.issuer).toEqual({ kind: 'none' });
  });
  test('names', () => {
    const c = cfg({ stage: 'staging', callsStages: 'staging', callsIssuerStub: 'true' }).calls!;
    expect([c.host, c.turnHost, c.issuer.kind]).toEqual(['calls.staging.vettid.org', 'turn.staging.vettid.org', 'stub']);
  });
  test('refusals', () => {
    expect(() => cfg({ stage: 'staging', callsStages: 'prod' })).toThrow(/no production calling service/);
    expect(() => cfg({ callsStages: 'prod' })).toThrow(/no production calling service/);
    expect(() => cfg({ stage: 'staging', callsIssuerStub: true })).toThrow(/does not name/);
    expect(() => cfg({ stage: 'staging', callsStages: 'staging', callsIssuerStub: true, ...ARCHIVE })).toThrow(/never runs beside/);
    expect(() => cfg({ stage: 'staging', callsStages: 'staging', stagingCallsIssuer: 'ghcr.io/x:latest', stagingCallsIssuerFile: zip })).toThrow(/expected <https URL>/);
    expect(() => cfg({ stage: 'staging', callsStages: 'staging', stagingCallsIssuer: ARCHIVE.stagingCallsIssuer })).toThrow(/archive is needed/);
    expect(() => cfg({ stage: 'staging', callsStages: 'staging', callsIssuerStub: 'yes' })).toThrow(/true or false/);
  });
});

describe('the stub (handshake test)', () => {
  const t = synth({ callsStages: 'staging', callsIssuerStub: true });
  const front = t.get('VettidOrgCallsStack');

  test('the stack set: data and service, nothing of the existing stacks changes', () => {
    expect([...t.keys()].filter((k) => /Calls/.test(k)).sort()).toEqual(['VettidOrgCallsDataStack', 'VettidOrgCallsStack']);
    const without = synth({});
    for (const [name, json] of without) expect(JSON.stringify(t.get(name))).toBe(JSON.stringify(json));
  });

  test('the front: CloudFront, HTTP/2, TLS 1.2+ (1.3 negotiated), https only, no access log, no cache', () => {
    const [d] = of(front, 'AWS::CloudFront::Distribution');
    const c = d.Properties.DistributionConfig;
    expect(c.Aliases).toEqual(['calls.staging.vettid.org']);
    expect(c.HttpVersion).toBe('http2');
    expect(c.ViewerCertificate.MinimumProtocolVersion).toBe('TLSv1.2_2021');
    expect(c.ViewerCertificate.SslSupportMethod).toBe('sni-only');
    expect(c.Logging).toBeUndefined();
    expect(c.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('https-only');
    expect(c.DefaultCacheBehavior.AllowedMethods).toHaveLength(7);
    expect(c.WebACLId).toBeUndefined();
    expect(of(front, 'AWS::CertificateManager::Certificate')[0].Properties.DomainName).toBe('calls.staging.vettid.org');
    expect(of(front, 'AWS::Route53::RecordSet').map((r) => r.Properties.Type).sort()).toEqual(['A', 'AAAA']);
  });

  test('the origin is the stub: no secret, no key, no metrics, logs to the data stack\'s group', () => {
    const [f] = of(front, 'AWS::Lambda::Function');
    expect(f.Properties.Code.ZipFile).toBe(CALLS_STUB_CODE);
    expect(f.Properties.Environment).toBeUndefined();
    expect(f.Properties.ReservedConcurrentExecutions).toBe(4);
    expect(f.Properties.LoggingConfig).toMatchObject({ LogFormat: 'JSON', SystemLogLevel: 'WARN', LogGroup: '/vettid-org/staging/calls-issuer' });
    const doc = JSON.stringify(of(front, 'AWS::IAM::Policy'));
    expect(doc).not.toMatch(/secretsmanager|kms:|PutMetricData/);
    expect(of(front, 'AWS::CloudWatch::Alarm')).toEqual([]);
    expect(front.Outputs.IssuerKind.Value).toBe('stub');
    expect(CALLS_STUB_CODE).not.toMatch(/event\.(body|headers)/);
  });

  test('no log group, log bucket or flow log in the service stack', () => {
    for (const type of ['AWS::Logs::LogGroup', 'AWS::S3::Bucket', 'AWS::EC2::FlowLog']) expect(of(front, type)).toEqual([]);
  });
});

describe('the data stack', () => {
  const data = synth({ callsStages: 'staging', callsIssuerStub: true }).get('VettidOrgCallsDataStack');
  test('key, two 14-day retained log groups, alarm topic; terminationProtection', () => {
    expect(of(data, 'AWS::KMS::Alias')[0].Properties.AliasName).toBe('alias/vettid-org-calls');
    const g = of(data, 'AWS::Logs::LogGroup');
    expect(g.map((x) => x.Properties.LogGroupName).sort()).toEqual(['/vettid-org/staging/calls-issuer', '/vettid-org/staging/calls-server']);
    for (const x of g) expect([x.Properties.RetentionInDays, x.DeletionPolicy]).toEqual([14, 'RetainExceptOnCreate']);
    expect(of(data, 'AWS::SNS::Topic')[0].Properties.TopicName).toBe('vettid-org-calls-alerts');
    expect(of(data, 'AWS::SSM::Parameter').map((p) => p.Properties.Name)).toEqual(['/vettid-org/staging/calls/key-arn']);
  });
  test('only the issuer, the server and the owner may decrypt; no CreateGrant', () => {
    const st: any[] = of(data, 'AWS::KMS::Key')[0].Properties.KeyPolicy.Statement;
    expect(st.map((s) => s.Sid)).toEqual(['AdministerButNotDecrypt', 'OwnerWritesAndReadsSecret', 'IssuerDecrypts', 'ServerDecrypts']);
    expect(JSON.stringify(st[0].Action)).not.toMatch(/Decrypt|GenerateDataKey|CreateGrant/);
  });
  test('stub: no EIP, no VPC (those are step 4)', () => {
    expect(of(data, 'AWS::EC2::EIP')).toEqual([]);
  });
  test('not built in the prod app', () => {
    const app = new cdk.App({ context: { callsStages: 'staging' } });
    expect(() => new VettidOrgCallsDataStack(app, 'X', { config: loadConfig(app.node), env: { account: STAGING, region: 'us-east-1' } })).toThrow();
    expect(() => new VettidOrgCallsStack(app, 'Y', { config: loadConfig(app.node) })).toThrow();
  });
});

describe('the real issuer archive', () => {
  const t = synth({ callsStages: 'staging', ...ARCHIVE });
  const svc = t.get('VettidOrgCallsStack');
  test('provided.al2023 arm64, its environment, scoped grants, alarms', () => {
    const [f] = of(svc, 'AWS::Lambda::Function');
    expect(f.Properties).toMatchObject({ Runtime: 'provided.al2023', Handler: 'bootstrap', Architectures: ['arm64'], ReservedConcurrentExecutions: 4 });
    expect(f.Properties.Environment.Variables).toMatchObject({
      CALLS_CHANNEL: 'staging', CALLS_TURN_HOST: 'turn.staging.vettid.org', CALLS_SECRET_ID: 'vettid-org/staging/calls/turn-secret',
      CALLS_METRICS_NAMESPACE: 'vettid-org/staging/calls',
    });
    const doc = JSON.stringify(of(svc, 'AWS::IAM::Policy'));
    expect(doc).toContain('secret:vettid-org/staging/calls/turn-secret-??????');
    expect(doc).toContain('"cloudwatch:namespace":"vettid-org/staging/calls"');
    expect(of(svc, 'AWS::CloudWatch::Alarm').map((a) => a.Properties.AlarmName).sort()).toEqual([
      'vettid-org-staging-calls-issuer-attestation-refusals', 'vettid-org-staging-calls-issuer-errors', 'vettid-org-staging-calls-issuer-manifest',
    ]);
    expect(svc.Outputs.IssuerKind.Value).toBe('archive');
  });
  test('a file that is not the pinned one fails the synth', () => {
    expect(() => synth({ callsStages: 'staging', stagingCallsIssuer: `https://example.org/i.zip@sha256:${'0'.repeat(64)}`, stagingCallsIssuerFile: zip })).toThrow(/SHA-256 is/);
  });
});

test('no issuer yet: data stack only', () => {
  const t = synth({ callsStages: 'staging' });
  expect(t.has('VettidOrgCallsDataStack')).toBe(true);
  expect(t.has('VettidOrgCallsStack')).toBe(false);
});
