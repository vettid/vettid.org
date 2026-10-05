import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../lib/app';
import { loadConfig } from '../lib/config';
import { VettidOrgCiReadOnlyStack } from '../lib/stacks/ci-readonly-stack';

const app = new cdk.App();
const t = Template.fromStack(new VettidOrgCiReadOnlyStack(app, 'Ci', {
  config: loadConfig(app.node),
  env: { account: '449757308783', region: 'us-east-1' },
}));

test('GitHub OIDC provider, audience sts.amazonaws.com only', () => {
  t.resourceCountIs('AWS::IAM::OIDCProvider', 1);
  t.hasResourceProperties('AWS::IAM::OIDCProvider', {
    Url: 'https://token.actions.githubusercontent.com',
    ClientIdList: ['sts.amazonaws.com'],
  });
});

test('trust: exactly this repo on master, via the OIDC provider, no wildcards', () => {
  const roles = Object.values<any>(t.findResources('AWS::IAM::Role'));
  expect(roles).toHaveLength(1);
  const role = roles[0].Properties;
  expect(role.RoleName).toBe('vettid-org-ci-drift-readonly');
  expect(role.MaxSessionDuration).toBe(3600);
  const statements = role.AssumeRolePolicyDocument.Statement;
  expect(statements).toHaveLength(1);
  expect(statements[0]).toEqual({
    Effect: 'Allow',
    Action: 'sts:AssumeRoleWithWebIdentity',
    Principal: { Federated: { Ref: expect.stringMatching(/^GitHubOidc/) } },
    Condition: {
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        'token.actions.githubusercontent.com:sub': 'repo:vettid/vettid.org:ref:refs/heads/master',
      },
    },
  });
  // No managed policies (e.g. ReadOnlyAccess, which can read data).
  expect(role.ManagedPolicyArns).toBeUndefined();
});

test('permissions: list stacks and read our templates, nothing else', () => {
  const policies = Object.values<any>(t.findResources('AWS::IAM::Policy'));
  expect(policies).toHaveLength(1);
  const statements = policies[0].Properties.PolicyDocument.Statement;
  expect(statements).toEqual([
    { Sid: 'ListStacks', Effect: 'Allow', Action: 'cloudformation:ListStacks', Resource: '*' },
    {
      Sid: 'ReadOurTemplates',
      Effect: 'Allow',
      Action: 'cloudformation:GetTemplate',
      Resource: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':cloudformation:us-east-1:449757308783:stack/Vettid*']] },
    },
  ]);
  for (const s of statements) {
    for (const a of [s.Action].flat()) {
      expect(a).toMatch(/^cloudformation:(List|Get|Describe)[A-Za-z]+$/);
      expect(a).not.toContain('*');
    }
  }
});

test('the prod app has one in each production account, none in staging', () => {
  const synth = (context: Record<string, string>) => {
    // No Lambda bundling: only the stack list matters here.
    const a = new cdk.App({ context: { headscaleLoginServer: 'https://headscale.example.net', 'aws:cdk:bundling-stacks': [], ...context } });
    buildApp(a);
    return a.node.children
      .filter((c): c is VettidOrgCiReadOnlyStack => c instanceof VettidOrgCiReadOnlyStack)
      .map((s) => `${s.stackName}@${s.account}`);
  };
  expect(synth({}).sort()).toEqual(['VettidOrgCiReadOnlyStack@449757308783', 'VettidOrgVaultCiReadOnlyStack@369484479783']);
  expect(synth({ stage: 'staging' })).toEqual([]);
});
