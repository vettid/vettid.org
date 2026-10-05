/**
 * Custom resource: makes staging's test-mail receipt rule set the ACTIVE one
 * (VettidOrgStageTestMailStack; RUNBOOK "Test mail"). SES has one active
 * receipt rule set per account and region, and CloudFormation cannot
 * activate one.
 *
 * - Create/Update: refuses if ANOTHER rule set is active (activating ours
 *   would silently switch off that one's mail); otherwise activates ours.
 * - Delete: deactivates, but only if ours is the active one (so the rule
 *   set can then be deleted); anything else is left alone.
 *
 * The handler never throws: every outcome is reported to CloudFormation.
 */
import { DescribeActiveReceiptRuleSetCommand, SESClient, SetActiveReceiptRuleSetCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({});

interface CfnEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: Record<string, unknown>;
  OldResourceProperties?: Record<string, unknown>;
}

export type Step = 'activate' | 'deactivate' | 'none';

/**
 * What to do, given the request and the currently active rule set
 * (undefined: none). Throws to refuse.
 */
export function decide(type: CfnEvent['RequestType'], ours: string, previous: string | undefined, active: string | undefined): Step {
  if (type === 'Delete') return active === ours ? 'deactivate' : 'none';
  if (active === ours) return 'none';
  if (active !== undefined && active !== previous) {
    throw new Error(
      `receipt rule set "${active}" is active in this account and region; SES allows only one active set. ` +
        `Refusing to replace it: move its rules into "${ours}" or deactivate it first (RUNBOOK "Test mail").`,
    );
  }
  return 'activate';
}

async function respond(event: CfnEvent, status: 'SUCCESS' | 'FAILED', physicalId: string, reason: string): Promise<void> {
  const body = JSON.stringify({
    Status: status,
    Reason: reason.slice(0, 1000),
    PhysicalResourceId: physicalId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {},
  });
  const res = await fetch(event.ResponseURL, { method: 'PUT', headers: { 'content-type': '' }, body });
  if (!res.ok) console.error(JSON.stringify({ msg: 'cfn response failed', status: res.status }));
}

export async function handler(event: CfnEvent): Promise<void> {
  let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';
  let reason = '';
  const ours = String(event.ResourceProperties.RuleSetName ?? '');
  // A failed create leaves this physical id; its delete must do nothing.
  let physicalId = event.PhysicalResourceId ?? `failed-${event.RequestId}`;
  try {
    if (!ours) throw new Error('missing property RuleSetName');
    if (event.RequestType === 'Delete' && physicalId.startsWith('failed-')) {
      // nothing was activated
    } else {
      const active = (await ses.send(new DescribeActiveReceiptRuleSetCommand({}))).Metadata?.Name || undefined;
      const previous = event.OldResourceProperties?.RuleSetName ? String(event.OldResourceProperties.RuleSetName) : undefined;
      const step = decide(event.RequestType, ours, previous, active);
      if (step === 'activate') await ses.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: ours }));
      // RuleSetName omitted: no active rule set.
      if (step === 'deactivate') await ses.send(new SetActiveReceiptRuleSetCommand({}));
      console.log(JSON.stringify({ msg: 'receipt rule set', request: event.RequestType, ruleSet: ours, previouslyActive: active ?? null, step }));
      if (event.RequestType !== 'Delete') physicalId = `active-receipt-rule-set:${ours}`;
    }
  } catch (err) {
    status = 'FAILED';
    reason = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ msg: 'receipt rule set failed', reason }));
  }
  await respond(event, status, physicalId, reason);
}
