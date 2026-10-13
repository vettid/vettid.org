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
  AdminGetUserCommand,
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
import { HttpError } from '../shared/http';
import { inviteCode, nowIso } from '../shared/ids';
import { emailMarkerKey } from '../shared/members';
import { sendMail } from '../shared/mail';
import { MemberItem, MemberView, SubscriptionItem, toMemberView } from '../shared/model';
import { pushAccountSnapshot } from '../shared/account-snapshot';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { StartOverCancel } from '../jobs/cleanup';

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

/** Approve, when Cognito already holds a user for the address under another account id (ADMIN-API "Requests"). */
export const STALE_USER_MESSAGE =
  'Not approved: a sign-in user from an earlier request or account already exists for this address. ' +
  'Nothing was changed. An operator has to remove that user first (RUNBOOK "Membership requests", "Removal by hand"), then approve again.';

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
  // A flag that lags behind SES is set below, in the same write as the state:
  // on its own it would make the row a verified pending request for a moment,
  // and the members-stream mailer would send "We have your request" (with a
  // link that is dead once approved) seconds before "Your account is ready".
  const verifyNow = !m.email_verified;
  if (verifyNow && (await sesVerified(m.email)) !== true) throw conflict('This address has not completed email verification yet');
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
    // A user under this address is already there. It is this request's own
    // (an approval that stopped half-way) only if it carries this request's
    // id. One with another id was left by an earlier request or account for
    // the same address (a removal given up on, `request.removal_incomplete`):
    // approving over it would make an account that cannot sign in, since the
    // session's id would name a row that no longer exists. Refuse instead.
    const u = await cognito.send(new AdminGetUserCommand({ UserPoolId: memberPoolId(), Username: m.email }));
    if (u.UserAttributes?.find((a) => a.Name === 'custom:user_guid')?.Value !== m.user_guid) {
      console.error('approve refused: the sign-in user under this address carries another id', JSON.stringify({ user_guid: m.user_guid })); // never the address
      throw conflict(STALE_USER_MESSAGE);
    }
  }
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: memberPoolId(), Username: m.email, GroupName: 'registered' }));
  // An approved request is an account: its withdrawal link stops working
  // here (MEMBER-API 2.6.0; the public route also refuses any state but
  // requested and rejected).
  const updated = await update(
    m.user_guid,
    { state: 'requested' },
    verifyNow ? { state: 'registered', email_verified: true } : { state: 'registered' },
    ['withdraw_token_hash'],
  );
  await audit(actor, 'request.approve', m.user_guid, { email: m.email });
  return view(updated);
});

router.on('POST', '/admin/requests/{user_guid}/reject', async ({ params, body, actor }) => {
  const reason = str(body, 'reason', { optional: true, max: 500 });
  const m = await getMember(params.user_guid);
  if (m.state !== 'requested') throw conflict(`Request is ${m.state}, not pending`);
  // rejected_at starts the 30 days after which the cleanup job deletes the
  // request (MEMBER-API 2.6.0 "Retention"); the withdrawal link keeps working.
  const rejected_at = nowIso();
  const updated = await update(
    m.user_guid,
    { state: 'requested' },
    reason ? { state: 'rejected', rejected_at, reject_reason: reason } : { state: 'rejected', rejected_at },
  );
  await audit(actor, 'request.reject', m.user_guid, { email: m.email, reason });
  return view(updated);
});

router.on('POST', '/admin/requests/{user_guid}/resend-verification', async ({ params, actor }) => {
  const m = await getMember(params.user_guid);
  if (m.state === 'withdrawn') throw conflict('This request was withdrawn');
  const status = await sesVerified(m.email);
  if (status === true) {
    if (!m.email_verified) await update(m.user_guid, {}, { email_verified: true });
    throw conflict('That address is already verified');
  }
  // SES has no "resend": recreate the identity to send a fresh verification mail.
  if (status === false) await ses.send(new DeleteEmailIdentityCommand({ EmailIdentity: m.email }));
  await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: m.email }));
  // The identity that exists now was created for this row (MEMBER-API 2.6.0:
  // only such an identity is deleted with a withdrawn or expired request).
  // (Not through update(): updated_at, which the 14-day reclaim reads, stays.)
  if (m.owns_identity !== true) {
    await ddb.send(
      new UpdateCommand({
        TableName: table.members(),
        Key: { user_guid: m.user_guid },
        UpdateExpression: 'SET owns_identity = :t',
        ConditionExpression: 'attribute_exists(user_guid)',
        ExpressionAttributeValues: { ':t': true },
      }),
    );
  }
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

// ---- a member's pending vault deletion ("Delete my vault and start over") -------------

const lambdaClient = new LambdaClient({});

/**
 * Ask the member API's start-over cancel function to cancel the member's
 * pending vault deletion (its task `cancel_start_over`; it runs under the
 * cleanup job's role and does nothing else). This function holds no right
 * on the vault tables; that one removes the record only while it is still
 * `pending`. Anything but its own well-formed answer is an error: the
 * caller then reports nothing as cancelled and goes no further.
 */
async function requestDeletionCancel(userGuid: string): Promise<StartOverCancel> {
  const out = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: env('START_OVER_CANCEL_FN'),
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ task: 'cancel_start_over', user_guid: userGuid })),
    }),
  );
  let r: Partial<StartOverCancel> | null = null;
  try {
    r = out.FunctionError || !out.Payload ? null : (JSON.parse(Buffer.from(out.Payload).toString('utf8')) as Partial<StartOverCancel>);
  } catch {
    r = null;
  }
  if (
    !r || r.ok !== true || r.task !== 'cancel_start_over' ||
    !Array.isArray(r.cancelled) || !Array.isArray(r.executing) || !Array.isArray(r.recoveries) || typeof r.changed !== 'number'
  ) {
    console.error('vault deletion cancel: the cancel function did not answer as expected', JSON.stringify({ user_guid: userGuid, function_error: out.FunctionError ?? null }));
    throw new Error('vault deletion cancel failed');
  }
  return r as StartOverCancel;
}

const epochIso = (s: number | null): string | null => (typeof s === 'number' ? new Date(s * 1000).toISOString() : null);

/**
 * Cancel the member's pending vault deletion, audit it and tell the member.
 * `on: 'reinstate'` marks the cancel that a reinstatement makes. The email
 * says only what is true whatever happens next (a reinstatement can still
 * fail, or wait for the admin's answer about a recovery). `409` if the
 * record changed while it was being cancelled (the member cancelled it, or
 * it was just carried out): the admin repeats the call and sees which.
 *
 * The record is removed before the audit event is written. If that write
 * fails the caller answers 500 although the deletion is cancelled; the
 * cancel function's own log line (`startOverCancel`, with the ids) is then
 * the record, and a repeat answers "nothing pending".
 */
async function cancelVaultDeletion(m: MemberItem, actor: string, on?: 'reinstate'): Promise<StartOverCancel> {
  const r = await requestDeletionCancel(m.user_guid);
  for (const c of r.cancelled) {
    await audit(actor, 'member.vault_deletion_cancel', m.user_guid, { email: m.email, vault_id: c.vault_id, deletion_id: c.deletion_id, ...(on ? { on } : {}) });
  }
  if (r.cancelled.length) {
    const when = epochIso(r.cancelled[0].requested_at);
    try {
      await sendMail(
        m.email,
        'VettID vault deletion cancelled',
        `The deletion of your VettID vault${when ? ` requested at ${when}` : ''} has been cancelled by VettID support. ` +
          'Your vault and everything in it stay as they are.\n\n' +
          'If you still want to delete your vault and start over, ask again on your account page; the 24 hours then start again.\n\n' +
          'If you did not ask for the deletion, secure your email account, and contact support@vettid.org if anything else looks wrong.\n\n— VettID\n',
      );
    } catch (e) {
      console.error('vault deletion cancel notice failed', (e as Error).name);
    }
  }
  if (r.changed) throw conflict('The vault deletion changed while it was being cancelled (refresh and retry)');
  return r;
}

/**
 * Suspend. The status is written first (as the member's own cancellation
 * does, lambda/member/account.ts): from that write on the account cannot
 * sign in (the sign-in trigger reads the row) and the cleanup job carries
 * out no vault deletion for it, whatever happens to the two Cognito calls
 * after it. If one of them fails, Suspend answers an error with the account
 * already suspended, and a repeat finishes the rest: for an account that is
 * already suspended it makes the two calls again (both are safe to repeat)
 * and writes the event, without changing the stored reason; that event
 * carries `repeat: true`, because its `reason` is the one typed now and the
 * row keeps the first one. Until a suspension has its `member.suspend`
 * event it may be half done: the row says suspended, but sign-in may not be
 * disabled and the sessions may not be ended. Such a session reaches only
 * lock and the two cancels (every other account and vault route reads the
 * row), and Reinstate ends the sessions itself before it enables sign-in.
 */
router.on('POST', '/admin/members/{user_guid}/suspend', async ({ params, body, actor }) => {
  const reason = str(body, 'reason', { max: 500 });
  const m = await getMember(params.user_guid);
  requireAccount(m);
  if (m.account_status !== 'active' && m.account_status !== 'suspended') throw conflict(`Account is ${m.account_status}`);
  const updated = m.account_status === 'active'
    ? await update(m.user_guid, { account_status: 'active' }, { account_status: 'suspended', suspend_reason: reason })
    : m;
  await cognito.send(new AdminDisableUserCommand({ UserPoolId: memberPoolId(), Username: m.email }));
  await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: memberPoolId(), Username: m.email }));
  await audit(actor, 'member.suspend', m.user_guid, { email: m.email, reason, ...(m.account_status === 'suspended' ? { repeat: true } : {}) });
  return view(updated);
});

/**
 * Reinstate. In this order:
 *  1. While the account is still not active (the cleanup job carries out no
 *     vault deletion for it): a vault deletion that was pending when the
 *     account was suspended or canceled is cancelled, and the member is
 *     told. Its 24 hours may be over, and they passed while the member
 *     could not cancel on the account page or in the app; without this it
 *     would be carried out within minutes of the reinstatement. A member
 *     who wants the deletion asks again and gets the full 24 hours.
 *  2. A recovery that is still active is not cancelled (only the member
 *     API's vault routes can tell the enclave) and its clock did not stop
 *     while the account was not active: it works again the moment the
 *     account is active. So the reinstatement is refused (`409
 *     recovery_active`, with the recovery) until the admin repeats it with
 *     `allow_active_recovery: true`.
 *  3. The member's sessions are ended, then sign-in is enabled, and the
 *     status is written last. The sessions are ended here too because a
 *     suspension can be half done (its sign-out failed and nobody repeated
 *     it): without this, a session from before the suspension would be
 *     fully usable again the moment the account is active. Until the
 *     status write the row still says suspended or canceled, so a failure
 *     anywhere before it leaves an account whose routes are closed and
 *     whose deletions are held, and a repeat finishes. A failure after it
 *     (the event, the snapshot) leaves the account active; a repeat then
 *     answers 409 "already active".
 * The record that the admin allowed an active recovery is written before
 * sign-in is enabled, so it exists whatever fails afterwards.
 * If the cancel cannot be made the account stays as it is. This is the only
 * code that makes an account active again; whatever else ever does must
 * cancel a pending vault deletion first, as here.
 */
router.on('POST', '/admin/members/{user_guid}/reinstate', async ({ params, body, actor }) => {
  const allow = body.allow_active_recovery;
  if (allow !== undefined && typeof allow !== 'boolean') throw badRequest('allow_active_recovery must be true or false');
  const m = await getMember(params.user_guid);
  requireAccount(m);
  if (m.account_status === 'active') throw conflict('Account is already active');
  const { recoveries } = await cancelVaultDeletion(m, actor, 'reinstate');
  const shown = recoveries.map((r) => ({ vault_id: r.vault_id, recovery_id: r.recovery_id, state: r.state, available_at: epochIso(r.available_at), expires_at: epochIso(r.expires_at) }));
  if (shown.length && allow !== true) {
    const r = shown[0];
    throw new HttpError(
      409,
      'recovery_active',
      `A recovery of this member's vault is ${r.state}${r.state === 'pending' && r.available_at ? ` (its code becomes available at ${r.available_at})` : ''} and stays usable until ${r.expires_at}. ` +
        'It was not stopped by the suspension and will work again as soon as the account is active. If the member did not ask for it, wait until it has expired, ' +
        'or have the member cancel it with the link in the "recovery requested" email. To reinstate anyway, confirm.',
      { recoveries: shown },
    );
  }
  for (const r of shown) {
    await audit(actor, 'member.reinstate_with_active_recovery', m.user_guid, { email: m.email, vault_id: r.vault_id, recovery_id: r.recovery_id, state: r.state, expires_at: r.expires_at });
  }
  await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: memberPoolId(), Username: m.email }));
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
  // The audit event keeps who and when. The address goes to its 90-day
  // address record (lambda/shared/audit.ts), not into the event.
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

/**
 * Cancel a member's pending vault deletion ("Delete my vault and start
 * over", MEMBER-API): for a member who says they did not ask for it,
 * whatever the account status (support suspends first when the account
 * looks taken over; the deletion waits while the account is suspended).
 * `{cancelled: true}` when a pending deletion was removed; `{cancelled:
 * false}` when there was none (so a repeat is harmless); `409` when it is
 * already being carried out (`executing`). That includes one whose `delete`
 * could not be queued yet (the vault service paused, no instance running):
 * it is past its 24 hours and is not cancellable here either.
 */
router.on('POST', '/admin/members/{user_guid}/vault/deletion/cancel', async ({ params, actor }) => {
  const m = await getMember(params.user_guid);
  requireAccount(m);
  const r = await cancelVaultDeletion(m, actor);
  if (!r.cancelled.length && r.executing.length) throw conflict('The vault deletion is already being carried out and can no longer be cancelled');
  return { cancelled: r.cancelled.length > 0 };
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
