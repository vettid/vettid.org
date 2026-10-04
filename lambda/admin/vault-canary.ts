/**
 * Admin route group: vault canary testers.
 *   /admin/vault-canary  /admin/vault-canary/{user_guid}
 * Contract: docs/ADMIN-API.md "Vault canary".
 *
 * A canary tester is a member whose row has `vault_canary: true`; the member
 * API routes `canary` vault releases (unpublished builds under test,
 * VAULT-RELEASES §10.1 step 9, §11.3) only for them (lambda/member/vault.ts,
 * MEMBER-API "Canary releases").
 *
 * This is its own Lambda (not part of `people`) so that its role can update
 * a member row only in `vault_canary` / `updated_at` (IAM
 * dynamodb:Attributes, lib/stacks/admin-api-stack.ts). Every UpdateItem
 * here must therefore name no other attribute, including in its condition.
 */
import { GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { ddb, table } from '../shared/aws';
import { adminHandler } from '../shared/admin-handler';
import { Router, conflict, decodeCursor, encodeCursor, notFound } from '../shared/http';
import { nowIso } from '../shared/ids';
import { isCanaryMember } from '../shared/vault-routing';
import type { MemberItem } from '../shared/model';

const PAGE = 50;
const SCAN_PAGES = 10; // bound one list call's work; the cursor resumes the scan
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What the admin API shows for a member's canary flag. */
export interface CanaryView {
  user_guid: string;
  email: string;
  first_name: string;
  last_name: string;
  state: MemberItem['state'];
  account_status: MemberItem['account_status'];
  vault_canary: boolean;
  /** Whether the flag may be set now (state `member`). */
  eligible: boolean;
}

const canaryView = (m: MemberItem): CanaryView => ({
  user_guid: m.user_guid,
  email: m.email,
  first_name: m.first_name,
  last_name: m.last_name,
  state: m.state,
  account_status: m.account_status,
  vault_canary: isCanaryMember(m),
  eligible: m.state === 'member',
});

async function getMember(guid: string): Promise<MemberItem> {
  // Also keeps email-uniqueness marker rows ("email:<addr>") unreachable.
  if (!UUID_RE.test(guid)) throw notFound('No such member');
  const r = await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: guid } }));
  if (!r.Item) throw notFound('No such member');
  return r.Item as MemberItem;
}

/**
 * Set or clear the flag. Names only user_guid, vault_canary and updated_at
 * (the IAM attribute limit); the row must still exist, so a member deleted
 * since the read is not recreated as a stub.
 */
async function writeFlag(guid: string, on: boolean): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.members(),
        Key: { user_guid: guid },
        UpdateExpression: on ? 'SET #v = :t, #u = :now' : 'SET #u = :now REMOVE #v',
        ConditionExpression: 'attribute_exists(#k)',
        ExpressionAttributeNames: { '#k': 'user_guid', '#v': 'vault_canary', '#u': 'updated_at' },
        ExpressionAttributeValues: on ? { ':t': true, ':now': nowIso() } : { ':now': nowIso() },
        ReturnValues: 'NONE',
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw notFound('No such member');
    throw e;
  }
}

const router = new Router();

// Canary testers are a handful of flagged rows: a filtered scan of the
// members table (admin-only, paginated) rather than an index of its own.
router.on('GET', '/admin/vault-canary', async ({ query }) => {
  let startKey = decodeCursor(query.cursor);
  const items: MemberItem[] = [];
  for (let i = 0; i < SCAN_PAGES && items.length < PAGE; i++) {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table.members(),
        FilterExpression: '#v = :t',
        ExpressionAttributeNames: { '#v': 'vault_canary' },
        ExpressionAttributeValues: { ':t': true },
        Limit: 500,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((r.Items ?? []) as MemberItem[]));
    startKey = r.LastEvaluatedKey;
    if (!startKey) break;
  }
  items.sort((a, b) => a.email.localeCompare(b.email));
  return { items: items.map(canaryView), cursor: encodeCursor(startKey) };
});

router.on('GET', '/admin/vault-canary/{user_guid}', async ({ params }) => canaryView(await getMember(params.user_guid)));

router.on('POST', '/admin/vault-canary/{user_guid}', async ({ params, actor }) => {
  const m = await getMember(params.user_guid);
  if (m.state !== 'member') throw conflict(`Only members can test canary vault releases (state ${m.state})`);
  if (isCanaryMember(m)) throw conflict('This member is already a vault canary tester');
  await writeFlag(m.user_guid, true);
  await audit(actor, 'member.vault_canary.set', m.user_guid, { email: m.email });
  return canaryView({ ...m, vault_canary: true });
});

router.on('DELETE', '/admin/vault-canary/{user_guid}', async ({ params, actor }) => {
  const m = await getMember(params.user_guid);
  // Clearing is allowed in any state: never leave a stray flag behind.
  if (m.vault_canary === undefined) throw conflict('This member is not a vault canary tester');
  await writeFlag(m.user_guid, false);
  await audit(actor, 'member.vault_canary.clear', m.user_guid, { email: m.email, was: m.vault_canary });
  return canaryView({ ...m, vault_canary: undefined });
});

export const handler = adminHandler(router);
