// MEMBER-API 2.6.0: withdrawing a request for early access by link, the 30 days of
// a declined request, the 90 days of an address in the audit log, and the
// admin notices without a name or an address.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mockClient } from 'aws-sdk-client-mock';
import { BatchGetCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminDeleteUserCommand, AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CreateEmailIdentityCommand, DeleteEmailIdentityCommand, GetEmailIdentityCommand, SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { marshall } from '@aws-sdk/util-dynamodb';

Object.assign(process.env, {
  TABLE_MEMBERS: 'members', TABLE_INVITES: 'invites', TABLE_TERMS: 'terms', TABLE_SUBSCRIPTIONS: 'subs',
  TABLE_SUBSCRIPTION_TYPES: 'types', TABLE_AUDIT: 'audit', TABLE_RATELIMITS: 'rl', TABLE_MAGIC_LINKS: 'links',
  TABLE_MAILING_LIST: 'list', TABLE_VAULTS: 'vaults', TABLE_VAULT_INSTANCES: 'instances', TABLE_VAULT_RELEASES: 'releases',
  MEMBER_POOL_ID: 'us-east-1_pool', MEMBER_CLIENT_ID: 'client', ADMIN_POOL_ID: 'us-east-1_admins',
  ORIGIN_VERIFY_SECRET_ARN: 'origin', SENDER_EMAIL: 'no-reply@vettid.org', ADMIN_EMAIL: 'admin@vettid.org',
  ACCOUNT_HOST: 'account.vettid.org', ALLOWED_ORIGIN: 'https://admin.vettid.org',
  VAULT_SERVICE_PARAM: '/vettid-org/prod/switch/vault-service',
});

/* eslint-disable @typescript-eslint/no-require-imports */
const pub = require('../../lambda/member/public');
const stream = require('../../lambda/jobs/members-stream');
const cleanup = require('../../lambda/jobs/cleanup');
const people = require('../../lambda/admin/people');
const system = require('../../lambda/admin/system');
const { audit, memberActor, AUDIT_ADDRESS_DAYS } = require('../../lambda/shared/audit');
const requests = require('../../lambda/shared/requests');
const backfill = require('../../scripts/ops/audit-address-backfill');
const vaultService = require('../../lambda/shared/vault-service');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const idp = mockClient(CognitoIdentityProviderClient);
const ses = mockClient(SESv2Client);
const sm = mockClient(SecretsManagerClient);
const ssm = mockClient(SSMClient);

const ORIGIN = 'origin-secret-value';
const G = '11111111-2222-4333-8444-555555555555';
const G2 = '99999999-2222-4333-8444-555555555555';
const ADDR = 'ada.lovelace@example.org';
const SECRET = 'A'.repeat(43);
const TOKEN = `${G}.${SECRET}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const named = (name: string) => Object.assign(new Error(name), { name });
const ccf = () => named('ConditionalCheckFailedException');
const DAY = 86_400_000;

const ev = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  ({
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    cookies: [],
    headers: { 'x-origin-verify': ORIGIN, 'x-vettid-csrf': '1', 'cloudfront-viewer-address': '203.0.113.9:443', ...headers },
    requestContext: { http: { method, sourceIp: '10.0.0.1' } },
  }) as any;

const adminEv = (method: string, path: string, body?: unknown, query: Record<string, string> | null = null) =>
  ({
    httpMethod: method,
    path,
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false,
    queryStringParameters: query,
    requestContext: { authorizer: { claims: { email: 'boss@vettid.org', 'cognito:groups': 'admin' } } },
  }) as any;

const auditPuts = () => ddb.commandCalls(PutCommand).filter((c) => c.args[0].input.TableName === 'audit').map((c) => c.args[0].input.Item!);
const events = () => auditPuts().filter((i) => !String(i.month).startsWith('addr#'));
const addressRecords = () => auditPuts().filter((i) => String(i.month).startsWith('addr#'));
const memberUpdates = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'members');
const mails = () => ses.commandCalls(SendEmailCommand).map((c) => c.args[0].input);
const mailText = (m: ReturnType<typeof mails>[number]) => `${m.Content!.Simple!.Subject!.Data}\n${m.Content!.Simple!.Body!.Text!.Data}`;

let logged: string[];
let spies: jest.SpyInstance[];

beforeEach(() => {
  ddb.reset(); idp.reset(); ses.reset(); sm.reset(); ssm.reset();
  vaultService.resetVaultServiceCache();
  ssm.on(GetParameterCommand).rejects(named('ParameterNotFound'));
  sm.on(GetSecretValueCommand, { SecretId: 'origin' }).resolves({ SecretString: ORIGIN });
  ddb.on(UpdateCommand, { TableName: 'rl' }).resolves({ Attributes: { count: 1 } });
  ddb.on(PutCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [] });
  ddb.on(ScanCommand).resolves({ Items: [] });
  ddb.on(BatchGetCommand).resolves({ Responses: { subs: [], audit: [] } });
  ses.on(SendEmailCommand).resolves({});
  idp.on(AdminGetUserCommand).callsFake((input) => {
    if (input.UserPoolId === 'us-east-1_admins') return { Enabled: true };
    throw named('UserNotFoundException');
  });
  logged = [];
  spies = (['log', 'warn', 'error'] as const).map((k) =>
    jest.spyOn(console, k).mockImplementation((...a: unknown[]) => {
      logged.push(a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? `${x.name}: ${x.message}` : JSON.stringify(x))).join(' '));
    }),
  );
});
afterEach(() => spies.forEach((s) => s.mockRestore()));

/** Nothing written to a log names a person or carries a link's secret. */
const expectCleanLogs = () => {
  const all = logged.join('\n');
  for (const secret of [ADDR, 'example.org', SECRET, TOKEN, 'Lovelace']) expect(all).not.toContain(secret);
};

describe('the withdrawal token', () => {
  test('names the row by id and authorizes with a secret of which only the hash is kept', () => {
    const { token, hash } = requests.newWithdrawToken(G);
    expect(token).toMatch(new RegExp(`^${G}\\.[A-Za-z0-9_-]{43}$`));
    expect(hash).toBe(sha(token.slice(G.length + 1)));
    expect(requests.parseWithdrawToken(token)).toEqual({ user_guid: G, hash });
    expect(requests.newWithdrawToken(G).token).not.toBe(token);
  });

  test.each([undefined, null, 7, {}, '', 'x', SECRET, `${G}.`, `${G}.${'A'.repeat(42)}`, `${G}.${'A'.repeat(44)}`, `${G}.${'A'.repeat(42)}!`, `email:${ADDR}.${SECRET}`, `ABCDEF11-2222-4333-8444-555555555555.${SECRET}`, ` ${TOKEN}`])(
    'anything else is not a token: %j',
    (t) => {
      expect(requests.parseWithdrawToken(t)).toBeNull();
    },
  );

  test('the link puts the token in the fragment of the account site page', () => {
    expect(requests.withdrawLink('account.vettid.org', TOKEN)).toBe(`https://account.vettid.org/request/withdraw/#w=${TOKEN}`);
  });
});

describe('POST /api/public/request/withdraw', () => {
  const post = (body: unknown) => pub.handler(ev('POST', '/api/public/request/withdraw', body));
  const OK = { status: 200, body: { ok: true } };
  const answer = (res: any) => ({ status: res.statusCode, body: JSON.parse(res.body) });

  test('a valid token: one conditional write marks the row withdrawn and takes the names and the token off it; audited without the address', async () => {
    ddb.on(UpdateCommand, { TableName: 'members' }).resolves({ Attributes: { state: 'requested', first_name: 'Ada', last_name: 'Lovelace' } });
    const res = await post({ token: TOKEN });
    expect(answer(res)).toEqual(OK);
    expect(res.headers['Cache-Control']).toBe('no-store');

    const [u] = memberUpdates();
    expect(memberUpdates()).toHaveLength(1);
    expect(u.Key).toEqual({ user_guid: G });
    expect(u.ConditionExpression).toBe('withdraw_token_hash = :h AND #s IN (:req, :rej)');
    expect(u.ExpressionAttributeValues).toMatchObject({ ':h': sha(SECRET), ':w': 'withdrawn', ':req': 'requested', ':rej': 'rejected' });
    expect(u.UpdateExpression).toContain('SET #s = :w, withdrawn_at = :n');
    expect(u.ReturnValues).toBe('UPDATED_OLD');
    expect(u.UpdateExpression).toContain('REMOVE withdraw_token_hash, first_name, last_name, reject_reason');
    // The stored hash, never the token.
    expect(JSON.stringify(u)).not.toContain(SECRET);

    expect(events()).toEqual([expect.objectContaining({ actor: 'public', action: 'request.withdraw', subject: G, detail: { from: 'requested' } })]);
    expect(addressRecords()).toEqual([]);
    expect(JSON.stringify(auditPuts())).not.toContain('@');
    // This internet-facing function deletes nothing.
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(ses.calls()).toHaveLength(0);
    expect(idp.calls()).toHaveLength(0);
    expectCleanLogs();
  });

  test('a declined request can be withdrawn too; the audit says from which state', async () => {
    ddb.on(UpdateCommand, { TableName: 'members' }).resolves({ Attributes: { state: 'rejected' } });
    expect(answer(await post({ token: TOKEN }))).toEqual(OK);
    expect(events()[0]).toMatchObject({ action: 'request.withdraw', detail: { from: 'rejected' } });
  });

  test('a used or unknown token, and one whose request was approved meanwhile (an account), get the same answer and change nothing', async () => {
    ddb.on(UpdateCommand, { TableName: 'members' }).rejects(ccf());
    expect(answer(await post({ token: TOKEN }))).toEqual(OK);
    expect(auditPuts()).toEqual([]);
    expectCleanLogs();
  });

  test.each([[{}], [{ token: '' }], [{ token: 'nope' }], [{ token: 12 }], [{ token: `${G}.short` }], [{ token: `email:${ADDR}.${SECRET}` }], [{ t: TOKEN }]])(
    'a malformed token gets the same answer without touching the members table: %j',
    async (body) => {
      expect(answer(await post(body))).toEqual(OK);
      expect(memberUpdates()).toHaveLength(0);
      expect(auditPuts()).toEqual([]);
    },
  );

  test('the answers are byte for byte the same', async () => {
    ddb.on(UpdateCommand, { TableName: 'members' }).resolvesOnce({ Attributes: { state: 'requested' } }).rejects(ccf());
    const valid = await post({ token: TOKEN });
    const used = await post({ token: TOKEN });
    const malformed = await post({ token: 'x' });
    expect(used).toEqual(valid);
    expect(malformed).toEqual(valid);
  });

  test.each(['GET', 'DELETE', 'PUT'])('%s never acts: there is no such route', async (method) => {
    const res = await pub.handler({ ...ev(method, '/api/public/request/withdraw'), queryStringParameters: { token: TOKEN, w: TOKEN } });
    expect(res.statusCode).toBe(404);
    expect(memberUpdates()).toHaveLength(0);
    expect(auditPuts()).toEqual([]);
  });

  test('needs the CloudFront origin secret and the CSRF header, like every POST', async () => {
    expect((await pub.handler(ev('POST', '/api/public/request/withdraw', { token: TOKEN }, { 'x-origin-verify': 'no' }))).statusCode).toBe(403);
    expect((await pub.handler(ev('POST', '/api/public/request/withdraw', { token: TOKEN }, { 'x-vettid-csrf': '' }))).statusCode).toBe(403);
    expect(memberUpdates()).toHaveLength(0);
  });

  test('rate-limited per network before anything is looked up', async () => {
    ddb.on(UpdateCommand, { TableName: 'rl' }).resolves({ Attributes: { count: 21 } });
    const res = await post({ token: TOKEN });
    expect(res.statusCode).toBe(429);
    expect(memberUpdates()).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input.Key!.key).toMatch(/^withdraw#ip#203\.0\.113\.9#/);
  });

  test('a failure on our side is not answered as a withdrawal', async () => {
    ddb.on(UpdateCommand, { TableName: 'members' }).rejects(named('ProvisionedThroughputExceededException'));
    const res = await post({ token: TOKEN });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'internal', message: 'Internal error' });
  });
});

describe('POST /api/public/request: whose SES identity, and the admin notice', () => {
  const body = { email: ADDR, first_name: 'Ada', last_name: 'Lovelace', consent: true };
  const owns = () => memberUpdates().filter((u) => u.UpdateExpression === 'SET owns_identity = :t');

  beforeEach(() => {
    ddb.on(TransactWriteCommand).resolves({});
    ses.on(GetEmailIdentityCommand).rejects(named('NotFoundException'));
    ses.on(CreateEmailIdentityCommand).resolves({});
  });

  test('the request created the identity: the row says so (only then is it ever deleted with the request)', async () => {
    await pub.handler(ev('POST', '/api/public/request', body));
    const row = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems![0].Put!.Item!;
    expect(row.owns_identity).toBe(false); // until the create succeeds
    expect(owns()).toEqual([expect.objectContaining({ Key: { user_guid: row.user_guid }, ConditionExpression: 'attribute_exists(user_guid)' })]);
  });

  test('the identity was already there (the mailing list, an earlier account, the operator): not ours', async () => {
    ses.on(CreateEmailIdentityCommand).rejects(named('AlreadyExistsException'));
    await pub.handler(ev('POST', '/api/public/request', body));
    expect(owns()).toEqual([]);
  });

  test('an address SES had already verified: no identity is created, none is owned', async () => {
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: true });
    await pub.handler(ev('POST', '/api/public/request', body));
    expect(ses.commandCalls(CreateEmailIdentityCommand)).toHaveLength(0);
    expect(owns()).toEqual([]);
  });

  test.each([
    ['unverified', false, undefined, 'a request for early access arrived', 'not verified yet'],
    ['already verified', true, undefined, 'a request for early access arrived', 'already verified'],
    ['with a registration code', false, '7K3QX-M9TZA', 'someone registered with a registration code', 'nothing to review'],
  ])('the admin notice (%s) carries no name, no address and no code', async (_n, verified, code, subject, says) => {
    if (verified) ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: true });
    await pub.handler(ev('POST', '/api/public/request', code ? { ...body, invite_code: code } : body));
    const [notice] = mails();
    expect(mails()).toHaveLength(1);
    expect(notice.Destination!.ToAddresses).toEqual(['admin@vettid.org']);
    const text = mailText(notice);
    expect(text).toContain(`VettID: ${subject}`);
    expect(text).toContain(says);
    expect(text).toMatch(/admin: https:\/\/admin\.vettid\.org\/#(requests|members)\n$/);
    for (const personal of ['Ada', 'Lovelace', ADDR, 'example.org', '7K3QX']) expect(text).not.toContain(personal);
    expect(text.replace('admin@vettid.org', '')).not.toContain('@');
  });

  test('the request event names the person by id; the address is in its 90-day record only', async () => {
    await pub.handler(ev('POST', '/api/public/request', body));
    expect(events()).toEqual([expect.objectContaining({ actor: 'public', action: 'member.request', detail: { invite_code: null } })]);
    expect(JSON.stringify(events())).not.toContain(ADDR);
    expect(addressRecords()).toEqual([expect.objectContaining({ email: ADDR, ts_id: events()[0].ts_id })]);
  });

  test('a failing notice or Cognito call is logged by its error name only', async () => {
    ses.on(SendEmailCommand).rejects(Object.assign(new Error(`Email address is not verified: ${ADDR}`), { name: 'MessageRejected' }));
    const res = await pub.handler(ev('POST', '/api/public/request', body));
    expect(res.statusCode).toBe(200);
    expect(logged.join('\n')).toContain('MessageRejected');
    expectCleanLogs();
  });
});

describe('members stream: "we have your request"', () => {
  const row = { user_guid: G, email: ADDR, first_name: 'Ada', last_name: 'Lovelace', state: 'requested', account_status: 'active', email_verified: true };
  const rec = (img: Record<string, unknown>, old?: Record<string, unknown>, eventName = old ? 'MODIFY' : 'INSERT') => ({
    eventName,
    dynamodb: { NewImage: marshall(img), ...(old ? { OldImage: marshall(old) } : {}) },
  });
  const run = (...records: unknown[]) => stream.handler({ Records: records } as any, {} as any, () => undefined);

  test('the moment a request is verified: one mail to the person with the withdrawal link, the hash on the row, and a notice without the address', async () => {
    ddb.on(UpdateCommand).resolves({});
    await run(rec(row, { ...row, email_verified: false }));

    const [claim] = memberUpdates();
    expect(memberUpdates()).toHaveLength(1);
    expect(claim.UpdateExpression).toBe('SET withdraw_token_hash = :h, request_mail_at = :n');
    expect(claim.ConditionExpression).toContain('attribute_exists(user_guid)');
    expect(claim.ConditionExpression).toContain('attribute_not_exists(withdraw_token_hash)');
    expect(claim.ConditionExpression).toContain('#s = :req');
    expect(claim.ConditionExpression).toContain('email_verified = :t');

    const [toPerson, toAdmin] = mails();
    expect(mails()).toHaveLength(2);
    expect(toPerson.Destination!.ToAddresses).toEqual([ADDR]);
    expect(toPerson.Content!.Simple!.Subject!.Data).toBe('We have your request for early access to VettID');
    const text = toPerson.Content!.Simple!.Body!.Text!.Data!;
    const link = /https:\/\/account\.vettid\.org\/request\/withdraw\/#w=(\S+)/.exec(text)!;
    expect(requests.parseWithdrawToken(link[1])).toEqual({ user_guid: G, hash: claim.ExpressionAttributeValues![':h'] });
    // No member-supplied text in system email; no one-click headers (not list mail).
    for (const personal of ['Ada', 'Lovelace', ADDR]) expect(text).not.toContain(personal);
    expect(JSON.stringify(toPerson)).not.toContain('List-Unsubscribe');
    // Only the hash is stored.
    expect(JSON.stringify(claim)).not.toContain(link[1].slice(G.length + 1));

    expect(toAdmin.Destination!.ToAddresses).toEqual(['admin@vettid.org']);
    expect(mailText(toAdmin)).toContain('VettID: a request for early access was verified');
    for (const personal of ['Ada', 'Lovelace', ADDR, 'example.org']) expect(mailText(toAdmin)).not.toContain(personal);
    expectCleanLogs();
  });

  test('a request that arrives already verified is mailed too (its own notice already said so: no second one)', async () => {
    ddb.on(UpdateCommand).resolves({});
    await run(rec(row));
    expect(mails().map((m) => m.Destination!.ToAddresses![0])).toEqual([ADDR]);
  });

  test.each([
    ['a request verified before this change (any later write to its row)', row, { ...row, updated_at: 'x' }],
    ['the claim itself', { ...row, withdraw_token_hash: 'h', request_mail_at: 't' }, row],
    ['a request whose mail failed (the token was given back)', { ...row, request_mail_at: 't' }, { ...row, request_mail_at: 't', withdraw_token_hash: 'h' }],
    ['an unverified request', { ...row, email_verified: false }, undefined],
    ['a declined request', { ...row, state: 'rejected' }, { ...row, email_verified: false }],
    ['a withdrawn request', { ...row, state: 'withdrawn' }, row],
  ])('nothing is sent for %s', async (_n, img, old) => {
    ddb.on(UpdateCommand).resolves({});
    await run(rec(img, old));
    expect(mails()).toEqual([]);
    expect(memberUpdates()).toEqual([]);
  });

  test('a lost claim (mailed already, approved, deleted) sends nothing', async () => {
    ddb.on(UpdateCommand).rejects(ccf());
    await run(rec(row, { ...row, email_verified: false }));
    expect(mails()).toEqual([]);
  });

  test('a failed send gives the token back, does not loop or throw, and logs no address', async () => {
    ddb.on(UpdateCommand).resolves({});
    ses.on(SendEmailCommand).rejects(Object.assign(new Error(`rejected ${ADDR}`), { name: 'MessageRejected' }));
    await expect(run(rec(row, { ...row, email_verified: false }))).resolves.toBeUndefined();
    const [claim, back] = memberUpdates();
    expect(back.UpdateExpression).toBe('REMOVE withdraw_token_hash');
    expect(back.ExpressionAttributeValues).toEqual({ ':h': claim.ExpressionAttributeValues![':h'] });
    expect(logged.join('\n')).toContain('request mail failed MessageRejected');
    expectCleanLogs();
  });

  test('an approved, verified request still gets "account ready" (unchanged)', async () => {
    ddb.on(UpdateCommand).resolves({});
    await run(rec({ ...row, state: 'registered' }, row));
    expect(mails().map((m) => m.Content!.Simple!.Subject!.Data)).toEqual(['Your VettID account is ready']);
  });

  test('a request approved while its flag lagged (state and flag in one write) gets "account ready" only, never "we have your request" first', async () => {
    ddb.on(UpdateCommand).resolves({});
    await run(rec({ ...row, state: 'registered' }, { ...row, email_verified: false }));
    expect(mails().map((m) => m.Content!.Simple!.Subject!.Data)).toEqual(['Your VettID account is ready']);
    expect(mails().map((m) => m.Destination!.ToAddresses![0])).toEqual([ADDR]); // and no "was verified" notice to the admin
    expect(memberUpdates().map((u) => u.UpdateExpression)).toEqual(['SET welcome_sent = :t']);
  });
});

describe('cleanup: removing withdrawn requests (every 15 minutes)', () => {
  const now = Date.now();
  const withdrawn = (over: Record<string, unknown> = {}) => ({
    user_guid: G, email: ADDR, state: 'withdrawn', account_status: 'active', email_verified: true, owns_identity: true,
    withdrawn_at: new Date(now - 60_000).toISOString(), updated_at: new Date(now - 60_000).toISOString(), ...over,
  });
  const rows = (...items: Record<string, unknown>[]) =>
    ddb.on(QueryCommand).callsFake((input) => (input.TableName === 'members' && input.ExpressionAttributeValues?.[':w'] === 'withdrawn' ? { Items: items } : { Items: [] }));
  const run = () => cleanup.handler({ task: 'requests' });
  const deletes = () => ddb.commandCalls(TransactWriteCommand).map((c) => c.args[0].input.TransactItems!);
  const emf = () => logged.map((l) => { try { return JSON.parse(l); } catch { return {}; } }).filter((l) => l._aws);

  beforeEach(() => {
    ddb.on(GetCommand, { TableName: 'list' }).resolves({});
    ddb.on(TransactWriteCommand).resolves({});
    ses.on(DeleteEmailIdentityCommand).resolves({});
  });

  test('row and email marker go in one transaction, guarded on the state; the identity the request created is deleted; audited without the address', async () => {
    rows(withdrawn());
    const r = await run();
    expect(r).toEqual({ removed: 1, failures: 0, abandoned: 0 });
    expect(ses.commandCalls(DeleteEmailIdentityCommand).map((c) => c.args[0].input.EmailIdentity)).toEqual([ADDR]);
    const [tx] = deletes();
    expect(tx).toHaveLength(2);
    expect(tx[0].Delete).toMatchObject({ TableName: 'members', Key: { user_guid: G }, ConditionExpression: '#s = :s', ExpressionAttributeValues: { ':s': 'withdrawn' } });
    // The marker only if it is this request's own (or already gone).
    expect(tx[1].Delete).toEqual({
      TableName: 'members',
      Key: { user_guid: `email:${ADDR}` },
      ConditionExpression: 'attribute_not_exists(user_guid) OR member_guid = :g',
      ExpressionAttributeValues: { ':g': G },
    });
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(events()).toEqual([expect.objectContaining({ actor: 'system', action: 'request.removed', subject: G, detail: { after: 'withdraw', identity: 'deleted' } })]);
    expect(addressRecords()).toEqual([]);
    expect(emf()).toEqual([expect.objectContaining({ RequestRemovalFailures: 0, RequestRemovalAbandoned: 0 })]);
    expect(emf()[0]._aws.CloudWatchMetrics[0]).toMatchObject({ Namespace: 'VettID/MemberApi', Dimensions: [[]] });
    expectCleanLogs();
  });

  test.each([
    ['the request did not create it (it was there before)', { owns_identity: false }, false],
    ['a row from before 2.6.0 (no flag): never on doubt', { owns_identity: undefined }, false],
    ['the mailing list uses the address', {}, true],
    ['one of the project\'s own addresses', { email: 'someone@test.staging.vettid.org' }, false],
  ])('the SES identity is kept when %s; the request still goes', async (_n, over, onList) => {
    rows(withdrawn(over));
    if (onList) ddb.on(GetCommand, { TableName: 'list' }).resolves({ Item: { email: ADDR, status: 'confirmed' } });
    expect(await run()).toMatchObject({ removed: 1, failures: 0 });
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
    expect(deletes()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ action: 'request.removed', detail: { identity: 'kept' } });
  });

  test('an identity that is already gone is fine', async () => {
    rows(withdrawn());
    ses.on(DeleteEmailIdentityCommand).rejects(named('NotFoundException'));
    expect(await run()).toMatchObject({ removed: 1, failures: 0 });
  });

  test('a Cognito user left by a failed code registration goes only if it carries this request\'s id', async () => {
    rows(withdrawn());
    idp.on(AdminGetUserCommand).resolves({ UserAttributes: [{ Name: 'custom:user_guid', Value: G }] });
    idp.on(AdminDeleteUserCommand).resolves({});
    await run();
    expect(idp.commandCalls(AdminDeleteUserCommand).map((c) => c.args[0].input.Username)).toEqual([ADDR]);

    idp.resetHistory();
    idp.on(AdminGetUserCommand).resolves({ UserAttributes: [{ Name: 'custom:user_guid', Value: G2 }] }); // somebody's account
    await run();
    expect(idp.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
  });

  test('a failure leaves the row for the next run, is counted for the alarm, and does not stop the next request', async () => {
    rows(withdrawn(), withdrawn({ user_guid: G2, email: 'second@example.net' }));
    ses.on(DeleteEmailIdentityCommand, { EmailIdentity: ADDR }).rejects(Object.assign(new Error(`throttled ${ADDR}`), { name: 'TooManyRequestsException' }));
    const r = await run();
    expect(r).toEqual({ removed: 1, failures: 1, abandoned: 0 });
    expect(deletes().map((tx) => tx[0].Delete!.Key)).toEqual([{ user_guid: G2 }]); // the failed one's rows are untouched
    expect(emf()[0]).toMatchObject({ RequestRemovalFailures: 1, RequestRemovalAbandoned: 0 });
    expect(logged.join('\n')).toContain('TooManyRequestsException');
    expectCleanLogs();
  });

  test('after 7 days of failures the rows go anyway (no address waits for ever); the identity is not deleted, and it is audited and alarmed', async () => {
    rows(withdrawn({ withdrawn_at: new Date(now - 8 * DAY).toISOString() }));
    ses.on(DeleteEmailIdentityCommand).rejects(named('AccessDeniedException'));
    const r = await run();
    expect(r).toEqual({ removed: 0, failures: 0, abandoned: 1 });
    expect(deletes()).toHaveLength(1);
    expect(events()).toEqual([expect.objectContaining({ action: 'request.removal_incomplete', subject: G, detail: { after: 'withdraw' } })]);
    expect(emf()[0]).toMatchObject({ RequestRemovalAbandoned: 1 });
  });

  test('a row an admin deleted (or that is no longer withdrawn) meanwhile is not ours: nothing is counted or audited', async () => {
    rows(withdrawn());
    ddb.on(TransactWriteCommand).rejects(Object.assign(named('TransactionCanceledException'), { CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }] }));
    expect(await run()).toEqual({ removed: 0, failures: 0, abandoned: 0 });
    expect(auditPuts()).toEqual([]);
  });

  test('a marker that names another request (made after an admin\'s Delete took the old one) is not ours: it is left, and the row goes alone', async () => {
    rows(withdrawn());
    ddb.on(TransactWriteCommand).rejects(Object.assign(named('TransactionCanceledException'), { CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }] }));
    ddb.on(DeleteCommand).resolves({});
    expect(await run()).toEqual({ removed: 1, failures: 0, abandoned: 0 });
    // The only delete outside the refused transaction is the row's own, still guarded on its state.
    expect(ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input)).toEqual([
      { TableName: 'members', Key: { user_guid: G }, ConditionExpression: '#s = :s', ExpressionAttributeNames: { '#s': 'state' }, ExpressionAttributeValues: { ':s': 'withdrawn' } },
    ]);
    expect(events()).toEqual([expect.objectContaining({ action: 'request.removed', subject: G })]);
    expect(emf()[0]).toMatchObject({ RequestRemovalFailures: 0, RequestRemovalAbandoned: 0 });
    expectCleanLogs();
  });

  test('another request\'s marker, and the row gone meanwhile too: nothing is deleted, counted or audited', async () => {
    rows(withdrawn());
    ddb.on(TransactWriteCommand).rejects(Object.assign(named('TransactionCanceledException'), { CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }] }));
    ddb.on(DeleteCommand).rejects(ccf());
    expect(await run()).toEqual({ removed: 0, failures: 0, abandoned: 0 });
    expect(auditPuts()).toEqual([]);
  });

  test('the 15-minute run does nothing else (no start-overs, no daily work)', async () => {
    rows();
    await run();
    expect(ddb.commandCalls(ScanCommand)).toHaveLength(0);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(1);
  });
});

describe('cleanup: declined requests are kept 30 days (daily run)', () => {
  const now = Date.now();
  const declined = (over: Record<string, unknown>) => ({ user_guid: G, email: ADDR, state: 'rejected', account_status: 'active', email_verified: true, owns_identity: true, reject_reason: 'no', ...over });
  const rows = (...items: Record<string, unknown>[]) =>
    ddb.on(QueryCommand).callsFake((input) => (input.TableName === 'members' && input.ExpressionAttributeValues?.[':r'] === 'rejected' ? { Items: items } : { Items: [] }));

  beforeEach(() => {
    ddb.on(GetCommand, { TableName: 'list' }).resolves({});
    ddb.on(TransactWriteCommand).resolves({});
    ses.on(DeleteEmailIdentityCommand).resolves({});
  });

  test('31 days after the decline: row, marker and its own SES identity go; 29 days: kept', async () => {
    rows(
      declined({ rejected_at: new Date(now - 31 * DAY).toISOString(), updated_at: new Date(now - 31 * DAY).toISOString() }),
      declined({ user_guid: G2, email: 'later@example.net', rejected_at: new Date(now - 29 * DAY).toISOString(), updated_at: new Date(now - 29 * DAY).toISOString() }),
    );
    const r = await cleanup.handler();
    expect(r.declined).toEqual({ removed: 1, failures: 0, abandoned: 0 });
    const txs = ddb.commandCalls(TransactWriteCommand).map((c) => c.args[0].input.TransactItems!);
    expect(txs).toHaveLength(1);
    expect(txs[0][0].Delete).toMatchObject({ Key: { user_guid: G }, ExpressionAttributeValues: { ':s': 'rejected' } });
    expect(txs[0][1].Delete!.Key).toEqual({ user_guid: `email:${ADDR}` });
    expect(ses.commandCalls(DeleteEmailIdentityCommand).map((c) => c.args[0].input.EmailIdentity)).toEqual([ADDR]);
    expect(events()).toEqual([expect.objectContaining({ actor: 'system', action: 'request.removed', subject: G, detail: { after: 'decline', identity: 'deleted' } })]);
    expect(JSON.stringify(auditPuts())).not.toContain('@');
    expectCleanLogs();
  });

  test('declined before 2.6.0 (no rejected_at): 30 days from the row\'s last change, which was the decline; its identity has no flag and is kept', async () => {
    rows(
      declined({ owns_identity: undefined, updated_at: new Date(now - 40 * DAY).toISOString() }),
      declined({ user_guid: G2, email: 'recent@example.net', owns_identity: undefined, updated_at: new Date(now - 3 * DAY).toISOString() }),
    );
    const r = await cleanup.handler();
    expect(r.declined.removed).toBe(1);
    expect(ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems![0].Delete!.Key).toEqual({ user_guid: G });
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
  });

  test('rejected_at decides, not a later change to the row', async () => {
    rows(declined({ rejected_at: new Date(now - 31 * DAY).toISOString(), updated_at: new Date(now - DAY).toISOString() }));
    expect((await cleanup.handler()).declined.removed).toBe(1);
  });

  test('a failing sweep is counted and does not stop the rest of the daily run', async () => {
    ddb.on(QueryCommand).callsFake((input) => {
      if (input.ExpressionAttributeValues?.[':r'] === 'rejected') throw named('InternalServerError');
      return { Items: [] };
    });
    const r = await cleanup.handler();
    expect(r.declined.failures).toBe(1);
    expect(r).toMatchObject({ deleted: 0, expired: 0 });
  });

  test('the 14-day reclaim of an unverified request leaves an identity the request did not create', async () => {
    const stale = { user_guid: G, email: ADDR, state: 'requested', email_verified: false, owns_identity: false };
    ddb.on(QueryCommand).callsFake((input) => (input.ExpressionAttributeValues?.[':before'] ? { Items: [stale] } : { Items: [] }));
    ddb.on(DeleteCommand).resolves({});
    const r = await cleanup.handler();
    expect(r.reclaimed).toBe(1);
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
  });
});

describe('admin: decline, approve, resend', () => {
  const pending = {
    user_guid: G, email: ADDR, first_name: 'Ada', last_name: 'Lovelace', state: 'requested', account_status: 'active', email_verified: true,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', withdraw_token_hash: 'h',
  };

  test('declining records rejected_at (the start of the 30 days) and keeps the withdrawal link working', async () => {
    ddb.on(GetCommand).resolves({ Item: pending });
    ddb.on(UpdateCommand).resolves({ Attributes: { ...pending, state: 'rejected' } });
    const res = await people.handler(adminEv('POST', `/admin/requests/${G}/reject`, { reason: 'not now' }));
    expect(res.statusCode).toBe(200);
    const u = memberUpdates()[0];
    const set = Object.fromEntries(Object.entries(u.ExpressionAttributeNames!).filter(([k]) => k.startsWith('#s')).map(([k, name]) => [name, u.ExpressionAttributeValues![k.replace('#', ':')]]));
    expect(set).toMatchObject({ state: 'rejected', reject_reason: 'not now' });
    expect(Date.parse(set.rejected_at as string)).toBeGreaterThan(Date.now() - 5000);
    expect(u.UpdateExpression).not.toContain('REMOVE');
    // The decline event keeps the reason; the address is in its 90-day record.
    expect(events()).toEqual([expect.objectContaining({ actor: 'boss@vettid.org', action: 'request.reject', subject: G, detail: { reason: 'not now' } })]);
    expect(addressRecords()).toEqual([expect.objectContaining({ email: ADDR })]);
  });

  test('approving makes an account: the withdrawal token is taken off the row', async () => {
    ddb.on(GetCommand).resolves({ Item: pending });
    ddb.on(UpdateCommand).resolves({ Attributes: { ...pending, state: 'registered' } });
    idp.on(AdminGetUserCommand).resolves({ Enabled: true });
    const res = await people.handler(adminEv('POST', `/admin/requests/${G}/approve`));
    expect(res.statusCode).toBe(200);
    const u = memberUpdates()[0];
    expect(u.UpdateExpression).toContain('REMOVE #r0');
    expect(u.ExpressionAttributeNames!['#r0']).toBe('withdraw_token_hash');
  });

  describe('approve, when Cognito already holds a user for the address', () => {
    const existing = (guid: string | undefined) => {
      ddb.on(GetCommand).resolves({ Item: pending });
      ddb.on(UpdateCommand).resolves({ Attributes: { ...pending, state: 'registered' } });
      idp.on(AdminCreateUserCommand).rejects(named('UsernameExistsException'));
      idp.on(AdminAddUserToGroupCommand).resolves({});
      idp.on(AdminGetUserCommand).callsFake((input) =>
        input.UserPoolId === 'us-east-1_admins' ? { Enabled: true } : { UserAttributes: [{ Name: 'email', Value: ADDR }, ...(guid ? [{ Name: 'custom:user_guid', Value: guid }] : [])] },
      );
    };
    const memberPoolReads = () => idp.commandCalls(AdminGetUserCommand).map((c) => c.args[0].input).filter((i) => i.UserPoolId === 'us-east-1_pool');

    test.each([['another request\'s or account\'s id', G2], ['no id at all', undefined]])(
      'a user with %s (left by an abandoned removal): refused with a clear message, and nothing is changed',
      async (_n, guid) => {
        existing(guid);
        const res = await people.handler(adminEv('POST', `/admin/requests/${G}/approve`));
        expect(res.statusCode).toBe(409);
        const body = JSON.parse(res.body);
        expect(body.error).toBe('conflict');
        expect(body.message).toBe(people.STALE_USER_MESSAGE);
        expect(body.message).toContain('a sign-in user from an earlier request or account already exists for this address');
        expect(body.message).not.toContain(ADDR);
        expect(memberPoolReads()).toEqual([{ UserPoolId: 'us-east-1_pool', Username: ADDR }]);
        // Not an account: no group, no state change, no approval in the audit log.
        expect(idp.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0);
        expect(memberUpdates()).toEqual([]);
        expect(auditPuts()).toEqual([]);
        expectCleanLogs();
      },
    );

    test('a user with this request\'s own id (an approval that stopped half-way): the approval goes through', async () => {
      existing(G);
      const res = await people.handler(adminEv('POST', `/admin/requests/${G}/approve`));
      expect(res.statusCode).toBe(200);
      expect(idp.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(1);
      expect(memberUpdates()).toHaveLength(1);
      expect(events()).toEqual([expect.objectContaining({ action: 'request.approve', subject: G })]);
    });

    test('any other Cognito failure is still an error, and the request stays pending', async () => {
      existing(G);
      idp.on(AdminCreateUserCommand).rejects(named('TooManyRequestsException'));
      const res = await people.handler(adminEv('POST', `/admin/requests/${G}/approve`));
      expect(res.statusCode).toBe(500);
      expect(memberUpdates()).toEqual([]);
    });
  });

  describe('approve, when the row\'s email_verified flag lags behind SES', () => {
    const setOf = (u: ReturnType<typeof memberUpdates>[number]) =>
      Object.fromEntries(Object.entries(u.ExpressionAttributeNames!).filter(([k]) => k.startsWith('#s')).map(([k, name]) => [name, u.ExpressionAttributeValues![k.replace('#', ':')]]));

    test('the flag is set in the same write as the state: the row is never a verified pending request, so "we have your request" is not sent just before "account ready"', async () => {
      ddb.on(GetCommand).resolves({ Item: { ...pending, email_verified: false } });
      ddb.on(UpdateCommand).resolves({ Attributes: { ...pending, state: 'registered' } });
      ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: true });
      const res = await people.handler(adminEv('POST', `/admin/requests/${G}/approve`));
      expect(res.statusCode).toBe(200);
      const updates = memberUpdates();
      expect(updates).toHaveLength(1);
      expect(setOf(updates[0])).toMatchObject({ state: 'registered', email_verified: true });
      expect(updates[0].ConditionExpression).toContain('#c0 = :c0'); // still guarded on `requested`
      expect(updates[0].ExpressionAttributeValues![':c0']).toBe('requested');
      // No write leaves the row `requested` with the flag set.
      for (const u of updates) if (setOf(u).email_verified === true) expect(setOf(u).state).toBe('registered');
    });

    test('SES has not verified it: refused, nothing written', async () => {
      ddb.on(GetCommand).resolves({ Item: { ...pending, email_verified: false } });
      ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: false });
      const res = await people.handler(adminEv('POST', `/admin/requests/${G}/approve`));
      expect(res.statusCode).toBe(409);
      expect(memberUpdates()).toEqual([]);
      expect(idp.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
    });

    test('an already verified row is not rewritten', async () => {
      ddb.on(GetCommand).resolves({ Item: pending });
      ddb.on(UpdateCommand).resolves({ Attributes: { ...pending, state: 'registered' } });
      await people.handler(adminEv('POST', `/admin/requests/${G}/approve`));
      expect(setOf(memberUpdates()[0])).not.toHaveProperty('email_verified');
      expect(ses.commandCalls(GetEmailIdentityCommand)).toHaveLength(0);
    });
  });

  test('a withdrawn request can be neither approved, declined nor re-verified', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...pending, state: 'withdrawn' } });
    for (const action of ['approve', 'reject', 'resend-verification']) {
      const res = await people.handler(adminEv('POST', `/admin/requests/${G}/${action}`, {}));
      expect(res.statusCode).toBe(409);
    }
    expect(memberUpdates()).toEqual([]);
    expect(ses.calls()).toHaveLength(0);
  });

  test('resend verification creates the identity for this row: the row owns it from then on', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...pending, email_verified: false } });
    ddb.on(UpdateCommand).resolves({ Attributes: pending });
    ses.on(GetEmailIdentityCommand).rejects(named('NotFoundException'));
    ses.on(CreateEmailIdentityCommand).resolves({});
    const res = await people.handler(adminEv('POST', `/admin/requests/${G}/resend-verification`));
    expect(res.statusCode).toBe(200);
    expect(memberUpdates()).toEqual([expect.objectContaining({ Key: { user_guid: G }, UpdateExpression: 'SET owns_identity = :t' })]); // updated_at untouched
  });
});

describe('audit: a person\'s address lives 90 days, the event stays', () => {
  test('an event with an address: the event has none; the address record expires 90 days after it', async () => {
    await audit('boss@vettid.org', 'member.delete', G, { email: ADDR, state: 'member' });
    const [e] = events();
    expect(e).toMatchObject({ actor: 'boss@vettid.org', action: 'member.delete', subject: G, detail: { state: 'member' } });
    expect(e).not.toHaveProperty('expires_at'); // events never expire
    expect(JSON.stringify(e)).not.toContain(ADDR);
    const [a] = addressRecords();
    expect(Object.keys(a).sort()).toEqual(['email', 'expires_at', 'month', 'ts_id']); // no actor, no subject: in no index
    expect(a).toMatchObject({ month: `addr#${e.month}`, ts_id: e.ts_id, email: ADDR });
    expect(a.expires_at).toBe(Math.floor(Date.parse(e.ts) / 1000) + 90 * 86_400);
    expect(AUDIT_ADDRESS_DAYS).toBe(90);
  });

  test('an event without an address writes one item', async () => {
    await audit('system', 'request.removed', G, { after: 'withdraw', identity: 'kept' });
    expect(auditPuts()).toHaveLength(1);
  });

  test('a member\'s own action is recorded under their account id, never their address', () => {
    expect(memberActor(G)).toBe(`member:${G}`);
    // No code that runs for members, the public or the jobs passes an address as the actor.
    const offenders: string[] = [];
    for (const dir of ['member', 'jobs', 'shared', 'triggers']) {
      const base = join(__dirname, '..', '..', 'lambda', dir);
      for (const f of readdirSync(base).filter((n) => n.endsWith('.ts'))) {
        const src = readFileSync(join(base, f), 'utf8');
        for (const m of src.matchAll(/\baudit\(\s*([^,]+),/g)) if (/email|addr/i.test(m[1])) offenders.push(`${dir}/${f}: audit(${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no member route audits with the member\'s address as the actor: `audit(m.email` appears nowhere under lambda/member/', () => {
    const base = join(__dirname, '..', '..', 'lambda', 'member');
    const files = readdirSync(base, { recursive: true, encoding: 'utf8' }).filter((n) => n.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(3); // public.ts, account.ts, vault.ts at least: the check reads something
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(join(base, f), 'utf8').split('\n').forEach((line, i) => {
        if (/\baudit\s*\(\s*m\s*\.\s*email\b/.test(line)) hits.push(`lambda/member/${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  describe('GET /admin/audit', () => {
    const nowS = Math.floor(Date.now() / 1000);
    const e1 = { month: '2026-10', ts_id: '2026-10-12T10:00:00.000Z#aa', ts: '2026-10-12T10:00:00.000Z', actor: 'boss@vettid.org', action: 'request.reject', subject: G, detail: { reason: 'r' } };
    const e2 = { month: '2026-10', ts_id: '2026-10-11T10:00:00.000Z#bb', ts: '2026-10-11T10:00:00.000Z', actor: 'public', action: 'request.withdraw', subject: G, detail: { from: 'requested' } };
    const e3 = { month: '2026-07', ts_id: '2026-07-01T10:00:00.000Z#cc', ts: '2026-07-01T10:00:00.000Z', actor: 'boss@vettid.org', action: 'member.delete', subject: G2, detail: {} };

    test('returns each event with its address while the 90 days run, and without it afterwards (also before the TTL has deleted the record)', async () => {
      ddb.on(QueryCommand).resolves({ Items: [e1, e2, e3] });
      ddb.on(BatchGetCommand).resolves({
        Responses: {
          audit: [
            { month: 'addr#2026-10', ts_id: e1.ts_id, email: ADDR, expires_at: nowS + 1000 },
            { month: 'addr#2026-07', ts_id: e3.ts_id, email: 'gone@example.net', expires_at: nowS - 10 },
          ],
        },
      });
      const res = await system.handler(adminEv('GET', '/admin/audit', undefined, { month: '2026-10' }));
      expect(res.statusCode).toBe(200);
      const { items } = JSON.parse(res.body);
      expect(items).toEqual([
        { ts: e1.ts, actor: e1.actor, action: e1.action, subject: G, detail: { reason: 'r' }, email: ADDR },
        { ts: e2.ts, actor: 'public', action: 'request.withdraw', subject: G, detail: { from: 'requested' } },
        { ts: e3.ts, actor: e3.actor, action: 'member.delete', subject: G2, detail: {} },
      ]);
      const keys = ddb.commandCalls(BatchGetCommand)[0].args[0].input.RequestItems!.audit.Keys;
      expect(keys).toEqual([
        { month: 'addr#2026-10', ts_id: e1.ts_id },
        { month: 'addr#2026-10', ts_id: e2.ts_id },
        { month: 'addr#2026-07', ts_id: e3.ts_id },
      ]);
    });

    test('an empty page asks for nothing', async () => {
      ddb.on(QueryCommand).resolves({ Items: [] });
      const res = await system.handler(adminEv('GET', '/admin/audit'));
      expect(JSON.parse(res.body).items).toEqual([]);
      expect(ddb.commandCalls(BatchGetCommand)).toHaveLength(0);
    });
  });

  describe('events from before 2.6.0 (scripts/ops/audit-address-backfill.ts)', () => {
    const now = Date.parse('2026-10-12T00:00:00Z');
    const row = (over: Record<string, unknown>) => ({ month: '2026-10', ts_id: '2026-10-01T00:00:00.000Z#ab', ts: '2026-10-01T00:00:00.000Z', actor: 'boss@vettid.org', action: 'request.approve', subject: G, detail: {}, ...over });

    test('detail.email of an event younger than 90 days moves to a record that expires 90 days after the event', () => {
      expect(backfill.plan(row({ detail: { email: ADDR } }), now)).toEqual({ removeEmail: true, addressExpiresAt: Date.parse('2026-10-01T00:00:00Z') / 1000 + 90 * 86_400, unclassified: false });
    });

    test('older than 90 days: the address is removed and not kept', () => {
      expect(backfill.plan(row({ month: '2026-06', ts_id: '2026-06-01T00:00:00.000Z#ab', ts: '2026-06-01T00:00:00.000Z', detail: { email: ADDR, reason: 'x' } }), now)).toEqual({ removeEmail: true, unclassified: false });
    });

    test('a member\'s own action: the actor becomes member:<id>; an administrator\'s address stays', () => {
      expect(backfill.plan(row({ actor: ADDR, action: 'vault.unlock_request' }), now)).toEqual({ removeEmail: false, actor: `member:${G}`, unclassified: false });
      expect(backfill.plan(row({ actor: ADDR, action: 'member.accept_terms' }), now).actor).toBe(`member:${G}`);
      for (const action of ['request.approve', 'member.delete', 'member.suspend', 'admin.create', 'vault.service.pause', 'terms.publish', 'invite.create', 'subscription.extend', 'member.vault_canary.set']) {
        expect(backfill.plan(row({ action }), now)).toEqual({ removeEmail: false, unclassified: false });
      }
    });

    test('an address as actor of an action the script does not know is reported, not rewritten', () => {
      expect(backfill.plan(row({ actor: ADDR, action: 'something.new' }), now)).toEqual({ removeEmail: false, unclassified: true });
    });

    test('address records, converted events and system events are left alone', () => {
      expect(backfill.plan({ month: 'addr#2026-10', ts_id: 'x', email: ADDR }, now)).toEqual({ removeEmail: false, unclassified: false });
      expect(backfill.plan(row({ actor: `member:${G}`, action: 'vault.unlock_request' }), now)).toEqual({ removeEmail: false, unclassified: false });
      expect(backfill.plan(row({ actor: 'system', action: 'request.removed' }), now)).toEqual({ removeEmail: false, unclassified: false });
    });

    test('an --apply run leaves one event of its own: the operator, the table, the counts; no address; a later run leaves it alone', () => {
      const counts = { events: 120, emailRemoved: 40, addressKept90: 25, addressGone: 15, actorRewritten: 30, unclassified: 2 };
      const operator = 'arn:aws:sts::449757308783:assumed-role/AWSReservedSSO_AdministratorAccess_0123456789abcdef/owner@vettid.org';
      const e = backfill.backfillEvent(operator, 'prod', 'vettid-org-audit', counts, true, '2026-10-13T09:00:00.000Z');
      expect(e).toEqual({
        month: '2026-10',
        ts_id: expect.stringMatching(/^2026-10-13T09:00:00\.000Z#[0-9a-f]{12}$/),
        ts: '2026-10-13T09:00:00.000Z',
        actor: operator,
        action: 'admin.audit_address_backfill',
        subject: 'vettid-org-audit',
        detail: { stage: 'prod', completed: true, events_scanned: 120, email_removed: 40, address_kept_90_days: 25, address_gone: 15, actor_rewritten: 30, unclassified_left: 2 },
      });
      expect(backfill.backfillEvent(operator, 'staging', 't', counts, false, '2026-10-13T09:00:00.000Z').detail.completed).toBe(false);
      // The operator is staff: the next run neither rewrites nor reports this event.
      expect(backfill.plan(e, now)).toEqual({ removeEmail: false, unclassified: false });
    });

    test('the script writes that event on --apply only, and also when the run stops on an error', () => {
      const src = readFileSync(join(__dirname, '..', '..', 'scripts', 'ops', 'audit-address-backfill.ts'), 'utf8');
      expect(src).toMatch(/const record = async \(completed: boolean\): Promise<void> => \{\s*if \(!apply\) return;/);
      expect(src).toMatch(/catch \(e\) \{\s*await record\(false\)/);
      expect(src).toMatch(/await record\(true\);/);
    });

    test('every action a member route audits today is one the script knows', () => {
      const found = new Set<string>();
      for (const f of ['account.ts', 'vault.ts']) {
        const src = readFileSync(join(__dirname, '..', '..', 'lambda', 'member', f), 'utf8');
        for (const m of src.matchAll(/audit\(memberActor\(m\.user_guid\), ([^,]+),/g)) {
          for (const a of m[1].matchAll(/'([a-z_.]+)'/g)) found.add(a[1]);
        }
      }
      expect(found.size).toBeGreaterThan(20);
      expect([...found].filter((a) => !backfill.MEMBER_ACTIONS.has(a))).toEqual([]);
    });
  });
});

describe('the emails (the owner\'s wording: "request for early access")', () => {
  test('"we have your request": what it says', () => {
    const m = requests.requestReceivedMail('https://account.vettid.org/request/withdraw/#w=TOKEN');
    expect(m.subject).toBe('We have your request for early access to VettID');
    expect(m.text).toBe(
      'Your email address is confirmed, and we have your request for early access to VettID. ' +
        "An administrator will review it. If it is approved, we'll email you when your account is ready.\n\n" +
        'If you change your mind, you can withdraw the request here. That deletes it, with your name and email address:\n\n' +
        'https://account.vettid.org/request/withdraw/#w=TOKEN\n\n' +
        "The link works for as long as we hold the request. If you didn't ask for early access to VettID, use it to remove the request.\n\n" +
        '— VettID\n',
    );
  });

  test('the admin notices: exact texts, no "membership request"', () => {
    expect(requests.adminNotice('arrived')).toEqual({
      subject: 'VettID: a request for early access arrived',
      text: 'A request for early access arrived. Its email address is not verified yet: there is nothing to do until it is (another notice says so).\nadmin: https://admin.vettid.org/#requests\n',
    });
    expect(requests.adminNotice('arrived_verified')).toEqual({
      subject: 'VettID: a request for early access arrived',
      text: 'A request for early access arrived. Its email address is already verified: it can be reviewed now.\nadmin: https://admin.vettid.org/#requests\n',
    });
    expect(requests.adminNotice('verified')).toEqual({
      subject: 'VettID: a request for early access was verified',
      text: 'The email address of a request for early access was verified. It can be reviewed now.\nadmin: https://admin.vettid.org/#requests\n',
    });
    expect(requests.adminNotice('registered')).toEqual({
      subject: 'VettID: someone registered with a registration code',
      text: 'Someone registered with a registration code. The account exists; nothing to review.\nadmin: https://admin.vettid.org/#members\n',
    });
  });

  test('the withdraw page and its script say "request for early access", like the privacy notice, and name the email by its subject', () => {
    const root = join(__dirname, '..', '..');
    const page = readFileSync(join(root, 'sites', 'account', 'request', 'withdraw', 'index.html'), 'utf8');
    const script = readFileSync(join(root, 'sites', 'account', 'js', 'request-withdraw.js'), 'utf8');
    expect(page).toContain('<title>Withdraw a request for early access · VettID</title>');
    expect(page).toContain('<h1>Withdraw a request for early access</h1>');
    expect(script).toContain(`“${requests.requestReceivedMail('x').subject}”`);
    for (const text of [page, script]) expect(text).not.toMatch(/membership request/i);
    // The request form, the pages that link to it and the admin site use the same wording.
    const site = (...p: string[]) => readFileSync(join(root, 'sites', ...p), 'utf8');
    const form = site('account', 'request', 'index.html');
    expect(form).toContain('<title>Request early access · VettID</title>');
    expect(form).toContain('<h1>Request early access</h1>');
    expect(form).toContain('<button type="submit" class="btn btn-primary">Request early access</button>');
    for (const p of [['account', 'index.html'], ['account', 'signin', 'index.html'], ['account', 'guide', 'index.html']]) expect(site(...p)).toContain('href="/request/">Request early access</a>');
    expect(site('admin', 'js', 'sections', 'requests.js')).toContain("'Requests for early access made without a valid registration code, oldest first.");
    expect(site('admin', 'js', 'sections', 'invites.js')).toContain("'A valid code on a request for early access skips the approval queue.");
    for (const p of [['account', 'request', 'index.html'], ['account', 'index.html'], ['account', 'signin', 'index.html'], ['account', 'guide', 'index.html'], ['admin', 'js', 'sections', 'requests.js'], ['admin', 'js', 'sections', 'invites.js']]) {
      // The privacy notice's anchor keeps its name; comments are not text.
      const visible = site(...p).replace(/#membership-requests/g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
      expect(visible).not.toMatch(/membership requests?|request membership/i);
    }
    expect(readFileSync(join(root, 'website', 'privacy', 'index.html'), 'utf8')).toContain('Requests for early access (account.vettid.org)');
    // The specification quotes the same subjects.
    const spec = readFileSync(join(root, 'docs', 'MEMBER-API.md'), 'utf8').replace(/\s+/g, ' ');
    for (const subject of [requests.requestReceivedMail('x').subject, requests.adminNotice('arrived').subject, requests.adminNotice('verified').subject]) expect(spec).toContain(`"${subject}"`);
  });

  test('our own addresses are never given up to SES deletion', () => {
    for (const a of ['admin@vettid.org', 'x@test.staging.vettid.org', 'no-reply@staging.vettid.org']) expect(requests.ownAddress(a)).toBe(true);
    for (const a of [ADDR, 'x@vettid.org.example.com', 'x@notvettid.org']) expect(requests.ownAddress(a)).toBe(false);
  });
});
