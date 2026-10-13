/**
 * Admin route group: who am I, admin users, audit log.
 *   /admin/me  /admin/admins/*  /admin/audit
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
  ListUsersInGroupCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { CreateEmailIdentityCommand, GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { BatchGetCommand, type BatchGetCommandOutput, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { addressMonth, audit } from '../shared/audit';
import { adminHandler } from '../shared/admin-handler';
import { cognito, ddb, env, ses, table } from '../shared/aws';
import { Router, badRequest, conflict, decodeCursor, email, encodeCursor, forbidden, notFound, str } from '../shared/http';

const poolId = () => env('ADMIN_POOL_ID');

const adminView = (u: Pick<UserType, 'Username' | 'Attributes' | 'Enabled' | 'UserStatus' | 'UserCreateDate'>) => ({
  email: u.Attributes?.find((a) => a.Name === 'email')?.Value ?? u.Username ?? '',
  enabled: !!u.Enabled,
  status: u.UserStatus ?? 'UNKNOWN',
  created_at: u.UserCreateDate?.toISOString() ?? '',
});

const router = new Router();

router.on('GET', '/admin/me', async ({ actor }) => ({ email: actor }));

router.on('GET', '/admin/admins', async ({ query }) => {
  const r = await cognito.send(
    new ListUsersInGroupCommand({ UserPoolId: poolId(), GroupName: 'admin', Limit: 60, NextToken: query.cursor || undefined }),
  );
  return { items: (r.Users ?? []).map(adminView), cursor: r.NextToken ?? null };
});

router.on('POST', '/admin/admins', async ({ body, actor }) => {
  const addr = email(str(body, 'email', { max: 254 }));
  // SES sandbox: Cognito can only email the temporary password to a verified
  // address. First call starts verification; the second creates the user.
  let verified: boolean | 'missing';
  try {
    verified = (await ses.send(new GetEmailIdentityCommand({ EmailIdentity: addr }))).VerifiedForSendingStatus === true;
  } catch (e) {
    if ((e as Error).name !== 'NotFoundException') throw e;
    verified = 'missing';
  }
  if (verified === 'missing') {
    await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: addr }));
    await audit(actor, 'admin.verification_sent', addr);
    return { status: 'verification_sent' };
  }
  if (!verified) return { status: 'verification_sent' }; // still waiting on their click

  try {
    const r = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId(),
        Username: addr,
        UserAttributes: [
          { Name: 'email', Value: addr },
          { Name: 'email_verified', Value: 'true' },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      }),
    );
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: poolId(), Username: addr, GroupName: 'admin' }));
    await audit(actor, 'admin.create', addr);
    return { status: 'created', admin: adminView({ ...r.User, Username: addr }) };
  } catch (e) {
    if ((e as Error).name === 'UsernameExistsException') throw conflict('That address is already an admin');
    throw e;
  }
});

async function target(params: Record<string, string>, actor: string): Promise<string> {
  const addr = email(params.email);
  if (addr === actor) throw forbidden('You cannot change your own admin account here');
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId(), Username: addr }));
  } catch (e) {
    if ((e as Error).name === 'UserNotFoundException') throw notFound('No such admin');
    throw e;
  }
  return addr;
}

async function fresh(addr: string) {
  const u = await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId(), Username: addr }));
  return adminView({ Username: u.Username, Attributes: u.UserAttributes, Enabled: u.Enabled, UserStatus: u.UserStatus, UserCreateDate: u.UserCreateDate });
}

router.on('POST', '/admin/admins/{email}/disable', async ({ params, actor }) => {
  const addr = await target(params, actor);
  await cognito.send(new AdminDisableUserCommand({ UserPoolId: poolId(), Username: addr }));
  await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: poolId(), Username: addr }));
  await audit(actor, 'admin.disable', addr);
  return fresh(addr);
});

router.on('POST', '/admin/admins/{email}/enable', async ({ params, actor }) => {
  const addr = await target(params, actor);
  await cognito.send(new AdminEnableUserCommand({ UserPoolId: poolId(), Username: addr }));
  await audit(actor, 'admin.enable', addr);
  return fresh(addr);
});

router.on('DELETE', '/admin/admins/{email}', async ({ params, actor }) => {
  const addr = await target(params, actor);
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: poolId(), Username: addr }));
  await audit(actor, 'admin.remove', addr);
  return { ok: true };
});

/**
 * The address records of a page of events (lambda/shared/audit.ts): present
 * for 90 days after an event that named a person's address. DynamoDB's TTL
 * deletes late (up to two days), so an expired record is not returned.
 */
async function addresses(rows: { month: string; ts_id: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const nowS = Math.floor(Date.now() / 1000);
  for (let i = 0; i < rows.length; i += 100) {
    let keys: Record<string, unknown>[] | undefined = rows.slice(i, i + 100).map((x) => ({ month: addressMonth(x.month), ts_id: x.ts_id }));
    // A few rounds at most: unprocessed keys are throttling, not data.
    for (let round = 0; keys?.length && round < 5; round++) {
      const got: BatchGetCommandOutput = await ddb.send(new BatchGetCommand({ RequestItems: { [table.audit()]: { Keys: keys } } }));
      for (const a of got.Responses?.[table.audit()] ?? []) {
        if (typeof a.email === 'string' && typeof a.expires_at === 'number' && a.expires_at > nowS) {
          out.set(`${String(a.month).slice('addr#'.length)}|${a.ts_id}`, a.email);
        }
      }
      keys = got.UnprocessedKeys?.[table.audit()]?.Keys;
    }
  }
  return out;
}

router.on('GET', '/admin/audit', async ({ query }) => {
  const base = { TableName: table.audit(), ScanIndexForward: false, Limit: 100, ExclusiveStartKey: decodeCursor(query.cursor) };
  let r;
  if (query.actor) {
    r = await ddb.send(new QueryCommand({ ...base, IndexName: 'actor-index', KeyConditionExpression: 'actor = :v', ExpressionAttributeValues: { ':v': query.actor.toLowerCase() } }));
  } else if (query.subject) {
    r = await ddb.send(new QueryCommand({ ...base, IndexName: 'subject-index', KeyConditionExpression: 'subject = :v', ExpressionAttributeValues: { ':v': query.subject } }));
  } else {
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('month must be YYYY-MM');
    r = await ddb.send(new QueryCommand({ ...base, KeyConditionExpression: '#m = :m', ExpressionAttributeNames: { '#m': 'month' }, ExpressionAttributeValues: { ':m': month } }));
  }
  const rows = r.Items ?? [];
  const emails = await addresses(rows as { month: string; ts_id: string }[]);
  const items = rows.map((i) => {
    const email = emails.get(`${i.month}|${i.ts_id}`);
    return { ts: i.ts, actor: i.actor, action: i.action, subject: i.subject, detail: i.detail ?? {}, ...(email ? { email } : {}) };
  });
  return { items, cursor: encodeCursor(r.LastEvaluatedKey) };
});

export const handler = adminHandler(router);
