import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../lib/app';
import { ORG, loadConfig } from '../lib/config';
import { VettidOrgAlertForwardStack } from '../lib/stacks/alert-forward-stack';
import { VettidOrgAuditStack } from '../lib/stacks/audit-stack';

/**
 * EventBridge's limits on a rule, which nothing checks before a deploy:
 * CloudFormation sends `EventPattern` as compact JSON (a deployed rule's
 * stored pattern is byte for byte `JSON.stringify` of the template's
 * object), and EventBridge refuses one longer than 2,048 characters. A
 * refused rule fails and rolls back its whole stack. A pattern that is an
 * "and" of two "or" lists grows as their product when it is written as one
 * list; put the lists at different levels instead (VaultHostProfileLaunch
 * in lib/stacks/audit-stack.ts).
 */
const PATTERN_LIMIT = 2048;
/** Ours, with room for a longer account list or role name. */
const PATTERN_BUDGET = 1800;
const DESCRIPTION_LIMIT = 512;
const INPUT_TEMPLATE_LIMIT = 8192;
const INPUT_PATHS_LIMIT = 100;
const TARGETS_LIMIT = 5;
const RULES_PER_BUS = 300;

type Rule = { stack: string; id: string; properties: any };
const rulesOf = (stack: cdk.Stack): Rule[] =>
  Object.entries<any>(Template.fromStack(stack).findResources('AWS::Events::Rule')).map(([id, r]) => ({ stack: stack.stackName, id, properties: r.Properties }));
/** The pattern as CloudFormation sends it. */
const serialized = (r: Rule) => JSON.stringify(r.properties.EventPattern);
const withPattern = (rules: Rule[]) => rules.filter((r) => r.properties.EventPattern !== undefined);

const app = new cdk.App();
// Both stacks before either is synthesized: a construct tree is fixed by its first synthesis.
const auditStack = new VettidOrgAuditStack(app, 'Audit', { config: loadConfig(app.node), env: { account: ORG.management, region: 'us-east-1' } });
const forwarderStack = new VettidOrgAlertForwardStack(app, 'Fwd', { env: { account: ORG.members.vaultStaging, region: 'us-east-1' } });
const audit = rulesOf(auditStack);
const forwarder = rulesOf(forwarderStack);

describe.each([['VettidOrgAuditStack', audit], ['VettidOrgAlertForwardStack', forwarder]])('%s: every rule fits EventBridge', (_name, rules) => {
  test('there are rules to check', () => {
    expect(withPattern(rules).length).toBeGreaterThan(0);
  });

  test(`event pattern: at most ${PATTERN_BUDGET} characters as sent (EventBridge refuses more than ${PATTERN_LIMIT})`, () => {
    expect(PATTERN_BUDGET).toBeLessThan(PATTERN_LIMIT);
    const lengths = Object.fromEntries(withPattern(rules).map((r) => [r.id, serialized(r).length]));
    expect(Object.entries(lengths).filter(([, n]) => n > PATTERN_BUDGET)).toEqual([]);
  });

  test('event pattern: literal, so that the length measured here is the length deployed', () => {
    // A Ref or Fn::Join inside a pattern is resolved by CloudFormation to a
    // string of another length: give the stack its account and region, or
    // measure differently.
    expect(withPattern(rules).filter((r) => /"(Ref|Fn::[A-Za-z]+)"/.test(serialized(r))).map((r) => r.id)).toEqual([]);
  });

  test('description, targets and input transformer within their limits', () => {
    for (const r of rules) {
      const p = r.properties;
      expect({ id: r.id, description: (p.Description ?? '').length <= DESCRIPTION_LIMIT }).toEqual({ id: r.id, description: true });
      expect({ id: r.id, targets: p.Targets.length <= TARGETS_LIMIT }).toEqual({ id: r.id, targets: true });
      for (const t of p.Targets) {
        if (!t.InputTransformer) continue;
        expect(typeof t.InputTransformer.InputTemplate).toBe('string');
        expect({ id: r.id, template: t.InputTransformer.InputTemplate.length <= INPUT_TEMPLATE_LIMIT }).toEqual({ id: r.id, template: true });
        expect({ id: r.id, paths: Object.keys(t.InputTransformer.InputPathsMap).length <= INPUT_PATHS_LIMIT }).toEqual({ id: r.id, paths: true });
      }
    }
  });

  test('far fewer rules than a bus holds', () => {
    expect(rules.length).toBeLessThan(RULES_PER_BUS / 2);
  });
});

test('the limit is real: the pattern that was refused on deploy (twelve alternatives, the product of two lists) is over it', () => {
  const places = [
    { responseElements: { instancesSet: { items: { iamInstanceProfile: { arn: [{ suffix: ':instance-profile/vettid-org-vault-host' }] } } } } },
    { requestParameters: { iamInstanceProfile: { arn: [{ suffix: ':instance-profile/vettid-org-vault-host' }] } } },
    { requestParameters: { iamInstanceProfile: { name: ['vettid-org-vault-host'] } } },
  ];
  const callers = [
    { userIdentity: { invokedBy: [{ 'anything-but': ['autoscaling.amazonaws.com'] }] } },
    { userIdentity: { invokedBy: [{ exists: false }] } },
    { userIdentity: { sessionContext: { sessionIssuer: { userName: [{ 'anything-but': ['AWSServiceRoleForAutoScaling'] }] } } } },
    { userIdentity: { sessionContext: { sessionIssuer: { userName: [{ exists: false }] } } } },
  ];
  const refused = {
    source: ['aws.ec2'],
    'detail-type': ['AWS API Call via CloudTrail'],
    detail: { eventName: ['RunInstances'], $or: places.flatMap((p) => callers.map((c) => ({ ...p, ...c }))) },
    account: [ORG.members.vaultProd, ORG.members.vaultStaging],
  };
  expect(JSON.stringify(refused).length).toBe(2427);
  expect(JSON.stringify(refused).length).toBeGreaterThan(PATTERN_LIMIT);
  const now = audit.find((r) => r.id.startsWith('VaultHostProfileLaunch'))!;
  expect(serialized(now).length).toBeLessThan(900);
});

// Every other rule the app defines, in both stages. Patterns there may hold
// references (a queue or key ARN), which this counts as written; the two
// stacks above are held to the exact measure.
describe.each([['prod', {}], ['staging', { stage: 'staging' }]])('every stack of the %s app', (_stage, context) => {
  const a = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
  buildApp(a);
  const all = a.node.children.filter((c): c is cdk.Stack => c instanceof cdk.Stack).flatMap(rulesOf);

  test('no event pattern over the budget, no description over the limit', () => {
    expect(all.length).toBeGreaterThan(0);
    expect(withPattern(all).filter((r) => serialized(r).length > PATTERN_BUDGET).map((r) => `${r.stack}/${r.id}`)).toEqual([]);
    expect(all.filter((r) => (r.properties.Description ?? '').length > DESCRIPTION_LIMIT).map((r) => `${r.stack}/${r.id}`)).toEqual([]);
  });
});
