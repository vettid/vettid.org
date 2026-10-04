import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

process.env.ALLOWED_ORIGIN = 'https://admin.vettid.org';
process.env.ADMIN_POOL_ID = 'us-east-1_admins';
for (const [k, v] of Object.entries({ TABLE_MEMBERS: 'members', TABLE_AUDIT: 'audit' })) process.env[k] = v;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('../../lambda/admin/vault-canary');

const ddb = mockClient(DynamoDBDocumentClient);
const idp = mockClient(CognitoIdentityProviderClient);

const event = (method: string, path: string, query: Record<string, string> | null = null, groups = 'admin') =>
  ({
    httpMethod: method,
    path,
    body: null,
    isBase64Encoded: false,
    queryStringParameters: query,
    requestContext: { authorizer: { claims: { email: 'boss@vettid.org', 'cognito:groups': groups } } },
  }) as any;

const G1 = '11111111-2222-4333-8444-555555555555';
const member = {
  user_guid: G1, email: 'tester@example.org', first_name: 'T', last_name: 'E',
  state: 'member', account_status: 'active', email_verified: true,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};
const ALLOWED_ATTRS = ['user_guid', 'vault_canary', 'updated_at']; // the IAM dynamodb:Attributes limit

const audits = () => ddb.commandCalls(PutCommand).filter((c) => c.args[0].input.TableName === 'audit').map((c) => c.args[0].input.Item);

beforeEach(() => {
  ddb.reset();
  idp.reset();
  idp.on(AdminGetUserCommand).resolves({ Enabled: true });
  ddb.on(PutCommand).resolves({});
  ddb.on(UpdateCommand).resolves({});
});

test('non-admins are refused before any data access', async () => {
  const res = await handler(event('POST', `/admin/vault-canary/${G1}`, null, 'registered'));
  expect(res.statusCode).toBe(403);
  expect(ddb.calls()).toHaveLength(0);
});

test('GET shows the flag and eligibility', async () => {
  ddb.on(GetCommand).resolves({ Item: { ...member, vault_canary: true } });
  const res = await handler(event('GET', `/admin/vault-canary/${G1}`));
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toEqual({
    user_guid: G1, email: 'tester@example.org', first_name: 'T', last_name: 'E',
    state: 'member', account_status: 'active', vault_canary: true, eligible: true,
  });
});

test('set: writes only the flag (within the IAM attribute limit), audits member.vault_canary.set', async () => {
  ddb.on(GetCommand).resolves({ Item: member });
  const res = await handler(event('POST', `/admin/vault-canary/${G1}`));
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({ user_guid: G1, vault_canary: true });

  const upd = ddb.commandCalls(UpdateCommand)[0].args[0].input;
  expect(upd).toMatchObject({ TableName: 'members', Key: { user_guid: G1 }, ReturnValues: 'NONE' });
  expect(upd.UpdateExpression).toBe('SET #v = :t, #u = :now');
  expect(upd.ExpressionAttributeValues![':t']).toBe(true);
  expect(upd.ConditionExpression).toBe('attribute_exists(#k)');
  expect(Object.values(upd.ExpressionAttributeNames!).every((a) => ALLOWED_ATTRS.includes(a as string))).toBe(true);

  expect(audits()).toEqual([expect.objectContaining({ actor: 'boss@vettid.org', action: 'member.vault_canary.set', subject: G1, detail: { email: 'tester@example.org' } })]);
});

test.each(['registered', 'requested', 'rejected'])('set refuses a %s (409) and writes nothing', async (state) => {
  ddb.on(GetCommand).resolves({ Item: { ...member, state } });
  const res = await handler(event('POST', `/admin/vault-canary/${G1}`));
  expect(res.statusCode).toBe(409);
  expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  expect(audits()).toHaveLength(0);
});

test('set refuses an already-flagged member (409)', async () => {
  ddb.on(GetCommand).resolves({ Item: { ...member, vault_canary: true } });
  expect((await handler(event('POST', `/admin/vault-canary/${G1}`))).statusCode).toBe(409);
  expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
});

test('unknown members and non-guid keys are 404 (email markers stay unreachable)', async () => {
  ddb.on(GetCommand).resolves({});
  expect((await handler(event('POST', `/admin/vault-canary/${G1}`))).statusCode).toBe(404);
  expect((await handler(event('DELETE', `/admin/vault-canary/${G1}`))).statusCode).toBe(404);
  ddb.reset();
  idp.on(AdminGetUserCommand).resolves({ Enabled: true });
  expect((await handler(event('POST', `/admin/vault-canary/${encodeURIComponent('email:tester@example.org')}`))).statusCode).toBe(404);
  expect(ddb.calls()).toHaveLength(0);
});

test('a member deleted between read and write is a 404, not a recreated stub', async () => {
  ddb.on(GetCommand).resolves({ Item: member });
  ddb.on(UpdateCommand).rejects(Object.assign(new Error('gone'), { name: 'ConditionalCheckFailedException' }));
  expect((await handler(event('POST', `/admin/vault-canary/${G1}`))).statusCode).toBe(404);
  expect(audits()).toHaveLength(0);
});

test('clear: removes the flag in any state, audits member.vault_canary.clear', async () => {
  ddb.on(GetCommand).resolves({ Item: { ...member, state: 'registered', vault_canary: true } });
  const res = await handler(event('DELETE', `/admin/vault-canary/${G1}`));
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({ vault_canary: false, eligible: false });
  const upd = ddb.commandCalls(UpdateCommand)[0].args[0].input;
  expect(upd.UpdateExpression).toBe('SET #u = :now REMOVE #v');
  expect(Object.values(upd.ExpressionAttributeNames!).every((a) => ALLOWED_ATTRS.includes(a as string))).toBe(true);
  expect(audits()).toEqual([expect.objectContaining({ action: 'member.vault_canary.clear', subject: G1 })]);
});

test('clear refuses a member without the flag (409)', async () => {
  ddb.on(GetCommand).resolves({ Item: member });
  expect((await handler(event('DELETE', `/admin/vault-canary/${G1}`))).statusCode).toBe(409);
  expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
});

test('list: filtered scan for vault_canary = true, sorted by email, scan cursor passed through', async () => {
  const G2 = '22222222-2222-4333-8444-555555555555';
  ddb
    .on(ScanCommand)
    .resolvesOnce({ Items: [{ ...member, user_guid: G2, email: 'zed@example.org', vault_canary: true }], LastEvaluatedKey: { user_guid: G2 } })
    .resolvesOnce({ Items: [{ ...member, vault_canary: true }] });
  const res = await handler(event('GET', '/admin/vault-canary'));
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.items.map((i: any) => i.email)).toEqual(['tester@example.org', 'zed@example.org']);
  expect(body.cursor).toBeNull();
  const scans = ddb.commandCalls(ScanCommand).map((c) => c.args[0].input);
  expect(scans).toHaveLength(2);
  expect(scans[0]).toMatchObject({ TableName: 'members', FilterExpression: '#v = :t', ExpressionAttributeValues: { ':t': true } });
  expect(scans[1].ExclusiveStartKey).toEqual({ user_guid: G2 });
});

test('list stops after a bounded number of scan pages and returns a cursor', async () => {
  ddb.on(ScanCommand).resolves({ Items: [], LastEvaluatedKey: { user_guid: G1 } });
  const body = JSON.parse((await handler(event('GET', '/admin/vault-canary'))).body);
  expect(ddb.commandCalls(ScanCommand)).toHaveLength(10);
  expect(body.items).toEqual([]);
  expect(typeof body.cursor).toBe('string');
});
