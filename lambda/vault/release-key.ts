/**
 * Custom resource: one release sealing key (docs/VAULT-RELEASES.md §6.2).
 *
 * - Create: checks the rendered policy against the enclave's §11.10.7 rules
 *   (lambda/shared/keypolicy.ts) and the pinned constants, then CreateKey
 *   with exactly that policy and BypassPolicyLockoutSafetyCheck (the policy
 *   has no administrator statement on purpose). Symmetric, AWS_KMS origin,
 *   single-region, tags given at creation, no alias.
 * - Update: refused. A release key is immutable; CloudFormation sends an
 *   update only when the properties changed. The physical id carries a hash
 *   of the properties the key was created with, so a rollback to them (or a
 *   change of the service token alone) succeeds and anything else fails.
 * - Delete: nothing. The key outlives the stack; only retirement ends it
 *   (ScheduleKeyDeletion by the retirement role, with the pinned window).
 *
 * The handler never throws: every outcome is reported to CloudFormation,
 * and asynchronous retries are off, so a key is never created twice.
 */
import { createHash } from 'node:crypto';
import { CreateKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { checkPolicy, ManifestRelease } from '../shared/keypolicy';

const kms = new KMSClient({});

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

interface Props {
  Release: string;
  Channel: string;
  Account: string;
  Region: string;
  Pcr0: string;
  AdmittedPcr0s: string[];
  RetirementWindowDays: string;
  Policy: string;
  Description: string;
}

const WINDOW: Record<string, string> = { prod: '30', staging: '7' };

/** Properties without the service token, canonically serialized. */
export function propsHash(props: Record<string, unknown>): string {
  const { ServiceToken: _t, ServiceTimeout: _s, ...rest } = props;
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canon(rest))).digest('hex');
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || v === '') throw new Error(`missing property ${name}`);
  return v;
}

export function parseProps(raw: Record<string, unknown>): Props {
  const admitted = raw.AdmittedPcr0s ?? [];
  if (!Array.isArray(admitted) || !admitted.every((a) => typeof a === 'string')) throw new Error('AdmittedPcr0s must be a list of strings');
  return {
    Release: str(raw.Release, 'Release'),
    Channel: str(raw.Channel, 'Channel'),
    Account: str(raw.Account, 'Account'),
    Region: str(raw.Region, 'Region'),
    Pcr0: str(raw.Pcr0, 'Pcr0'),
    AdmittedPcr0s: admitted as string[],
    RetirementWindowDays: str(String(raw.RetirementWindowDays ?? ''), 'RetirementWindowDays'),
    Policy: str(raw.Policy, 'Policy'),
    Description: str(raw.Description, 'Description'),
  };
}

/**
 * Everything checked before CreateKey: the pinned account, region, roles
 * and window, and the policy under the enclave's own rules for a manifest
 * holding this release and the admitted ones.
 */
export function preflight(p: Props, env: { account: string; region: string; hostRoleArn: string; retirementRoleArn: string }): void {
  const n = Number(p.Release);
  if (!/^[1-9][0-9]*$/.test(p.Release) || !Number.isSafeInteger(n)) throw new Error('Release must be a positive integer');
  if (p.Account !== env.account) throw new Error(`Account ${p.Account} is not this account (${env.account})`);
  if (p.Region !== env.region) throw new Error(`Region ${p.Region} is not this region (${env.region})`);
  if (WINDOW[p.Channel] === undefined || WINDOW[p.Channel] !== p.RetirementWindowDays) {
    throw new Error(`channel ${p.Channel} needs retirement window ${WINDOW[p.Channel] ?? '?'} days`);
  }
  const placeholder = `arn:aws:kms:${env.region}:${env.account}:key/00000000-0000-4000-8000-000000000000`;
  const target: ManifestRelease = { number: n, pcr0: p.Pcr0, sealKey: placeholder };
  const releases: ManifestRelease[] = [target, ...p.AdmittedPcr0s.map((pcr0, i) => ({ number: n - 1 - i, pcr0, sealKey: '' }))];
  checkPolicy(p.Policy, { keyArn: placeholder, account: env.account, releases, retirementPrincipal: env.retirementRoleArn, retirementWindowDays: Number(p.RetirementWindowDays) }, target);
  // The policy must name exactly the stack's host role (check 8 only pins the account).
  // The policy must name exactly the stack's host and retirement roles
  // (check 8 only pins the account, and a policy without retirement
  // statements would pass the check but leave the key undeletable).
  if (!p.Policy.includes(JSON.stringify(env.hostRoleArn))) throw new Error('policy does not name the host role');
  if (!p.Policy.includes('"kms:ScheduleKeyDeletion"') || !p.Policy.includes(JSON.stringify(env.retirementRoleArn))) {
    throw new Error('policy has no retirement statement for the retirement role');
  }
}

async function respond(event: CfnEvent, status: 'SUCCESS' | 'FAILED', physicalId: string, reason: string, data: Record<string, string>): Promise<void> {
  const body = JSON.stringify({
    Status: status,
    Reason: reason.slice(0, 1000),
    PhysicalResourceId: physicalId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data,
  });
  const res = await fetch(event.ResponseURL, { method: 'PUT', headers: { 'content-type': '' }, body });
  if (!res.ok) console.error(JSON.stringify({ msg: 'cfn response failed', status: res.status }));
}

export async function handler(event: CfnEvent, context: { invokedFunctionArn: string }): Promise<void> {
  let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';
  let reason = '';
  let physicalId = event.PhysicalResourceId ?? `failed-${event.RequestId}`;
  let data: Record<string, string> = {};
  try {
    const hash = propsHash(event.ResourceProperties);
    if (event.RequestType === 'Create') {
      const p = parseProps(event.ResourceProperties);
      const env = {
        account: context.invokedFunctionArn.split(':')[4],
        region: process.env.AWS_REGION ?? '',
        hostRoleArn: process.env.HOST_ROLE_ARN ?? '',
        retirementRoleArn: process.env.RETIREMENT_ROLE_ARN ?? '',
      };
      preflight(p, env);
      const out = await kms.send(
        new CreateKeyCommand({
          Policy: p.Policy,
          BypassPolicyLockoutSafetyCheck: true,
          KeySpec: 'SYMMETRIC_DEFAULT',
          KeyUsage: 'ENCRYPT_DECRYPT',
          Origin: 'AWS_KMS',
          MultiRegion: false,
          Description: p.Description,
          Tags: [
            { TagKey: 'vettid:release', TagValue: p.Release },
            { TagKey: 'vettid:channel', TagValue: p.Channel },
          ],
        }),
      );
      const arn = out.KeyMetadata?.Arn;
      if (!arn) throw new Error('CreateKey returned no ARN');
      physicalId = `${arn}|${hash}`;
      data = { KeyArn: arn, KeyId: out.KeyMetadata?.KeyId ?? '' };
      console.log(JSON.stringify({ msg: 'release key created', release: p.Release, channel: p.Channel, keyArn: arn }));
    } else if (event.RequestType === 'Update') {
      const [arn, created] = (event.PhysicalResourceId ?? '').split('|');
      if (!arn.startsWith('arn:aws:kms:') || created !== hash) {
        throw new Error('release keys are immutable: add a new release instead of changing this one (VAULT-RELEASES §6.2)');
      }
      data = { KeyArn: arn, KeyId: arn.split('/')[1] ?? '' };
    }
    // Delete: nothing. The key is retired, never deleted with the stack.
  } catch (e) {
    status = 'FAILED';
    reason = e instanceof Error ? e.message : 'failed';
    console.error(JSON.stringify({ msg: 'release key request failed', type: event.RequestType, reason }));
  }
  try {
    await respond(event, status, physicalId, reason, data);
  } catch (e) {
    console.error(JSON.stringify({ msg: 'cfn response error', error: String(e) }));
  }
}
