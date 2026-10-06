/**
 * Admin route group: membership requests, members, invites.
 *   /admin/requests/*  /admin/members/*  /admin/invites/*
 * Contract: docs/ADMIN-API.md.
 */
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { CreateEmailIdentityCommand, DeleteEmailIdentityCommand, GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { cognito, ddb, env, ses, table } from '../shared/aws';
import { adminHandler } from '../shared/admin-handler';
import { Router, badRequest, conflict, decodeCursor, encodeCursor, int, notFound, str } from '../shared/http';
import { inviteCode, nowIso } from '../shared/ids';
import { emailMarkerKey } from '../shared/members';
import { sendMail } from '../shared/mail';
import { MemberItem, MemberView, SubscriptionItem, toMemberView } from '../shared/model';
import { pushAccountSnapshot } from '../shared/account-snapshot';

const PAGE = 50;
const memberPoolId = () => env('MEMBER_POOL_ID');

// ---- helpers --------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function getMember(guid: string): Promise<MemberItem> {
  // Also keeps email-uniqueness marker rows ("email:<addr>") unreachable.
  if (!UUID_RE.test(guid)) throw notFound('No such member');
  const r = await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: guid } }));
  if (!r.Item) throw notFound('No such member');
  return r.Item as MemberItem;
}

async function subscriptionsFor(guids: string[]): Promise<Map<string, SubscriptionItem>> {
  const out = new Map<string, SubscriptionItem>();
  for (let i = 0; i < guids.length; i += 100) {
    const keys = guids.slice(i, i + 100).map((user_guid) => ({ user_guid }));
    if (!keys.length) continue;
    let req: Record<string, { Keys: Record<string, unknown>[] }> | undefined = { [table.subscriptions()]: { Keys: keys } };
    while (req && Object.keys(req).length) {
      const r = await ddb.send(new BatchGetCommand({ RequestItems: req }));
      for (const s of r.Responses?.[table.subscriptions()] ?? []) out.set(s.user_guid, s as SubscriptionItem);
      req = r.UnprocessedKeys as typeof req;
    }
  }
  return out;
}

async function views(items: MemberItem[]): Promise<MemberView[]> {
  const subs = await subscriptionsFor(items.map((m) => m.user_guid));
  return items.map((m) => toMemberView(m, subs.get(m.user_guid) ?? null));
}

async function view(m: MemberItem): Promise<MemberView> {
  return (await views([m]))[0];
}

/** Conditional state transition; `expect` guards against racing admins. */
async function update(guid: string, expect: Partial<MemberItem>, set: Partial<MemberItem>, remove: string[] = []): Promise<MemberItem> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = Object.entries({ ...set, updated_at: nowIso() }).map(([k, v], i) => {
    names[`#s${i}`] = k;
    values[`:s${i}`] = v;
    return `#s${i} = :s${i}`;
  });
  const conds = Object.entries(expect).map(([k, v], i) => {
    names[`#c${i}`] = k;
    values[`:c${i}`] = v;
    return `#c${i} = :c${i}`;
  });
  const rem = remove.map((k, i) => {
    names[`#r${i}`] = k;
    return `#r${i}`;
  });
  try {
    const r = await ddb.send(
      new UpdateCommand({
        TableName: table.members(),
        Key: { user_guid: guid },
        UpdateExpression: `SET ${sets.join(', ')}${rem.length ? ` REMOVE ${rem.join(', ')}` : ''}`,
        ConditionExpression: ['attribute_exists(user_guid)', ...conds].join(' AND '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return r.Attributes as MemberItem;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw conflict('Member is not in the expected state (refresh and retry)');
    throw e;
  }
}

async function sesVerified(email: string): Promise<boolean | 'missing'> {
  try {
    const r = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
    return r.VerifiedForSendingStatus === true;
  } catch (e) {
    if ((e as Error).name === 'NotFoundException') return 'missing';
    throw e;
  }
}

// ---- requests ---------------------------------------------------------------

const router = new Router();

router.on('GET', '/admin/requests', async ({ query }) => {
  const r = await ddb.send(
    new QueryCommand({
      TableName: table.members(),
      IndexName: 'state-index',
      KeyConditionExpression: '#s = :s',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: { ':s': 'requested' },
      ScanIndexForward: true, // oldest first: work the queue in order
      Limit: PAGE,
      ExclusiveStartKey: decodeCursor(query.cursor),
    }),
  );
  return { items: await views((r.Items ?? []) as MemberItem[]), cursor: encodeCursor(r.LastEvaluatedKey) };
});

router.on('POST', '/admin/requests/{user_guid}/approve', async ({ params, actor }) => {
  const m = await getMember(params.user_guid);
  if (m.state !== 'requested') throw conflict(`Request is ${m.state}, not pending`);
  // Only approve addresses whose owner has proven control (SES verification):
  // otherwise anyone could request membership under someone else's address.
  if (!m.email_verified) {
    if ((await sesVerified(m.email)) !== true) throw conflict('This address has not completed email verification yet');
    await update(m.user_guid, {}, { email_verified: true });
  }
  // Create the Cognito user first: if it fails, the request stays pending.
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: memberPoolId(),
        Username: m.email,
        MessageAction: 'SUPPRESS', // members sign in by magic link; no Cognito email
        UserAttributes: [
          { Name: 'email', Value: m.email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:user_guid', Value: m.user_guid },
        ],
      }),
    );
  } catch (e) {
    if ((e as Error).name !== 'UsernameExistsException') throw e;
  }
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: memberPoolId(), Username: m.email, GroupName: 'registered' }));
  const updated = await update(m.user_guid, { state: 'requested' }, { state: 'registered' });
  await audit(actor, 'request.approve', m.user_guid, { email: m.email });
  return view(updated);
});

router.on('POST', '/admin/requests/{user_guid}/reject', async ({ params, body, actor }) => {
  const reason = str(body, 'reason', { optional: true, max: 500 });
  const m = await getMember(params.user_guid);
  if (m.state !== 'requested') throw conflict(`Request is ${m.state}, not pending`);
  const updated = await update(m.user_guid, { state: 'requested' }, reason ? { state: 'rejected', reject_reason: reason } : { state: 'rejected' });
  await audit(actor, 'request.reject', m.user_guid, { email: m.email, reason });
  return view(updated);
});

router.on('POST', '/admin/requests/{user_guid}/resend-verification', async ({ params, actor }) => {
  const m = await getMember(params.user_guid);
  const status = await sesVerified(m.email);
  if (status === true) {
    if (!m.email_verified) await update(m.user_guid, {}, { email_verified: true });
    throw conflict('That address is already verified');
  }
  // SES has no "resend": recreate the identity to send a fresh verification mail.
  if (status === false) await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: m.email }));
  await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: m.email }));
  await audit(actor, 'request.resend_verification', m.user_guid, { email: m.email });
  return { ok: true };
});

// ---- members ----------------------------------------------------------------

router.on('GET', '/admin/members', async ({ query }) => {
  const states = query.state ? [query.state] : ['member', 'registered'];
  for (const s of states) if (!['registered', 'member'].includes(s)) throw badRequest('state must be registered or member');
  if (query.status && !['active', 'suspended', 'canceled'].includes(query.status)) throw badRequest('Invalid status');
  const q = (query.q ?? '').trim().toLowerCase();

  // Email prefix search: a scan with a filter is acceptable here because it
  // is admin-only and paginated; the member-facing paths never scan.
  if (q) {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table.members(),
        FilterExpression: 'begins_with(email, :q) AND #s IN (:s1, :s2)',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':q': q, ':s1': states[0], ':s2': states[states.length - 1] },
        Limit: 500,
        ExclusiveStartKey: decodeCursor(query.cursor),
      }),
    );
    let items = (r.Items ?? []) as MemberItem[];
    if (query.status) items = items.filter((m) => m.account_status === query.status);
    return { items: await views(items), cursor: encodeCursor(r.LastEvaluatedKey) };
  }

  // Page through each requested state via the state-index (newest first).
  // Cursor carries which state we're on plus the DynamoDB key.
  const cur = decodeCursor(query.cursor) as { i?: number; k?: Record<string, unknown> } | undefined;
  let i = cur?.i ?? 0;
  let startKey = cur?.k;
  const items: MemberItem[] = [];
  while (i < states.length && items.length < PAGE) {
    const r = await ddb.send(
      new QueryCommand({
        TableName: table.members(),
        IndexName: 'state-index',
        KeyConditionExpression: '#s = :s',
        ExpressionAttributeNames: { '#s': 'state', ...(query.status ? { '#a': 'account_status' } : {}) },
        ExpressionAttributeValues: { ':s': states[i], ...(query.status ? { ':a': query.status } : {}) },
        FilterExpression: query.status ? '#a = :a' : undefined,
        ScanIndexForward: false,
        Limit: PAGE - items.length,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((r.Items ?? []) as MemberItem[]));
    if (r.LastEvaluatedKey) {
      startKey = r.LastEvaluatedKey;
      if (items.length >= PAGE) break;
    } else {
      i += 1;
      startKey = undefined;
    }
  }
  const next = i < states.length ? encodeCursor({ i, k: startKey }) : null;
  return { items: await views(items), cursor: next };
});

router.on('GET', '/admin/members/{user_guid}', async ({ params }) => view(await getMember(params.user_guid)));

function requireAccount(m: MemberItem) {
  if (m.state !== 'registered' && m.state !== 'member') throw conflict(`Not an account (state ${m.state})`);
}

router.on('POST', '/admin/members/{user_guid}/suspend', async ({ params, body, actor }) => {
  const reason = str(body, 'reason', { max: 500 });
  const m = await getMember(params.user_guid);
  requireAccount(m);
  if (m.account_status !== 'active') throw conflict(`Account is ${m.account_status}`);
  await cognito.send(new AdminDisableUserCommand({ UserPoolId: memberPoolId(), Username: m.email }));
  await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: memberPoolId(), Username: m.email }));
  const updated = await update(m.user_guid, { account_status: 'active' }, { account_status: 'suspended', suspend_reason: reason });
  await audit(actor, 'member.suspend', m.user_guid, { email: m.email, reason });
  return view(updated);
});

router.on('POST', '/admin/members/{user_guid}/reinstate', async ({ params, actor }) => {
  const m = await getMember(params.user_guid);
  requireAccount(m);
  if (m.account_status === 'active') throw conflict('Account is already active');
  await cognito.send(new AdminEnableUserCommand({ UserPoolId: memberPoolId(), Username: m.email }));
  const updated = await update(m.user_guid, { account_status: m.account_status }, { account_status: 'active' }, ['suspend_reason', 'delete_after']);
  await audit(actor, 'member.reinstate', m.user_guid, { email: m.email, from: m.account_status });
  await pushAccountSnapshot(m.user_guid); // the vault's account snapshot (MEMBER-API 2.0.0)
  return view(updated);
});

router.on('DELETE', '/admin/members/{user_guid}', async ({ params, actor }) => {
  const m = await getMember(params.user_guid);
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: memberPoolId(), Username: m.email }));
  } catch (e) {
    if (!(e instanceof UserNotFoundException) && (e as Error).name !== 'UserNotFoundException') throw e;
  }
  await ddb.send(new DeleteCommand({ TableName: table.subscriptions(), Key: { user_guid: m.user_guid } }));
  await ddb.send(new DeleteCommand({ TableName: table.members(), Key: { user_guid: emailMarkerKey(m.email) } }));
  await ddb.send(new DeleteCommand({ TableName: table.members(), Key: { user_guid: m.user_guid } }));
  // The audit stub keeps who/when, not the person's details beyond the address.
  await audit(actor, 'member.delete', m.user_guid, { email: m.email, state: m.state });
  return { ok: true };
});

router.on('POST', '/admin/members/{user_guid}/clear-pin', async ({ params, actor }) => {
  const m = await getMember(params.user_guid);
  requireAccount(m);
  if (!m.pin_hash) throw conflict('This member has no PIN');
  const updated = await update(m.user_guid, {}, {}, ['pin_hash']);
  await ddb.send(new DeleteCommand({ TableName: env('TABLE_RATELIMITS'), Key: { key: `pinfail#${m.user_guid}` } }));
  await audit(actor, 'member.clear_pin', m.user_guid, { email: m.email });
  try {
    await sendMail(
      m.email,
      'Your VettID sign-in PIN was removed',
      'A VettID administrator removed the PIN from your account at your request. You now sign in with the email link only. ' +
        'You can set a new PIN from your account page.\n\nIf you did not ask for this, contact support@vettid.org right away.\n\n— VettID\n',
    );
  } catch (e) {
    console.error('clear-pin notice failed', (e as Error).name);
  }
  return view(updated);
});

router.on('POST', '/admin/members/{user_guid}/subscription/extend', async ({ params, body, actor }) => {
  const days = int(body, 'days', 1, 366);
  const m = await getMember(params.user_guid);
  const r = await ddb.send(new GetCommand({ TableName: table.subscriptions(), Key: { user_guid: m.user_guid } }));
  const sub = r.Item as SubscriptionItem | undefined;
  if (!sub) throw conflict('Member has no subscription to extend');
  const base = Math.max(Date.now(), new Date(sub.expires_at).getTime());
  const expires_at = new Date(base + days * 86_400_000).toISOString();
  const status = sub.status === 'expired' || sub.status === 'canceled' ? (sub.paid ? 'active' : 'trial') : sub.status;
  await ddb.send(new PutCommand({ TableName: table.subscriptions(), Item: { ...sub, expires_at, status } }));
  await audit(actor, 'subscription.extend', m.user_guid, { days, from: sub.expires_at, to: expires_at });
  await pushAccountSnapshot(m.user_guid); // the vault's account snapshot (MEMBER-API 2.0.0)
  return view(m);
});

// ---- invites ----------------------------------------------------------------

interface InviteItem {
  code: string;
  note: string;
  max_uses: number;
  uses: number;
  expired: boolean;
  expires_at: string;
  created_at: string;
  created_by: string;
}

const inviteView = (i: InviteItem) => ({
  code: i.code,
  note: i.note,
  max_uses: i.max_uses,
  uses: i.uses,
  status: i.expired || new Date(i.expires_at) <= new Date() ? 'expired' : i.uses >= i.max_uses ? 'exhausted' : 'active',
  expires_at: i.expires_at,
  created_at: i.created_at,
  created_by: i.created_by,
});

router.on('GET', '/admin/invites', async ({ query }) => {
  // Invites are few (admin-created); a paginated scan is fine.
  const r = await ddb.send(new ScanCommand({ TableName: table.invites(), Limit: 100, ExclusiveStartKey: decodeCursor(query.cursor) }));
  const items = ((r.Items ?? []) as InviteItem[]).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(inviteView);
  return { items, cursor: encodeCursor(r.LastEvaluatedKey) };
});

router.on('POST', '/admin/invites', async ({ body, actor }) => {
  const max_uses = int(body, 'max_uses', 1, 1000);
  const days = int(body, 'expires_in_days', 1, 365);
  const note = str(body, 'note', { optional: true, max: 200 });
  const now = nowIso();
  const item: InviteItem = {
    code: inviteCode(),
    note,
    max_uses,
    uses: 0,
    expired: false,
    expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
    created_at: now,
    created_by: actor,
  };
  await ddb.send(new PutCommand({ TableName: table.invites(), Item: item, ConditionExpression: 'attribute_not_exists(code)' }));
  await audit(actor, 'invite.create', item.code, { max_uses, expires_at: item.expires_at, note });
  return inviteView(item);
});

router.on('POST', '/admin/invites/{code}/expire', async ({ params, actor }) => {
  try {
    const r = await ddb.send(
      new UpdateCommand({
        TableName: table.invites(),
        Key: { code: params.code },
        UpdateExpression: 'SET expired = :t',
        ConditionExpression: 'attribute_exists(code)',
        ExpressionAttributeValues: { ':t': true },
        ReturnValues: 'ALL_NEW',
      }),
    );
    await audit(actor, 'invite.expire', params.code);
    return inviteView(r.Attributes as InviteItem);
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw notFound('No such invite');
    throw e;
  }
});

router.on('DELETE', '/admin/invites/{code}', async ({ params, actor }) => {
  await ddb.send(new DeleteCommand({ TableName: table.invites(), Key: { code: params.code } }));
  await audit(actor, 'invite.delete', params.code);
  return { ok: true };
});

export const handler = adminHandler(router);
