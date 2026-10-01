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
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { audit } from '../shared/audit';
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
  const items = (r.Items ?? []).map((i) => ({ ts: i.ts, actor: i.actor, action: i.action, subject: i.subject, detail: i.detail ?? {} }));
  return { items, cursor: encodeCursor(r.LastEvaluatedKey) };
});

export const handler = adminHandler(router);
