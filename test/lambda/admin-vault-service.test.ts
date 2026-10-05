import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

process.env.ALLOWED_ORIGIN = 'https://admin.vettid.org';
process.env.ADMIN_POOL_ID = 'us-east-1_admins';
process.env.TABLE_AUDIT = 'audit';
process.env.VAULT_SERVICE_PARAM = '/vettid-org/prod/switch/vault-service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('../../lambda/admin/vault-service');

const ddb = mockClient(DynamoDBDocumentClient);
const idp = mockClient(CognitoIdentityProviderClient);
const ssm = mockClient(SSMClient);

const event = (method: string, path: string, body: unknown = null, groups = 'admin') =>
  ({
    httpMethod: method,
    path,
    body: body === null ? null : JSON.stringify(body),
    isBase64Encoded: false,
    queryStringParameters: null,
    requestContext: { authorizer: { claims: { email: 'boss@vettid.org', 'cognito:groups': groups } } },
  }) as any;
const call = async (...a: Parameters<typeof event>) => {
  const res = await handler(event(...a));
  return { status: res.statusCode as number, body: JSON.parse(res.body) };
};

/** The parameter as SSM holds it (undefined: none). */
let stored: string | undefined;
const audits = () => ddb.commandCalls(PutCommand).filter((c) => c.args[0].input.TableName === 'audit').map((c) => c.args[0].input.Item);
const puts = () => ssm.commandCalls(PutParameterCommand).map((c) => c.args[0].input);

beforeEach(() => {
  ddb.reset();
  idp.reset();
  ssm.reset();
  stored = undefined;
  idp.on(AdminGetUserCommand).resolves({ Enabled: true });
  ddb.on(PutCommand).resolves({});
  ssm.on(GetParameterCommand).callsFake((i) => {
    expect(i.Name).toBe('/vettid-org/prod/switch/vault-service');
    if (stored === undefined) throw Object.assign(new Error('nf'), { name: 'ParameterNotFound' });
    return { Parameter: { Name: i.Name, Value: stored } };
  });
  ssm.on(PutParameterCommand).callsFake((i) => {
    stored = i.Value;
    return { Version: 1 };
  });
});

test('non-admins are refused before the switch is read or written', async () => {
  for (const [m, p] of [['GET', '/admin/vault-service'], ['POST', '/admin/vault-service/pause'], ['POST', '/admin/vault-service/resume']]) {
    expect((await call(m, p, { reason: 'x' }, 'registered')).status).toBe(403);
  }
  expect(ssm.calls()).toHaveLength(0);
  expect(ddb.calls()).toHaveLength(0);
});

test('no parameter: on, never set', async () => {
  expect(await call('GET', '/admin/vault-service')).toEqual({ status: 200, body: { enabled: true, reason: null, set_by: null, set_at: null } });
});

test('pause: writes the parameter (String, overwrite), audits vault.service.pause with the reason', async () => {
  const r = await call('POST', '/admin/vault-service/pause', { reason: '  bad host image, investigating  ' });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ enabled: false, reason: 'bad host image, investigating', set_by: 'boss@vettid.org' });
  expect(Date.parse(r.body.set_at)).not.toBeNaN();
  expect(puts()).toEqual([expect.objectContaining({ Name: '/vettid-org/prod/switch/vault-service', Type: 'String', Overwrite: true })]);
  expect(JSON.parse(stored!)).toEqual(r.body);
  expect(audits()).toEqual([expect.objectContaining({ actor: 'boss@vettid.org', action: 'vault.service.pause', subject: 'vault-service', detail: { reason: 'bad host image, investigating' } })]);
  expect((await call('GET', '/admin/vault-service')).body).toEqual(r.body);
});

test('pause needs a reason (≤ 500 chars); nothing written', async () => {
  for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 7 }, { reason: 'x'.repeat(501) }]) {
    expect((await call('POST', '/admin/vault-service/pause', body)).status).toBe(400);
  }
  expect(puts()).toHaveLength(0);
  expect(audits()).toHaveLength(0);
});

test('pause twice: 409, nothing written', async () => {
  await call('POST', '/admin/vault-service/pause', { reason: 'a' });
  const r = await call('POST', '/admin/vault-service/pause', { reason: 'b' });
  expect(r.status).toBe(409);
  expect(puts()).toHaveLength(1);
  expect(audits()).toHaveLength(1);
});

test('resume: writes enabled true, audits vault.service.resume with what the pause was', async () => {
  stored = JSON.stringify({ enabled: false, reason: 'incident 7', set_by: 'ops@vettid.org', set_at: '2026-10-05T20:00:00.000Z' });
  const r = await call('POST', '/admin/vault-service/resume');
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ enabled: true, reason: null, set_by: 'boss@vettid.org' });
  expect(JSON.parse(stored!).enabled).toBe(true);
  expect(audits()).toEqual([
    expect.objectContaining({
      action: 'vault.service.resume', subject: 'vault-service',
      detail: { paused_reason: 'incident 7', paused_by: 'ops@vettid.org', paused_at: '2026-10-05T20:00:00.000Z' },
    }),
  ]);
});

test('resume when on (no parameter, or enabled true): 409, nothing written', async () => {
  expect((await call('POST', '/admin/vault-service/resume')).status).toBe(409);
  stored = JSON.stringify({ enabled: true });
  expect((await call('POST', '/admin/vault-service/resume')).status).toBe(409);
  expect(puts()).toHaveLength(0);
  expect(audits()).toHaveLength(0);
});

test('a hand-written value that is not valid JSON reads as paused and can be resumed', async () => {
  stored = 'off please';
  expect((await call('GET', '/admin/vault-service')).body.enabled).toBe(false);
  expect((await call('POST', '/admin/vault-service/resume')).status).toBe(200);
  expect(JSON.parse(stored!).enabled).toBe(true);
});

test('an SSM failure is a 500, never a guess (and nothing is audited)', async () => {
  ssm.on(GetParameterCommand).rejects(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  expect((await call('POST', '/admin/vault-service/pause', { reason: 'x' })).status).toBe(500);
  expect(puts()).toHaveLength(0);
  expect(audits()).toHaveLength(0);
  jest.restoreAllMocks();
});
