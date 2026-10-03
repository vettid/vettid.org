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
 */
function personName(body: Record<string, unknown>, key: string): string {
  const v = str(body, key, { max: 40 });
  if (!/^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u.test(v)) throw badRequest(`${key.replace('_', ' ')} may only contain letters, spaces, apostrophes, hyphens and periods`);
  return v;
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
      console.error('cognito create failed; falling back to review', e);
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
    try {
      await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: addr }));
    } catch (e) {
      if ((e as Error).name !== 'AlreadyExistsException') throw e;
    }
  }

  await audit('public', item.state === 'registered' ? 'member.register_code' : 'member.request', item.user_guid, {
    email: addr,
    invite_code: item.invite_code ?? null,
  });
  try {
    await sendMail(
      env('ADMIN_EMAIL'),
      item.state === 'registered' ? `VettID: ${first_name} ${last_name} registered with a registration code` : `VettID: membership request from ${first_name} ${last_name}`,
      `${first_name} ${last_name} <${addr}>\n` +
        (item.state === 'registered' ? `Registered with registration code ${item.invite_code}.\n` : 'Needs review in admin (Requests).\n') +
        'admin: https://admin.vettid.org/#requests\n',
    );
  } catch (e) {
    console.error('admin notify failed', e); // never fail the request over the notification
  }

  return { outcome: item.state === 'registered' ? 'registered' : 'pending_approval' };
});

export const handler = memberHandler(router);
