import { mockClient } from 'aws-sdk-client-mock';
import { SESv2Client, GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import {
  AdminGetUserCommand,
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

process.env.ALLOWED_ORIGIN = 'https://admin.vettid.org';
process.env.ADMIN_POOL_ID = 'us-east-1_admins';
process.env.TABLE_RATELIMITS = 'rl';
process.env.SENDER_EMAIL = 'no-reply@vettid.org';
process.env.MEMBER_POOL_ID = 'us-east-1_pool';
for (const [k, v] of Object.entries({
  TABLE_MEMBERS: 'members', TABLE_INVITES: 'invites', TABLE_TERMS: 'terms',
  TABLE_SUBSCRIPTIONS: 'subs', TABLE_SUBSCRIPTION_TYPES: 'types', TABLE_AUDIT: 'audit',
})) process.env[k] = v;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('../../lambda/admin/people');

const ddb = mockClient(DynamoDBDocumentClient);
const idp = mockClient(CognitoIdentityProviderClient);

const event = (method: string, path: string, body?: unknown, groups = 'admin') =>
  ({
    httpMethod: method,
    path,
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false,
    queryStringParameters: null,
    requestContext: { authorizer: { claims: { email: 'boss@vettid.org', 'cognito:groups': groups } } },
  }) as any;

const G1 = '11111111-2222-4333-8444-555555555555';
const pending = {
  user_guid: G1, email: 'new@example.org', first_name: 'N', last_name: 'M',
  state: 'requested', account_status: 'active', email_verified: true,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  ddb.reset();
  idp.reset();
  idp.on(AdminGetUserCommand).resolves({ Enabled: true });
  ddb.on(BatchGetCommand).resolves({ Responses: { subs: [] } });
  ddb.on(PutCommand).resolves({});
});

test('non-admins are refused before any data access', async () => {
  const res = await handler(event('GET', '/admin/requests', undefined, 'registered'));
  expect(res.statusCode).toBe(403);
  expect(ddb.calls()).toHaveLength(0);
});

test('approve creates a suppressed Cognito user in `registered`, moves state, audits', async () => {
  ddb.on(GetCommand).resolves({ Item: pending });
  ddb.on(UpdateCommand).resolves({ Attributes: { ...pending, state: 'registered' } });
  idp.on(AdminCreateUserCommand).resolves({});
  idp.on(AdminAddUserToGroupCommand).resolves({});

  const res = await handler(event('POST', `/admin/requests/${G1}/approve`));
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({ user_guid: G1, state: 'registered', voting_rights: false });

  const create = idp.commandCalls(AdminCreateUserCommand)[0].args[0].input;
  expect(create).toMatchObject({ Username: 'new@example.org', MessageAction: 'SUPPRESS' });
  expect(create.UserAttributes).toContainEqual({ Name: 'custom:user_guid', Value: G1 });
  expect(idp.commandCalls(AdminAddUserToGroupCommand)[0].args[0].input.GroupName).toBe('registered');

  const upd = ddb.commandCalls(UpdateCommand)[0].args[0].input;
  expect(upd.ConditionExpression).toContain('#c0 = :c0'); // guarded on still being `requested`
  const auditPut = ddb.commandCalls(PutCommand).find((c) => c.args[0].input.TableName === 'audit')!;
  expect(auditPut.args[0].input.Item).toMatchObject({ actor: 'boss@vettid.org', action: 'request.approve', subject: G1 });
});

test('approving a non-pending request is a 409 and touches nothing', async () => {
  ddb.on(GetCommand).resolves({ Item: { ...pending, state: 'registered' } });
  const res = await handler(event('POST', `/admin/requests/${G1}/approve`));
  expect(res.statusCode).toBe(409);
  expect(idp.calls()).toHaveLength(0);
});

test('suspend requires a reason, disables + signs out, audits', async () => {
  const active = { ...pending, state: 'member' };
  ddb.on(GetCommand).resolves({ Item: active });
  expect((await handler(event('POST', `/admin/members/${G1}/suspend`, {}))).statusCode).toBe(400);

  ddb.on(UpdateCommand).resolves({ Attributes: { ...active, account_status: 'suspended' } });
  idp.on(AdminDisableUserCommand).resolves({});
  idp.on(AdminUserGlobalSignOutCommand).resolves({});
  const res = await handler(event('POST', `/admin/members/${G1}/suspend`, { reason: 'spam' }));
  expect(res.statusCode).toBe(200);
  expect(idp.commandCalls(AdminDisableUserCommand)).toHaveLength(1);
  expect(idp.commandCalls(AdminUserGlobalSignOutCommand)).toHaveLength(1);
});

test('invite creation validates input and returns an active code', async () => {
  expect((await handler(event('POST', '/admin/invites', { max_uses: 0, expires_in_days: 7 }))).statusCode).toBe(400);
  const res = await handler(event('POST', '/admin/invites', { max_uses: 5, expires_in_days: 7, note: 'friends' }));
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body).toMatchObject({ max_uses: 5, uses: 0, status: 'active', created_by: 'boss@vettid.org' });
  expect(body.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
});

test('responses carry CORS for the admin origin only', async () => {
  const res = await handler(event('GET', '/admin/nope'));
  expect(res.statusCode).toBe(404);
  expect(res.headers['Access-Control-Allow-Origin']).toBe('https://admin.vettid.org');
});

test('a disabled admin is refused even with a valid token', async () => {
  idp.on(AdminGetUserCommand).resolves({ Enabled: false });
  // distinct email so the 60 s enabled-cache from other tests doesn't apply
  const ev = { ...event('GET', '/admin/requests'), requestContext: { authorizer: { claims: { email: 'gone@vettid.org', 'cognito:groups': 'admin' } } } };
  const res = await handler(ev);
  expect(res.statusCode).toBe(403);
  expect(JSON.parse(res.body).message).toMatch(/disabled/);
});

test('approval requires a verified address (live SES check if the flag lags)', async () => {
  const ses = mockClient(SESv2Client);
  ddb.on(GetCommand).resolves({ Item: { ...pending, email_verified: false } });
  ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: false });
  const res = await handler(event('POST', `/admin/requests/${G1}/approve`));
  expect(res.statusCode).toBe(409);
  expect(idp.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  ses.restore();
});

test('marker rows and malformed ids are not addressable as members', async () => {
  expect((await handler(event('GET', '/admin/members/email:someone@x.org'))).statusCode).toBe(404);
  expect((await handler(event('GET', '/admin/members/%E0%A4%A'))).statusCode).toBe(400);
  expect(ddb.commandCalls(GetCommand)).toHaveLength(0);
});
