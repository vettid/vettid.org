import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../lib/app';
import { ALERT_FORWARDER_ROLE_NAME, ALERT_FORWARDER_RULE_NAME, ORG } from '../lib/config';
import { MANAGEMENT_BUS_ARN, VettidOrgAlertForwardStack } from '../lib/stacks/alert-forward-stack';
import { matchesPattern } from './event-pattern';

const app = new cdk.App();
const t = Template.fromStack(new VettidOrgAlertForwardStack(app, 'Fwd', { env: { account: ORG.members.proteus, region: 'us-east-1' } }));
const json = t.toJSON();
const rules = Object.values<any>(t.findResources('AWS::Events::Rule'));

test('one forwarding rule, to the management account\'s default bus, through the forwarder role', () => {
  expect(rules).toHaveLength(1);
  const r = rules[0].Properties;
  expect(r.Name).toBe(ALERT_FORWARDER_RULE_NAME);
  expect(MANAGEMENT_BUS_ARN).toBe(`arn:aws:events:us-east-1:${ORG.management}:event-bus/default`);
  expect(r.Targets).toHaveLength(1);
  expect(r.Targets[0].Arn).toBe(MANAGEMENT_BUS_ARN);
  const roleId = Object.keys(t.findResources('AWS::IAM::Role'))[0];
  expect(r.Targets[0].RoleArn).toEqual({ 'Fn::GetAtt': [roleId, 'Arn'] });
});

test('forwarder role: fixed name, assumable only by EventBridge for this account, may only put events on that bus', () => {
  t.resourceCountIs('AWS::IAM::Role', 1);
  t.hasResourceProperties('AWS::IAM::Role', {
    RoleName: ALERT_FORWARDER_ROLE_NAME,
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: { Service: 'events.amazonaws.com' },
          Condition: { StringEquals: { 'aws:SourceAccount': ORG.members.proteus } },
        },
      ],
    },
  });
  const policies = Object.values<any>(t.findResources('AWS::IAM::Policy'));
  expect(policies).toHaveLength(1);
  expect(policies[0].Properties.PolicyDocument.Statement).toEqual([{ Action: 'events:PutEvents', Effect: 'Allow', Resource: MANAGEMENT_BUS_ARN }]);
  expect(JSON.stringify(json)).not.toMatch(/"(AWS|Principal)":"\*"/);
});

describe('what is forwarded', () => {
  const pattern = rules[0].Properties.EventPattern;
  const ct = (detail: Record<string, any>, detailType = 'AWS API Call via CloudTrail') => ({
    'detail-type': detailType,
    source: 'aws.iam',
    account: ORG.members.proteus,
    detail: { eventName: 'X', ...detail },
  });
  test('CloudTrail write calls, including refused ones', () => {
    expect(matchesPattern(pattern, ct({ readOnly: false }))).toBe(true);
    expect(matchesPattern(pattern, ct({ readOnly: false, errorCode: 'AccessDenied' }))).toBe(true);
  });
  test('events without a readOnly field, and console sign-ins', () => {
    expect(matchesPattern(pattern, ct({}))).toBe(true);
    expect(matchesPattern(pattern, ct({ readOnly: false }, 'AWS Console Sign In via CloudTrail'))).toBe(true);
  });
  test('not read-only calls, not GuardDuty findings (the administrator already has them), not other events', () => {
    expect(matchesPattern(pattern, ct({ readOnly: true }))).toBe(false);
    expect(matchesPattern(pattern, { 'detail-type': 'GuardDuty Finding', source: 'aws.guardduty', detail: { severity: 8 } })).toBe(false);
    expect(matchesPattern(pattern, { 'detail-type': 'Scheduled Event', source: 'aws.events', detail: {} })).toBe(false);
  });
});

describe('placement in the app', () => {
  const synth = (context: Record<string, unknown>) => {
    const a = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
    buildApp(a);
    return a.node.children.filter((c): c is cdk.Stack => c instanceof cdk.Stack);
  };
  const forwarders = (stacks: cdk.Stack[]) =>
    stacks.filter((s) => s instanceof VettidOrgAlertForwardStack).map((s) => [s.stackName, s.account, s.dependencies.map((d) => d.stackName)]);

  test('prod: one forwarder in vettid-vault-prod and one in proteus, both after the audit stack', () => {
    expect(forwarders(synth({}))).toEqual([
      ['VettidOrgVaultAlertForwardStack', ORG.members.vaultProd, ['VettidOrgAuditStack']],
      ['VettidOrgProteusAlertForwardStack', ORG.members.proteus, ['VettidOrgAuditStack']],
    ]);
  });
  test('staging: one forwarder in vettid-vault-staging', () => {
    expect(forwarders(synth({ stage: 'staging' }))).toEqual([['VettidOrgVaultAlertForwardStack', ORG.members.vaultStaging, []]]);
  });
});
