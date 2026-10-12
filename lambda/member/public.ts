/**
 * Member API, public routes: /api/public/*  (docs/MEMBER-API.md)
 */
import { AdminAddUserToGroupCommand, AdminCreateUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CreateEmailIdentityCommand, GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
import { cognito, ddb, env, ses, table } from '../shared/aws';
import { Router, badRequest, email as normEmail, str } from '../shared/http';
import { newGuid, nowIso } from '../shared/ids';
import { sendMail } from '../shared/mail';
import { MemberRequest, RateLimited, memberHandler } from '../shared/member-http';
import { emailMarkerKey, memberByEmail } from '../shared/members';
import { adminNotice, parseWithdrawToken } from '../shared/requests';
import { NAME_MAX, NAME_RE, trimSpaces } from '../shared/names';
import type { MemberItem } from '../shared/model';
import { hit } from '../shared/ratelimit';

const router = new Router<MemberRequest>();

async function sesStatus(addr: string): Promise<'verified' | 'pending' | 'missing'> {
  try {
    const r = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: addr }));
    return r.VerifiedForSendingStatus ? 'verified' : 'pending';
  } catch (e) {
    if ((e as Error).name === 'NotFoundException') return 'missing';
    throw e;
  }
}

/** Atomically create the member + email marker, optionally consuming a registration-code use. */
async function create(item: MemberItem, inviteCode: string | null): Promise<'ok' | 'exists' | 'bad_code'> {
  const now = nowIso();
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: table.members(), Item: item, ConditionExpression: 'attribute_not_exists(user_guid)' } },
          {
            Put: {
              TableName: table.members(),
              Item: { user_guid: emailMarkerKey(item.email), kind: 'email_marker', member_guid: item.user_guid, created_at: now },
              ConditionExpression: 'attribute_not_exists(user_guid)',
            },
          },
          ...(inviteCode
            ? [
                {
                  Update: {
                    TableName: table.invites(),
                    Key: { code: inviteCode },
                    UpdateExpression: 'ADD uses :one',
                    ConditionExpression: 'attribute_exists(code) AND expired = :f AND expires_at > :now AND uses < max_uses',
                    ExpressionAttributeValues: { ':one': 1, ':f': false, ':now': now },
                  },
                },
              ]
            : []),
        ],
      }),
    );
    return 'ok';
  } catch (e) {
    if ((e as Error).name !== 'TransactionCanceledException') throw e;
    const reasons = ((e as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).map((r) => r.Code);
    if (reasons[1] === 'ConditionalCheckFailed' || reasons[0] === 'ConditionalCheckFailed') return 'exists';
    if (reasons[2] === 'ConditionalCheckFailed') return 'bad_code';
    throw e;
  }
}

/**
 * Names are shown to admins and (never) interpolated into member email, but
 * keep them to plain name characters anyway: letters (any script), spaces,
 * apostrophes, hyphens and periods; no URLs, digits or control characters.
 * MEMBER-API 2.2.1: trimmed of leading and trailing U+0020 only, the rule
 * the name-change job and the vault apply (lambda/shared/names.ts).
 */
function personName(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  const label = key.replace('_', ' ');
  if (v === undefined || v === null || v === '') throw badRequest(`${key} is required`);
  if (typeof v !== 'string') throw badRequest(`${key} must be a string`);
  const t = trimSpaces(v);
  if (t === '') throw badRequest(`${key} is required`);
  if (t.length > NAME_MAX) throw badRequest(`${key} is too long`);
  if (!NAME_RE.test(t)) throw badRequest(`${label} may only contain letters, spaces, apostrophes, hyphens and periods`);
  return t;
}

/** Account-wide cap on new requests per hour (each one creates an SES identity). */
const GLOBAL_REQUESTS_PER_HOUR = 50;

router.on('POST', '/api/public/request', async ({ body, ip }) => {
  const limit = await hit(`req#ip#${ip}`, 5, 3600);
  if (!limit.allowed) throw new RateLimited(limit.retryAfter);

  const addr = normEmail(str(body, 'email', { max: 254 }));
  const first_name = personName(body, 'first_name');
  const last_name = personName(body, 'last_name');
  const code = str(body, 'invite_code', { optional: true, max: 20 }).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (body.consent !== true) throw badRequest('Please agree to receive email from VettID');
  const inviteCode = code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : null;

  // No existence oracle: an existing address gets the same answer as a new
  // request without a code.
  if (await memberByEmail(addr)) return { outcome: 'pending_approval' };

  // Global cap: past it, answer as usual but create nothing (no SES identity,
  // no row). Protects the account's SES identity quota and the admin inbox.
  if (!(await hit('req#global', GLOBAL_REQUESTS_PER_HOUR, 3600)).allowed) {
    console.warn(JSON.stringify({ msg: 'global membership-request cap reached' }));
    return { outcome: inviteCode ? 'registered' : 'pending_approval' };
  }

  const now = nowIso();
  const verified = (await sesStatus(addr)) === 'verified';
  const base: MemberItem = {
    user_guid: newGuid(),
    email: addr,
    first_name,
    last_name,
    state: 'requested',
    account_status: 'active',
    email_verified: verified,
    // Set to true below only if this request's own CreateEmailIdentity
    // succeeds: an identity that was already there is never ours to delete.
    owns_identity: false,
    created_at: now,
    updated_at: now,
  };

  let item: MemberItem = inviteCode ? { ...base, state: 'registered', invite_code: inviteCode } : base;
  let result = await create(item, inviteCode);
  if (result === 'bad_code') {
    // Invalid / expired / used-up code: silently fall back to admin review.
    item = base;
    result = await create(item, null);
  }
  if (result === 'exists') return { outcome: 'pending_approval' };

  if (item.state === 'registered') {
    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: env('MEMBER_POOL_ID'),
          Username: addr,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: addr },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'custom:user_guid', Value: item.user_guid },
          ],
        }),
      );
      await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: env('MEMBER_POOL_ID'), Username: addr, GroupName: 'registered' }));
    } catch (e) {
      // Fall back to admin review rather than leave a half-created account.
      console.error('cognito create failed; falling back to review', (e as Error).name); // the error text can name the address
      await ddb.send(
        new UpdateCommand({
          TableName: table.members(),
          Key: { user_guid: item.user_guid },
          UpdateExpression: 'SET #s = :r, updated_at = :n',
          ExpressionAttributeNames: { '#s': 'state' },
          ExpressionAttributeValues: { ':r': 'requested', ':n': nowIso() },
        }),
      );
      item = { ...item, state: 'requested' };
    }
  }

  // SES verification doubles as the email opt-in (sandbox).
  if (!verified) {
    let created = false;
    try {
      await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: addr }));
      created = true;
    } catch (e) {
      if ((e as Error).name !== 'AlreadyExistsException') throw e;
    }
    if (created) {
      await ddb.send(
        new UpdateCommand({
          TableName: table.members(),
          Key: { user_guid: item.user_guid },
          UpdateExpression: 'SET owns_identity = :t',
          ConditionExpression: 'attribute_exists(user_guid)',
          ExpressionAttributeValues: { ':t': true },
        }),
      );
    }
  }

  await audit('public', item.state === 'registered' ? 'member.register_code' : 'member.request', item.user_guid, {
    email: addr,
    invite_code: item.invite_code ?? null,
  });
  try {
    // No name, no address, no code: the admin site has them (shared/requests.ts).
    const notice = adminNotice(item.state === 'registered' ? 'registered' : verified ? 'arrived_verified' : 'arrived');
    await sendMail(env('ADMIN_EMAIL'), notice.subject, notice.text);
  } catch (e) {
    console.error('admin notify failed', (e as Error).name); // never fail the request over the notification
  }

  return { outcome: item.state === 'registered' ? 'registered' : 'pending_approval' };
});

/**
 * Withdraw a request with the link from the "we have your request" email
 * (MEMBER-API 2.6.0). POST only: opening the link is a static page, and no
 * GET route exists here. The answer is the same for a token that withdrew a
 * request and for one that names nothing (malformed, unknown, used, or for a
 * request since approved: an account is not removed this way), so the route
 * says nothing about any request or address.
 *
 * The one conditional write marks the row `withdrawn` and takes the names,
 * the decline reason and the token off it. This internet-facing function
 * deletes nothing: the cleanup job removes the row, its email marker, any
 * Cognito user and the SES identity (if the request created it) within 15
 * minutes (lambda/jobs/cleanup.ts, task `requests`). Until then the row
 * still holds the address, which keeps a new request for it from racing the
 * removal.
 */
router.on('POST', '/api/public/request/withdraw', async ({ body, ip }) => {
  const limit = await hit(`withdraw#ip#${ip}`, 20, 3600);
  if (!limit.allowed) throw new RateLimited(limit.retryAfter);

  const answer = { ok: true };
  const t = parseWithdrawToken(body.token);
  if (!t) {
    console.log(JSON.stringify({ msg: 'request withdraw', outcome: 'malformed' }));
    return answer;
  }
  const now = nowIso();
  let from: unknown;
  try {
    const r = await ddb.send(
      new UpdateCommand({
        TableName: table.members(),
        Key: { user_guid: t.user_guid },
        UpdateExpression: 'SET #s = :w, withdrawn_at = :n, updated_at = :n REMOVE withdraw_token_hash, first_name, last_name, reject_reason, invite_code',
        ConditionExpression: 'withdraw_token_hash = :h AND #s IN (:req, :rej)',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':h': t.hash, ':w': 'withdrawn', ':req': 'requested', ':rej': 'rejected', ':n': now },
        ReturnValues: 'UPDATED_OLD', // the state it was in, for the audit event
      }),
    );
    from = r.Attributes?.state;
  } catch (e) {
    if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
    console.log(JSON.stringify({ msg: 'request withdraw', outcome: 'unknown' }));
    return answer;
  }
  // No address: the row it named is going, and the audit log is not where it should live on.
  await audit('public', 'request.withdraw', t.user_guid, { from: from === 'rejected' ? 'rejected' : 'requested' });
  console.log(JSON.stringify({ msg: 'request withdraw', outcome: 'withdrawn' }));
  return answer;
});

export const handler = memberHandler(router);
