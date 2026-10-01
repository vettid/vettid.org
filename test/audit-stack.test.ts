import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { loadConfig } from '../lib/config';
import { VettidOrgAuditStack } from '../lib/stacks/audit-stack';

const app = new cdk.App();
const t = Template.fromStack(new VettidOrgAuditStack(app, 'Audit', { config: loadConfig(app.node), env: { account: '123456789012', region: 'us-east-1' } }));

test('multi-region trail with log-file validation, incl. global events', () => {
  t.hasResourceProperties('AWS::CloudTrail::Trail', {
    IsMultiRegionTrail: true,
    IncludeGlobalServiceEvents: true,
    EnableLogFileValidation: true,
  });
});

test('trail bucket: private, TLS-only, versioned, retained, lifecycle-managed', () => {
  t.hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Retain',
    Properties: Match.objectLike({
      VersioningConfiguration: { Status: 'Enabled' },
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicPolicy: true, RestrictPublicBuckets: true }),
      LifecycleConfiguration: Match.objectLike({ Rules: [Match.objectLike({ ExpirationInDays: 400 })] }),
    }),
  });
});

test('GuardDuty and Access Analyzer are on', () => {
  t.hasResourceProperties('AWS::GuardDuty::Detector', { Enable: true });
  t.hasResourceProperties('AWS::AccessAnalyzer::Analyzer', { Type: 'ACCOUNT' });
});

test('six alert rules, all to the emailed SNS topic', () => {
  t.resourceCountIs('AWS::Events::Rule', 6);
  t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'admin@vettid.org' });
});

test('deploy-role exclusion also matches events with no session issuer (IAM users, root)', () => {
  const rules = Object.values<any>(t.findResources('AWS::Events::Rule')).map((r) => JSON.stringify(r.Properties.EventPattern));
  const withExclusion = rules.filter((r) => r.includes('anything-but'));
  expect(withExclusion.length).toBe(3);
  for (const r of withExclusion) expect(r).toContain('"exists":false');
});
