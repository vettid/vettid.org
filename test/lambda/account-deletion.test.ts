// MEMBER-API 2.14.0 "Deleting the account" (ACCOUNT-ADMIN-PLAN §5.4): the
// account function's four routes, and the withdrawn POST /api/account/cancel.
import { createHmac } from 'node:crypto';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { AdminDisableUserCommand, AdminEnableUserCommand, AdminUserGlobalSignOutCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

Object.assign(process.env, {
  TABLE_MEMBERS: 'members', TABLE_TERMS: 'terms', TABLE_SUBSCRIPTIONS: 'subs', TABLE_AUDIT: 'audit', TABLE_RATELIMITS: 'rl',
  TABLE_MAILING_LIST: 'list', MEMBER_POOL_ID: 'us-east-1_pool', MEMBER_CLIENT_ID: 'client', PIN_PEPPER_SECRET_ARN: 'pepper',
  ORIGIN_VERIFY_SECRET_ARN: 'origin', SENDER_EMAIL: 'no-reply@vettid.org', ACCOUNT_HOST: 'account.vettid.org',
  MEMBER_VAULTS_FN: 'arn:aws:lambda:us-east-1:123456789012:function:Member-MemberVaults',
});

/* eslint-disable @typescript-eslint/no-require-imports */
const account = require('../../lambda/member/account');
const memberHttp = require('../../lambda/shared/member-http');
const { hashPin } = require('../../lambda/shared/pin');
const { newWithdrawToken } = require('../../lambda/shared/requests');
const { TEXT } = require('../../lambda/shared/account-deletion');
const { HttpError } = require('../../lambda/shared/http');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const idp = mockClient(CognitoIdentityProviderClient);
const ses = mockClient(SESv2Client);
const sm = mockClient(SecretsManagerClient);
const lam = mockClient(LambdaClient);

const ORIGIN = 'origin-secret-value';
const G = '11111111-2222-4333-8444-555555555555';
const ADDR = 'leaving@example.org';
const ev = (method: string, path: string, body?: unknown) =>
  ({
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    cookies: [],
    headers: { 'x-origin-verify': ORIGIN, 'x-vettid-csrf': '1', 'cloudfront-viewer-address': '203.0.113.9:443' },
    requestContext: { http: { method, sourceIp: '10.0.0.1' } },
  }) as any;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await account.handler(ev(method, path, body));
  return { status: res.statusCode as number, body: JSON.parse(res.body), cookies: (res.cookies ?? []) as string[] };
};
const ccf = () => Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' });
const named = (name: string) => Object.assign(new Error(name), { name });

let current: Record<string, unknown> | undefined;
let order: string[];
let logged: string[];
const base = { user_guid: G, email: ADDR, state: 'member', account_status: 'active', email_verified: true, created_at: 'x', updated_at: 'x' };
/** The member-vaults function's answer (or a function error). */
const vaults = (v: Record<string, unknown>[] | 'error' | 'malformed' | 'throws') =>
  lam.on(InvokeCommand).callsFake((input) => {
    order.push('vault_check');
    expect(input).toMatchObject({ FunctionName: process.env.MEMBER_VAULTS_FN, InvocationType: 'RequestResponse' });
    expect(JSON.parse(Buffer.from(input.Payload).toString())).toEqual({ task: 'member_vaults', user_guid: G });
    if (v === 'throws') throw named('TooManyRequestsException');
    if (v === 'error') return { StatusCode: 200, FunctionError: 'Unhandled', Payload: Buffer.from('{"errorMessage":"x"}') };
    if (v === 'malformed') return { StatusCode: 200, Payload: Buffer.from('{"ok":true}') };
    return { StatusCode: 200, Payload: Buffer.from(JSON.stringify({ ok: true, task: 'member_vaults', vaults: v })) };
  });
const memberUpdates = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'members');
const rlKeys = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'rl').map((i) => String(i.Key!.key));
const events = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'audit').map((i) => i.Item!);
const mails = () => ses.commandCalls(SendEmailCommand).map((c) => ({ to: c.args[0].input.Destination!.ToAddresses![0], subject: c.args[0].input.Content!.Simple!.Subject!.Data, text: c.args[0].input.Content!.Simple!.Body!.Text!.Data! }));
const PEPPER = 'pepper-value';
const codeHash = (codeId: string, code: string) => createHmac('sha256', PEPPER).update(`acctdel-code\u0000${G}\u0000${codeId}\u0000${code}`).digest('hex');
/** A code on the row, `attempts` spent so far. */
const withCode = (code = '123456', over: Record<string, unknown> = {}) => ({
  ...base, deletion_code: { code_id: 'c1', hash: codeHash('c1', code), expires_at: Math.floor(Date.now() / 1000) + 600, attempts: 0, ...over },
});
/** The spend: answers the attempt number the row now has. */
const attempts = (n: number) =>
  ddb.on(UpdateCommand, { TableName: 'members' }).callsFake((i) => {
    if (String(i.UpdateExpression).startsWith('SET deletion_code.attempts')) return (order.push('spend'), { Attributes: { deletion_code: { attempts: n } } });
    if (i.UpdateExpression === 'REMOVE deletion_code') return (order.push('code_removed'), {});
    order.push('write');
    return { Attributes: { ...current, account_status: 'canceled' } };
  });

beforeEach(() => {
  ddb.reset(); idp.reset(); ses.reset(); sm.reset(); lam.reset();
  order = [];
  current = { ...base };
  sm.on(GetSecretValueCommand, { SecretId: 'origin' }).resolves({ SecretString: ORIGIN });
  sm.on(GetSecretValueCommand, { SecretId: 'pepper' }).resolves({ SecretString: PEPPER });
  ddb.on(UpdateCommand, { TableName: 'rl' }).resolves({ Attributes: { count: 1 } });
  ddb.on(PutCommand).resolves({});
  ddb.on(GetCommand, { TableName: 'members' }).callsFake((i) => (order.push(i.ConsistentRead ? 'consistent_read' : 'read'), { Item: current }));
  ddb.on(GetCommand, { TableName: 'list' }).resolves({ Item: { email: ADDR } });
  ses.on(SendEmailCommand).resolves({});
  idp.on(AdminDisableUserCommand).callsFake(() => (order.push('disable'), {}));
  idp.on(AdminUserGlobalSignOutCommand).callsFake(() => (order.push('sign_out'), {}));
  idp.on(AdminEnableUserCommand).callsFake(() => (order.push('enable'), {}));
  vaults([]);
  jest.spyOn(memberHttp, 'requireSession').mockResolvedValue({ email: ADDR, user_guid: G });
  logged = [];
  for (const k of ['log', 'warn', 'error'] as const) {
    jest.spyOn(console, k).mockImplementation((...a: unknown[]) => {
      logged.push(a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? `${x.name}: ${x.message}` : JSON.stringify(x))).join(' '));
    });
  }
});
afterEach(() => jest.restoreAllMocks());
/** Logs carry ids and error names only. */
const cleanLogs = (...secrets: string[]) => {
  const all = logged.join('\n');
  for (const s of [ADDR, 'example.org', ...secrets]) expect(all).not.toContain(s);
};

test('POST /api/account/cancel is withdrawn: 404, as for any unknown route, and nothing is read or written', async () => {
  const r = await call('POST', '/api/account/cancel', { confirm: 'CANCEL' });
  expect(r).toMatchObject({ status: 404, body: { error: 'not_found' } });
  expect(ddb.calls()).toHaveLength(0);
  expect(idp.calls()).toHaveLength(0);
});

describe('GET /api/account/deletion', () => {
  test('what the page needs: no vault, the PIN asked when set, the address on the mailing list', async () => {
    current = { ...base, pin_hash: 'x' };
    expect(await call('GET', '/api/account/deletion')).toMatchObject({ status: 200, body: { blocked_by: null, pin_required: true, mailing_list: true } });
    ddb.on(GetCommand, { TableName: 'list' }).resolves({});
    current = { ...base };
    expect((await call('GET', '/api/account/deletion')).body).toEqual({ blocked_by: null, pin_required: false, mailing_list: false });
  });

  test('a vault that blocks it is listed; a never-sealed row is not; an answer without never_sealed counts the vault', async () => {
    vaults([{ vault_id: 'a'.repeat(32), state: 'locked', never_sealed: false }, { vault_id: 'b'.repeat(32), state: 'enrolling', never_sealed: true }, { vault_id: 'c'.repeat(32), state: 'unlocked' }]);
    expect((await call('GET', '/api/account/deletion')).body.blocked_by).toEqual({ vaults: [{ vault_id: 'a'.repeat(32), state: 'locked' }, { vault_id: 'c'.repeat(32), state: 'unlocked' }] });
    vaults([{ vault_id: 'b'.repeat(32), state: 'enrolling', never_sealed: true }]);
    expect((await call('GET', '/api/account/deletion')).body.blocked_by).toBeNull();
  });

  test.each(['error', 'malformed', 'throws'] as const)('the vault check fails closed (%s): 500, never "no vault"', async (how) => {
    vaults(how);
    const r = await call('GET', '/api/account/deletion');
    expect(r.status).toBe(500);
    expect(r.body).not.toHaveProperty('blocked_by');
  });

  test('an account that is not active, or no session: refused', async () => {
    for (const account_status of ['suspended', 'canceled']) {
      current = { ...base, account_status };
      expect(await call('GET', '/api/account/deletion')).toMatchObject({ status: 403, body: { message: 'This account is not active' } });
    }
    memberHttp.requireSession.mockRejectedValue(new HttpError(401, 'unauthorized', 'Not signed in'));
    expect((await call('GET', '/api/account/deletion')).status).toBe(401);
    expect(lam.commandCalls(InvokeCommand)).toHaveLength(0);
  });
});

describe('POST /api/account/deletion/code', () => {
  test('the vault check first; then a 6-digit code, stored only as its HMAC (under the PIN pepper, with a purpose label), 15 minutes, emailed; audited without detail', async () => {
    ddb.on(UpdateCommand, { TableName: 'members' }).callsFake(() => (order.push('write'), {}));
    const before = Math.floor(Date.now() / 1000);
    const r = await call('POST', '/api/account/deletion/code');
    expect(r.status).toBe(202);
    expect(order).toEqual(['read', 'vault_check', 'write']);
    const [w] = memberUpdates();
    expect(w.ConditionExpression).toBe('account_status = :active');
    const stored = Object.entries(w.ExpressionAttributeNames!).find(([, v]) => v === 'deletion_code')![0].replace('#k', ':v');
    const dc = w.ExpressionAttributeValues![stored];
    expect(dc).toEqual({ code_id: expect.any(String), hash: expect.stringMatching(/^[0-9a-f]{64}$/), expires_at: expect.any(Number), attempts: 0 });
    expect(dc.expires_at - before).toBeGreaterThanOrEqual(900);
    expect(dc.expires_at - before).toBeLessThanOrEqual(901);
    expect(r.body).toEqual({ expires_at: new Date(dc.expires_at * 1000).toISOString() });
    const [m] = mails();
    expect(mails()).toHaveLength(1);
    const code = /enter this code on the page: (\d{6})\./.exec(m.text)![1];
    expect(m).toEqual({
      to: ADDR,
      subject: 'Your VettID account deletion code',
      text:
        `Someone signed in to your VettID account asked to delete it. If it was you, enter this code on the page: ${code}. ` +
        "It works for 15 minutes. If it wasn't you, don't share the code. Your account stays as it is, but someone may be able to sign in as you: write to support@vettid.org.\n",
    });
    expect(dc.hash).toBe(codeHash(dc.code_id, code));
    expect(JSON.stringify(dc)).not.toContain(code);
    // It can never equal a PIN's HMAC (`<guid>:<pin>`).
    expect(dc.hash).not.toBe(await hashPin(G, code));
    expect(events().map((e) => [e.actor, e.action, e.subject, e.detail])).toEqual([[`member:${G}`, 'member.deletion_code', G, {}]]);
    expect(rlKeys()).toEqual([expect.stringMatching(new RegExp(`^acctdel-code#${G}#\\d+$`)), expect.stringMatching(/^link#email#leaving@example\.org#\d+$/), expect.stringMatching(/^link#global#\d+$/)]);
    cleanLogs(code);
  });

  test.each([
    ['a vault', [{ vault_id: 'a'.repeat(32), state: 'locked', never_sealed: false }], TEXT.vault],
    ['an unfinished setup', [{ vault_id: 'a'.repeat(32), state: 'enrolling', never_sealed: false }], TEXT.enrolling],
  ])('409 vault_exists for %s, with its text and the vaults; no code is made or sent', async (_n, v, message) => {
    vaults(v);
    const r = await call('POST', '/api/account/deletion/code');
    expect(r).toEqual({ status: 409, body: { error: 'vault_exists', message, vaults: v.map(({ vault_id, state }) => ({ vault_id, state })) }, cookies: [] });
    expect(memberUpdates()).toEqual([]);
    expect(mails()).toEqual([]);
    expect(rlKeys()).toEqual([]);
  });

  test('the texts of the vault refusals are those of the page', () => {
    expect(TEXT.vault).toBe('You still have a vault. Your VettID account can be deleted only after your vault. Delete your vault in the VettID app, or here with Delete my vault and start over, which takes 24 hours. Then come back to this page.');
    expect(TEXT.enrolling).toBe("Your vault setup isn't finished. Your VettID account can be deleted only when no vault is left. Finish setting up your vault in the VettID app and then delete it there, or write to support@vettid.org to end the setup.");
  });

  test('the vault check fails closed: 500, no code', async () => {
    vaults('throws');
    expect((await call('POST', '/api/account/deletion/code')).status).toBe(500);
    expect(memberUpdates()).toEqual([]);
    expect(mails()).toEqual([]);
  });

  test.each([
    ['3 codes an hour per account', 'acctdel-code#', TEXT.codeLimit],
    ["sign-in's 5 mails an hour per address", 'link#email#', TEXT.tooMany],
    ["sign-in's global hourly cap", 'link#global', TEXT.tooMany],
  ])('429 past %s, with its text; no code', async (_n, prefix, message) => {
    ddb.on(UpdateCommand, { TableName: 'rl' }).callsFake((i) => ({ Attributes: { count: String(i.Key.key).startsWith(prefix) ? 999 : 1 } }));
    const r = await call('POST', '/api/account/deletion/code');
    expect(r).toMatchObject({ status: 429, body: { error: 'rate_limited', message, retry_after: expect.any(Number) } });
    expect(memberUpdates()).toEqual([]);
    expect(mails()).toEqual([]);
  });

  test("the email can't be sent: 500 with its text, and this code is taken off again (only this one)", async () => {
    ddb.on(UpdateCommand, { TableName: 'members' }).resolves({});
    ses.on(SendEmailCommand).rejects(named('MessageRejected'));
    const r = await call('POST', '/api/account/deletion/code');
    expect(r).toMatchObject({ status: 500, body: { message: TEXT.codeNotSent } });
    const [set, undo] = memberUpdates();
    expect(undo).toEqual({ TableName: 'members', Key: { user_guid: G }, UpdateExpression: 'REMOVE deletion_code', ConditionExpression: 'deletion_code.code_id = :id', ExpressionAttributeValues: { ':id': expect.any(String) } });
    expect(Object.values(set.ExpressionAttributeValues!).find((v: any) => v?.code_id)).toMatchObject({ code_id: undo.ExpressionAttributeValues![':id'] });
    expect(events()).toEqual([]);
    expect(TEXT.codeNotSent).toBe("We couldn't send the code. Nothing has changed. Try again in a few minutes, or write to support@vettid.org.");
    cleanLogs();
  });
});

describe('POST /api/account/deletion', () => {
  const body = { confirm: 'delete my account', code: '123456', remove_from_mailing_list: true };

  test('in order: the session and active, the phrase, the PIN, the code, the vault; then one conditional write, cookies cleared, sign-in disabled, sessions ended; 202', async () => {
    current = { ...withCode(), pin_hash: await hashPin(G, '4826') };
    attempts(1);
    const t0 = Date.now();
    const r = await call('POST', '/api/account/deletion', { ...body, pin: '4826' });
    expect(r.status).toBe(202);
    expect(order).toEqual(['read', 'spend', 'code_removed', 'vault_check', 'write', 'disable', 'sign_out']);
    expect(rlKeys()[0]).toBe(`pinfail#${G}`); // the PIN's reserved attempt, before the code
    expect(r.body).toEqual({ deletion_id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/), requested_at: expect.any(String), deletes_at: expect.any(String) });
    expect(Date.parse(r.body.deletes_at) - Date.parse(r.body.requested_at)).toBe(7 * 86_400_000);
    expect(Date.parse(r.body.requested_at)).toBeGreaterThanOrEqual(t0 - 5);
    const write = memberUpdates().find((u) => u.UpdateExpression!.includes('REMOVE') && !u.UpdateExpression!.startsWith('REMOVE'))!;
    expect(write.ConditionExpression).toBe('account_status = :active');
    const set = Object.fromEntries(Object.entries(write.ExpressionAttributeNames!).filter(([k]) => k.startsWith('#k')).map(([k, v]) => [v, write.ExpressionAttributeValues![k.replace('#k', ':v')]]));
    expect(set).toEqual({
      account_status: 'canceled',
      delete_after: r.body.deletes_at,
      account_deletion: { deletion_id: r.body.deletion_id, requested_at: r.body.requested_at, deletes_at: r.body.deletes_at, mailing_list: 'remove' },
      updated_at: expect.any(String),
    });
    expect(Object.entries(write.ExpressionAttributeNames!).filter(([k]) => k.startsWith('#r')).map(([, v]) => v)).toEqual(['deletion_code']);
    expect(r.cookies).toEqual(expect.arrayContaining([expect.stringMatching(/^vid_id=; Path=\/api; Max-Age=0/), expect.stringMatching(/^vid_rt=; Path=\/api; Max-Age=0/), expect.stringMatching(/^vid_s=; Path=\/; Max-Age=0/)]));
    expect(idp.commandCalls(AdminDisableUserCommand).map((c) => c.args[0].input)).toEqual([{ UserPoolId: 'us-east-1_pool', Username: ADDR }]);
    expect(events().map((e) => [e.action, e.detail])).toEqual([['member.deletion_request', { deletion_id: r.body.deletion_id, deletes_at: r.body.deletes_at, mailing_list: 'remove' }]]);
    // No email from here: the confirmation is the stream mailer's.
    expect(mails()).toEqual([]);
    cleanLogs('123456', '4826');
  });

  test('remove_from_mailing_list false: mailing_list keep', async () => {
    current = withCode();
    attempts(1);
    const r = await call('POST', '/api/account/deletion', { ...body, remove_from_mailing_list: false });
    expect(r.status).toBe(202);
    expect(events()[0].detail).toMatchObject({ mailing_list: 'keep' });
  });

  test.each([
    ['no phrase', { ...body, confirm: undefined }, TEXT.phrase],
    ['another phrase', { ...body, confirm: 'Delete my account' }, TEXT.phrase],
    ['the old one', { ...body, confirm: 'CANCEL' }, TEXT.phrase],
    ['no box', { ...body, remove_from_mailing_list: undefined }, 'remove_from_mailing_list must be true or false'],
    ['no code', { ...body, code: undefined }, 'code is required'],
  ])('400 for %s, before the PIN, the code and the vault are looked at', async (_n, b, message) => {
    current = { ...withCode(), pin_hash: await hashPin(G, '4826') };
    attempts(1);
    expect(await call('POST', '/api/account/deletion', b)).toMatchObject({ status: 400, body: { error: 'bad_request', message } });
    expect(order).toEqual(['read']);
    expect(rlKeys()).toEqual([]);
    expect(TEXT.phrase).toBe('Type delete my account exactly as shown.');
  });

  test('a wrong PIN: 403 with the PIN routes\' text; the code is not spent, the vault not checked, nothing written', async () => {
    current = { ...withCode(), pin_hash: await hashPin(G, '4826') };
    attempts(1);
    const r = await call('POST', '/api/account/deletion', { ...body, pin: '4827' });
    expect(r).toMatchObject({ status: 403, body: { error: 'forbidden', message: expect.stringMatching(/^Incorrect PIN\. \d+ attempts left\.$/) } });
    expect(order).toEqual(['read']);
    expect(memberUpdates()).toEqual([]);
    expect(lam.commandCalls(InvokeCommand)).toHaveLength(0);
    // A PIN that is set is asked for.
    expect(await call('POST', '/api/account/deletion', body)).toMatchObject({ status: 400, body: { message: 'Enter your current PIN' } });
  });

  test('a locked PIN entry: the PIN routes\' text', async () => {
    current = { ...withCode(), pin_hash: await hashPin(G, '4826') };
    ddb.on(UpdateCommand, { TableName: 'rl' }).rejects(ccf());
    ddb.on(PutCommand, { TableName: 'rl' }).rejects(ccf());
    ddb.on(GetCommand, { TableName: 'rl' }).resolves({ Item: { count: 5, expires_at: Math.floor(Date.now() / 1000) + 600 } });
    expect(await call('POST', '/api/account/deletion', { ...body, pin: '4826' })).toMatchObject({ status: 403, body: { message: 'Too many incorrect PINs; PIN entry is locked for now.' } });
  });

  test('a wrong code spends one attempt (a conditional update reserved before the compare) and says how many are left; nothing else changes', async () => {
    current = withCode();
    attempts(1);
    const r = await call('POST', '/api/account/deletion', { ...body, code: '654321' });
    expect(r).toMatchObject({ status: 403, body: { error: 'forbidden', message: "That code isn't right. You have 4 more tries." } });
    expect(memberUpdates()).toEqual([{
      TableName: 'members', Key: { user_guid: G },
      UpdateExpression: 'SET deletion_code.attempts = deletion_code.attempts + :one',
      ConditionExpression: 'account_status = :active AND deletion_code.code_id = :id AND deletion_code.attempts < :max AND deletion_code.expires_at > :now',
      ExpressionAttributeValues: { ':one': 1, ':active': 'active', ':id': 'c1', ':max': 5, ':now': expect.any(Number) },
      ReturnValues: 'UPDATED_NEW',
    }]);
    expect(lam.commandCalls(InvokeCommand)).toHaveLength(0);
    // Not six digits is a wrong code like any other.
    order = [];
    attempts(2);
    expect((await call('POST', '/api/account/deletion', { ...body, code: '12345x' })).body.message).toBe("That code isn't right. You have 3 more tries.");
    cleanLogs('654321', '123456');
  });

  test("the last wrong try: its text, and the code is removed (it can't be used again)", async () => {
    current = withCode('123456', { attempts: 4 });
    attempts(5);
    expect((await call('POST', '/api/account/deletion', { ...body, code: '000000' })).body).toMatchObject({ message: "That code isn't right, and it can't be used again. Ask for a new code." });
    expect(order).toEqual(['read', 'spend', 'code_removed']);
    // Even the right code is refused once five attempts are spent.
    order = [];
    ddb.on(UpdateCommand, { TableName: 'members' }).rejects(ccf());
    expect((await call('POST', '/api/account/deletion', body)).body.message).toBe(TEXT.codeExpired);
  });

  test.each([
    ['none asked for', { ...base }],
    ['expired', withCode('123456', { expires_at: Math.floor(Date.now() / 1000) - 1 })],
  ])('the code %s: expired or used, nothing spent', async (_n, row) => {
    current = row;
    expect(await call('POST', '/api/account/deletion', body)).toMatchObject({ status: 403, body: { message: 'That code has expired or was already used. Ask for a new code.' } });
    expect(memberUpdates()).toEqual([]);
  });

  test('two guesses cannot share an attempt, and a code is single use: a lost spend, or a correct code spent by another request meanwhile, is "expired or used"', async () => {
    current = withCode();
    ddb.on(UpdateCommand, { TableName: 'members' }).rejects(ccf());
    expect((await call('POST', '/api/account/deletion', body)).body.message).toBe(TEXT.codeExpired);
    ddb.on(UpdateCommand, { TableName: 'members' }).callsFake((i) => {
      if (String(i.UpdateExpression).startsWith('SET deletion_code.attempts')) return { Attributes: { deletion_code: { attempts: 1 } } };
      throw ccf();
    });
    expect((await call('POST', '/api/account/deletion', body)).body.message).toBe(TEXT.codeExpired);
    expect(lam.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  test('a correct code is spent even if the vault check then refuses: 409 vault_exists, nothing else changes', async () => {
    current = withCode();
    attempts(1);
    vaults([{ vault_id: 'a'.repeat(32), state: 'locked', never_sealed: false }]);
    const r = await call('POST', '/api/account/deletion', body);
    expect(r).toMatchObject({ status: 409, body: { error: 'vault_exists', message: TEXT.vault, vaults: [{ vault_id: 'a'.repeat(32), state: 'locked' }] } });
    expect(order).toEqual(['read', 'spend', 'code_removed', 'vault_check']);
    expect(idp.calls()).toHaveLength(0);
    expect(r.cookies).toEqual([]);
  });

  test('the vault check fails closed: 500 and nothing written', async () => {
    current = withCode();
    attempts(1);
    vaults('error');
    expect((await call('POST', '/api/account/deletion', body)).status).toBe(500);
    expect(order).not.toContain('write');
    expect(idp.calls()).toHaveLength(0);
  });

  test('the account changed meanwhile (the write\'s condition): 500, no Cognito call, cookies kept', async () => {
    current = withCode();
    ddb.on(UpdateCommand, { TableName: 'members' }).callsFake((i) => {
      if (String(i.UpdateExpression).startsWith('SET deletion_code.attempts')) return { Attributes: { deletion_code: { attempts: 1 } } };
      if (i.UpdateExpression === 'REMOVE deletion_code') return {};
      throw ccf();
    });
    const r = await call('POST', '/api/account/deletion', body);
    expect(r.status).toBe(500);
    expect(idp.calls()).toHaveLength(0);
    expect(events()).toEqual([]);
  });

  test.each([
    ['disabling sign-in', AdminDisableUserCommand],
    ['ending the sessions', AdminUserGlobalSignOutCommand],
  ])('a failure after the canceled write (%s): 500 with its text, the account already canceled, the other steps still made, cookies cleared', async (_n, cmd) => {
    current = withCode();
    attempts(1);
    idp.on(cmd as any).rejects(named('TooManyRequestsException'));
    const r = await call('POST', '/api/account/deletion', body);
    expect(r).toMatchObject({ status: 500, body: { error: 'internal', message: TEXT.deletionFailed } });
    expect(order).toContain('write');
    expect(idp.commandCalls(AdminDisableUserCommand)).toHaveLength(1);
    expect(idp.commandCalls(AdminUserGlobalSignOutCommand)).toHaveLength(1);
    expect(events().map((e) => e.action)).toEqual(['member.deletion_request']);
    expect(r.cookies.some((c) => c.startsWith('vid_id=; '))).toBe(true);
    expect(logged.join('\n')).toContain('"step":');
    cleanLogs('123456');
    expect(TEXT.deletionFailed).toBe("Something went wrong, and your account may already be closed. Don't try again: check your email for the cancel link, or write to support@vettid.org. If no email comes within an hour, write to support@vettid.org.");
  });

  test('a canceled account (a session still alive after a failed sign-out) is refused before anything', async () => {
    current = { ...withCode(), account_status: 'canceled' };
    expect(await call('POST', '/api/account/deletion', body)).toMatchObject({ status: 403, body: { message: 'This account is not active' } });
    expect(memberUpdates()).toEqual([]);
  });
});

describe('POST /api/account/deletion/cancel-link (no session)', () => {
  let token: string;
  let hash: string;
  const canceled = () => ({ ...base, account_status: 'canceled', delete_after: '2026-11-10T10:00:00.000Z', account_deletion: { deletion_id: 'D1', requested_at: 'x', deletes_at: '2026-11-10T10:00:00.000Z', mailing_list: 'remove', cancel_hash: hash, mail_claimed_at: 'y', mailed_at: 'z' } });
  beforeEach(() => {
    ({ token, hash } = newWithdrawToken(G));
    current = canceled();
    memberHttp.requireSession.mockRejectedValue(new HttpError(401, 'unauthorized', 'Not signed in'));
    ddb.on(UpdateCommand, { TableName: 'members' }).callsFake(() => (order.push('write'), {}));
  });

  test("in reinstate's order: a consistent read, sign-in enabled, the conditional write (still canceled, the same deletion and hash); audited; the member emailed; cancelled", async () => {
    const r = await call('POST', '/api/account/deletion/cancel-link', { token });
    expect(r).toMatchObject({ status: 200, body: { cancelled: true } });
    expect(order).toEqual(['consistent_read', 'enable', 'write']);
    expect(memberHttp.requireSession).not.toHaveBeenCalled();
    expect(rlKeys()).toEqual([expect.stringMatching(/^account-deletion-link#203\.0\.113\.9#\d+$/)]);
    expect(memberUpdates()).toEqual([{
      TableName: 'members', Key: { user_guid: G },
      UpdateExpression: 'SET account_status = :active, updated_at = :now REMOVE account_deletion, delete_after, deletion_code',
      ConditionExpression: 'account_status = :c AND account_deletion.deletion_id = :id AND account_deletion.cancel_hash = :h',
      ExpressionAttributeValues: { ':active': 'active', ':now': expect.any(String), ':c': 'canceled', ':id': 'D1', ':h': hash },
    }]);
    expect(events().map((e) => [e.actor, e.action, e.detail])).toEqual([[`member:${G}`, 'member.deletion_cancel', { deletion_id: 'D1', via: 'link' }]]);
    expect(mails()).toEqual([{ to: ADDR, subject: 'Your VettID account was not deleted', text: 'You cancelled the deletion of your VettID account. You can sign in again as before.\n' }]);
    cleanLogs(token);
  });

  test('20 per 15 minutes per network: 429 with the other text', async () => {
    ddb.on(UpdateCommand, { TableName: 'rl' }).resolves({ Attributes: { count: 21 } });
    expect(await call('POST', '/api/account/deletion/cancel-link', { token })).toMatchObject({ status: 429, body: { error: 'rate_limited', message: TEXT.tooMany } });
    expect(order).toEqual([]);
    const [w] = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(w.ExpressionAttributeValues![':exp'] - Number(String(w.Key!.key).split('#').pop())).toBe(900 + 60);
  });

  test.each([
    ['no token', undefined],
    ['a malformed token', 'nope'],
    ['a marker row', `email:x.${'a'.repeat(43)}`],
  ])('%s names nothing: 404, nothing read', async (_n, t) => {
    expect((await call('POST', '/api/account/deletion/cancel-link', { token: t })).status).toBe(404);
    expect(order).toEqual([]);
  });

  test('the account is deleted (the row is gone): 404', async () => {
    current = undefined;
    expect((await call('POST', '/api/account/deletion/cancel-link', { token })).status).toBe(404);
    expect(idp.calls()).toHaveLength(0);
  });

  test('a wrong token for the row, a row without a hash yet, or one already cancelled (used): cancelled false, nothing changed', async () => {
    const other = newWithdrawToken(G).token;
    expect((await call('POST', '/api/account/deletion/cancel-link', { token: other })).body).toEqual({ cancelled: false });
    current = { ...canceled(), account_deletion: { ...canceled().account_deletion, cancel_hash: undefined } };
    expect((await call('POST', '/api/account/deletion/cancel-link', { token })).body).toEqual({ cancelled: false });
    current = { ...base };
    expect((await call('POST', '/api/account/deletion/cancel-link', { token })).body).toEqual({ cancelled: false });
    expect(idp.calls()).toHaveLength(0);
    expect(memberUpdates()).toEqual([]);
    expect(mails()).toEqual([]);
  });

  test('the race lost (the cleanup job or support came first): sign-in disabled again unless the row is active now; cancelled false', async () => {
    ddb.on(UpdateCommand, { TableName: 'members' }).rejects(ccf());
    expect((await call('POST', '/api/account/deletion/cancel-link', { token })).body).toEqual({ cancelled: false });
    expect(order).toEqual(['consistent_read', 'enable', 'consistent_read', 'disable']);
    // Support reinstated it meanwhile: active, sign-in stays enabled.
    order = [];
    let n = 0;
    ddb.on(GetCommand, { TableName: 'members' }).callsFake(() => (order.push('consistent_read'), { Item: n++ === 0 ? canceled() : { ...base } }));
    expect((await call('POST', '/api/account/deletion/cancel-link', { token })).body).toEqual({ cancelled: false });
    expect(order).toEqual(['consistent_read', 'enable', 'consistent_read']);
    expect(events()).toEqual([]);
    expect(mails()).toEqual([]);
  });

  test('a write whose outcome is unknown: sign-in disabled again unless active, 500', async () => {
    ddb.on(UpdateCommand, { TableName: 'members' }).rejects(named('InternalServerError'));
    expect((await call('POST', '/api/account/deletion/cancel-link', { token })).status).toBe(500);
    expect(order).toEqual(['consistent_read', 'enable', 'consistent_read', 'disable']);
  });

  test('sign-in cannot be enabled: 500, the row not written', async () => {
    idp.on(AdminEnableUserCommand).rejects(named('TooManyRequestsException'));
    expect((await call('POST', '/api/account/deletion/cancel-link', { token })).status).toBe(500);
    expect(memberUpdates()).toEqual([]);
    expect(TEXT.cancelFailed).toBe("We couldn't cancel the deletion just now. Try the link again in a few minutes; it keeps working until your account is deleted.");
  });

  test('a cancel email that cannot be sent does not undo the cancel', async () => {
    ses.on(SendEmailCommand).rejects(named('MessageRejected'));
    expect((await call('POST', '/api/account/deletion/cancel-link', { token })).body).toEqual({ cancelled: true });
    cleanLogs(token);
  });
});
