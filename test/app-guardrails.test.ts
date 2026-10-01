import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../lib/app';

/**
 * Whole-app guardrails. These encode the lessons from vettid-dev, whose CDK
 * became unmanageable (stacks split by resource count, export locks,
 * destroyable user pools). See docs/ACCOUNT-ADMIN-PLAN.md §3.1.
 */

// Well under CloudFormation's 500 limit. A stack nearing this is doing too
// much — split it by domain, or fold routes into a route group.
const MAX_RESOURCES_PER_STACK = 200;

// The pre-existing public-site stacks wire each other through props (and so
// CloudFormation exports). Every stack added after them must use SSM refs.
const STACKS_ALLOWED_TO_IMPORT = new Set(['VettidOrgStack', 'VettidOrgSignupStack']);

// Resource types holding state that must survive a stack delete or replacement.
const STATEFUL_TYPES = ['AWS::DynamoDB::Table', 'AWS::DynamoDB::GlobalTable', 'AWS::Cognito::UserPool'];

function synthAll(): cdk.Stack[] {
  const prev = process.env.CDK_DEFAULT_ACCOUNT;
  process.env.CDK_DEFAULT_ACCOUNT = '123456789012';
  try {
    const app = new cdk.App({ context: { headscaleLoginServer: 'https://headscale.example.net' } });
    buildApp(app);
    return app.node.children.filter((c): c is cdk.Stack => c instanceof cdk.Stack);
  } finally {
    if (prev === undefined) delete process.env.CDK_DEFAULT_ACCOUNT;
    else process.env.CDK_DEFAULT_ACCOUNT = prev;
  }
}

describe('app guardrails', () => {
  const stacks = synthAll();
  const templates = stacks.map((s) => ({ name: s.stackName, json: Template.fromStack(s).toJSON() }));

  test('app synthesizes the expected stacks', () => {
    expect(templates.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'VettidOrgDnsStack',
        'VettidOrgSignupStack',
        'VettidOrgPlaybooksStack',
        'VettidOrgStack',
        'VettidDevRedirectStack',
        'VettidOrgAuthStack',
        'VettidOrgDataStack',
        'VettidOrgAdminAccessStack',
      ]),
    );
  });

  test.each(templates.map((t) => [t.name, t.json]))('%s stays under the resource budget', (_name, json) => {
    expect(Object.keys(json.Resources ?? {}).length).toBeLessThanOrEqual(MAX_RESOURCES_PER_STACK);
  });

  test.each(templates.map((t) => [t.name, t.json]))('%s uses no CloudFormation imports unless grandfathered', (name, json) => {
    if (STACKS_ALLOWED_TO_IMPORT.has(name)) return;
    expect(JSON.stringify(json)).not.toContain('Fn::ImportValue');
  });

  test.each(templates.map((t) => [t.name, t.json]))('%s retains every stateful resource', (_name, json) => {
    for (const [id, res] of Object.entries<any>(json.Resources ?? {})) {
      if (STATEFUL_TYPES.includes(res.Type)) {
        expect({ id, policy: res.DeletionPolicy }).toEqual({ id, policy: 'Retain' });
        expect({ id, policy: res.UpdateReplacePolicy }).toEqual({ id, policy: 'Retain' });
      }
    }
  });
});
