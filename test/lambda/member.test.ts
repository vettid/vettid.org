import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { AdminAddUserToGroupCommand, AdminCreateUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CreateEmailIdentityCommand, GetEmailIdentityCommand, SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

Object.assign(process.env, {
  TABLE_MEMBERS: 'members', TABLE_INVITES: 'invites', TABLE_TERMS: 'terms', TABLE_SUBSCRIPTIONS: 'subs',
  TABLE_SUBSCRIPTION_TYPES: 'types', TABLE_AUDIT: 'audit', TABLE_RATELIMITS: 'rl', TABLE_MAGIC_LINKS: 'links',
  MEMBER_POOL_ID: 'us-east-1_pool', MEMBER_CLIENT_ID: 'client', PIN_PEPPER_SECRET_ARN: 'pepper',
  ORIGIN_VERIFY_SECRET_ARN: 'origin', SENDER_EMAIL: 'no-reply@vettid.org', ADMIN_EMAIL: 'admin@vettid.org',
  ACCOUNT_HOST: 'account.vettid.org', LINK_MAILER_FN: 'link-mailer',
});

/* eslint-disable @typescript-eslint/no-require-imports */
const pub = require('../../lambda/member/public');
const auth = require('../../lambda/member/auth');
const mailer = require('../../lambda/member/link-mailer');
const define = require('../../lambda/triggers/define-auth-challenge');
const verify = require('../../lambda/triggers/verify-auth-challenge');
const { pinProblem, hashPin, checkPin } = require('../../lambda/shared/pin');
const { sha256Hex } = require('../../lambda/shared/terms-pdf');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const idp = mockClient(CognitoIdentityProviderClient);
const ses = mockClient(SESv2Client);
const sm = mockClient(SecretsManagerClient);
const lam = mockClient(LambdaClient);

const ORIGIN = 'origin-secret-value';
const ev = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, cookies: string[] = []) =>
  ({
    rawPath: path,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    cookies,
    headers: { 'x-origin-verify': ORIGIN, 'x-vettid-csrf': '1', 'cloudfront-viewer-address': '203.0.113.9:443', ...headers },
    requestContext: { http: { method, sourceIp: '10.0.0.1' } },
  }) as any;

beforeEach(() => {
  ddb.reset(); idp.reset(); ses.reset(); sm.reset(); lam.reset();
  lam.on(InvokeCommand).resolves({});
  sm.on(GetSecretValueCommand, { SecretId: 'origin' }).resolves({ SecretString: ORIGIN });
  sm.on(GetSecretValueCommand, { SecretId: 'pepper' }).resolves({ SecretString: 'pepper-value' });
  ddb.on(UpdateCommand, { TableName: 'rl' }).resolves({ Attributes: { count: 1 } });
  ddb.on(PutCommand).resolves({});
  ses.on(SendEmailCommand).resolves({});
});

describe('member HTTP guardrails', () => {
  test('requests without the CloudFront origin secret are refused', async () => {
    const res = await pub.handler(ev('POST', '/api/public/request', {}, { 'x-origin-verify': 'nope' }));
    expect(res.statusCode).toBe(403);
    expect(ddb.calls()).toHaveLength(0);
  });

  test('state-changing requests need the CSRF header', async () => {
    const res = await pub.handler(ev('POST', '/api/public/request', {}, { 'x-vettid-csrf': '' }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('csrf');
  });

  test('rate limiting returns 429 with retry_after', async () => {
    ddb.on(UpdateCommand, { TableName: 'rl' }).resolves({ Attributes: { count: 99 } });
    const res = await pub.handler(ev('POST', '/api/public/request', { email: 'a@b.org', first_name: 'A', last_name: 'B', consent: true }));
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body).retry_after).toBeGreaterThan(0);
  });
});

describe('POST /api/public/request', () => {
  const body = { email: 'New@Example.org', first_name: 'Ada', last_name: 'L', consent: true };

  beforeEach(() => {
    ddb.on(QueryCommand).resolves({ Items: [] }); // no existing member
    ses.on(GetEmailIdentityCommand).rejects(Object.assign(new Error('nf'), { name: 'NotFoundException' }));
    ses.on(CreateEmailIdentityCommand).resolves({});
    ddb.on(TransactWriteCommand).resolves({});
  });

  test('consent is required', async () => {
    const res = await pub.handler(ev('POST', '/api/public/request', { ...body, consent: false }));
    expect(res.statusCode).toBe(400);
  });

  test('no code → requested, SES verification started, admin notified, no Cognito user', async () => {
    const res = await pub.handler(ev('POST', '/api/public/request', body));
    expect(JSON.parse(res.body)).toEqual({ outcome: 'pending_approval' });
    const tx = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(tx).toHaveLength(2); // member + email marker
    expect(tx[0].Put!.Item).toMatchObject({ email: 'new@example.org', state: 'requested', email_verified: false });
    expect(tx[1].Put!.Item).toMatchObject({ user_guid: 'email:new@example.org', kind: 'email_marker' });
    expect(tx[1].Put!.Item).not.toHaveProperty('email'); // markers stay out of the email index
    expect(ses.commandCalls(CreateEmailIdentityCommand)).toHaveLength(1);
    expect(ses.commandCalls(SendEmailCommand)[0].args[0].input.Destination?.ToAddresses).toEqual(['admin@vettid.org']);
    expect(idp.calls()).toHaveLength(0);
  });

  test('valid registration code → registered, code use consumed in the same transaction, Cognito user created', async () => {
    idp.on(AdminCreateUserCommand).resolves({});
    idp.on(AdminAddUserToGroupCommand).resolves({});
    const res = await pub.handler(ev('POST', '/api/public/request', { ...body, invite_code: '7k3qx-m9tza' }));
    expect(JSON.parse(res.body)).toEqual({ outcome: 'registered' });
    const tx = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(tx[2].Update).toMatchObject({ TableName: 'invites', Key: { code: '7K3QX-M9TZA' } });
    expect(tx[2].Update!.ConditionExpression).toContain('uses < max_uses');
    expect(idp.commandCalls(AdminCreateUserCommand)[0].args[0].input.MessageAction).toBe('SUPPRESS');
    // Admin notice uses the member-facing name ("registration code"); the API field stays invite_code.
    const notice = ses.commandCalls(SendEmailCommand)[0].args[0].input.Content!.Simple!;
    expect(notice.Subject!.Data).toContain('registered with a registration code');
    expect(notice.Body!.Text!.Data).toContain('Registered with registration code 7K3QX-M9TZA.');
  });

  test('bad code silently falls back to review (no oracle)', async () => {
    ddb.on(TransactWriteCommand)
      .rejectsOnce(Object.assign(new Error('x'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'None' }, { Code: 'None' }, { Code: 'ConditionalCheckFailed' }] }))
      .resolves({});
    const res = await pub.handler(ev('POST', '/api/public/request', { ...body, invite_code: 'AAAAA-BBBBB' }));
    expect(JSON.parse(res.body)).toEqual({ outcome: 'pending_approval' });
    expect(ddb.commandCalls(TransactWriteCommand)[1].args[0].input.TransactItems).toHaveLength(2);
    expect(idp.calls()).toHaveLength(0);
  });

  test('existing address gets the same answer and nothing is written', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ user_guid: 'g', email: 'new@example.org', state: 'member' }] });
    const res = await pub.handler(ev('POST', '/api/public/request', body));
    expect(JSON.parse(res.body)).toEqual({ outcome: 'pending_approval' });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});

describe('POST /api/auth/start', () => {
  test('answers immediately and hands off to the async mailer (no account lookup inline)', async () => {
    const res = await auth.handler(ev('POST', '/api/auth/start', { email: 'M@x.org' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    const inv = lam.commandCalls(InvokeCommand)[0].args[0].input;
    expect(inv).toMatchObject({ FunctionName: 'link-mailer', InvocationType: 'Event' });
    expect(JSON.parse(Buffer.from(inv.Payload as Uint8Array).toString())).toEqual({ email: 'm@x.org' });
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(0); // timing can't depend on the account
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  // 2.3.1: the same shared check; nothing is counted or handed off.
  test.each(['m\u0000@x.org', 'm\u001f@x.org', 'm\u007f@x.org', 'm\u0080@x.org', 'm\u009f@x.org', 'm@x\u2028.org', 'm@x.\u2029org'])('refuses %j with 400', async (addr) => {
    const res = await auth.handler(ev('POST', '/api/auth/start', { email: addr }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toBe('Invalid email address');
    expect(lam.commandCalls(InvokeCommand)).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  test('/api/auth/verify refuses such an address too, before any Cognito call', async () => {
    const res = await auth.handler(ev('POST', '/api/auth/verify', { email: 'm\u0085@x.org', token: 'A'.repeat(43) }));
    expect(res.statusCode).toBe(400);
    expect(idp.calls()).toHaveLength(0);
  });

  test('a normal address still starts sign-in (unicode local part, internationalised domain)', async () => {
    const res = await auth.handler(ev('POST', '/api/auth/start', { email: 'Jos\u00e9@B\u00fccher.de' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    const inv = lam.commandCalls(InvokeCommand)[0].args[0].input;
    expect(JSON.parse(Buffer.from(inv.Payload as Uint8Array).toString())).toEqual({ email: 'jos\u00e9@b\u00fccher.de' });
  });

  test('per (address, network) limit is silent: same answer, no hand-off', async () => {
    ddb.on(UpdateCommand, { TableName: 'rl' }).resolvesOnce({ Attributes: { count: 1 } }).resolves({ Attributes: { count: 4 } });
    const res = await auth.handler(ev('POST', '/api/auth/start', { email: 'm@x.org' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(lam.commandCalls(InvokeCommand)).toHaveLength(0);
  });
});

describe('link mailer (async)', () => {
  const member = { user_guid: 'g1', email: 'm@x.org', first_name: 'Evil\nhttps://phish', state: 'member', account_status: 'active', email_verified: true };

  test('eligible member: stores only the token hash, emails a fragment link, no member-supplied text', async () => {
    ddb.on(QueryCommand).resolves({ Items: [member] });
    await mailer.handler({ email: 'm@x.org' });
    const put = ddb.commandCalls(PutCommand).find((c) => c.args[0].input.TableName === 'links')!.args[0].input.Item!;
    const text = ses.commandCalls(SendEmailCommand)[0].args[0].input.Content!.Simple!.Body!.Text!.Data!;
    const token = /#t=([A-Za-z0-9_-]{43})&e=/.exec(text)![1];
    expect(put.token_hash).toBe(sha256Hex(token));
    expect(JSON.stringify(put)).not.toContain(token);
    expect(text).not.toContain('phish');
  });

  test('flag not yet swept but SES says verified: checks live, records it, sends the link', async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ ...member, email_verified: false }] });
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: true });
    ddb.on(UpdateCommand, { TableName: 'members' }).resolves({});
    await mailer.handler({ email: 'm@x.org' });
    expect(ddb.commandCalls(UpdateCommand, { TableName: 'members' })[0].args[0].input.ExpressionAttributeValues).toMatchObject({ ':t': true });
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1);
  });

  test.each([
    ['unknown address', []],
    ['unverified email', [{ ...member, email_verified: false }]],
    ['suspended', [{ ...member, account_status: 'suspended' }]],
    ['still requested', [{ ...member, state: 'requested' }]],
  ])('%s: nothing sent', async (_n, items) => {
    ddb.on(QueryCommand).resolves({ Items: items });
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: false });
    await mailer.handler({ email: 'm@x.org' });
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  test('global hourly cap stops sending', async () => {
    ddb.on(QueryCommand).resolves({ Items: [member] });
    ddb.on(UpdateCommand, { TableName: 'rl' }).resolvesOnce({ Attributes: { count: 1 } }).resolves({ Attributes: { count: 999 } });
    await mailer.handler({ email: 'm@x.org' });
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
});

describe('POST /api/auth/pin', () => {
  test('a forged (unsigned) PIN-step cookie is treated as expired and reveals nothing', async () => {
    const forged = Buffer.from(JSON.stringify({ s: 'x', e: 'victim@x.org' })).toString('base64url');
    const res = await auth.handler(ev('POST', '/api/auth/pin', { pin: '4826' }, {}, [`vid_pin=${forged}.AAAA`]));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).message).toMatch(/expired/);
    expect(idp.calls()).toHaveLength(0);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(0);
  });
});

describe('public request input', () => {
  beforeEach(() => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    ses.on(GetEmailIdentityCommand).rejects(Object.assign(new Error('nf'), { name: 'NotFoundException' }));
    ses.on(CreateEmailIdentityCommand).resolves({});
    ddb.on(TransactWriteCommand).resolves({});
  });

  test.each(['Visit https://evil.example', 'Al\nSecurity notice', 'R2D2', ''])('rejects name %j', async (first) => {
    const res = await pub.handler(ev('POST', '/api/public/request', { email: 'a@b.org', first_name: first, last_name: 'L', consent: true }));
    expect(res.statusCode).toBe(400);
  });

  test.each(["O'Brien", 'Zoë', 'Jean-Luc', 'José María', '李'])('accepts name %j', async (first) => {
    const res = await pub.handler(ev('POST', '/api/public/request', { email: 'a@b.org', first_name: first, last_name: 'L', consent: true }));
    expect(res.statusCode).toBe(200);
  });

  // 2.2.1: trimmed of leading and trailing U+0020 only, as the name-change job and the vault do.
  test.each(['\u00a0Ada', 'Ada\u00a0', '\tAda', 'Ada\n', '\u2003Ada', '   ', 'x'.repeat(41)])('rejects name %j (2.2.1: no other white space is trimmed)', async (first) => {
    const res = await pub.handler(ev('POST', '/api/public/request', { email: 'a@b.org', first_name: first, last_name: 'L', consent: true }));
    expect(res.statusCode).toBe(400);
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  // 2.3.1: an email with C0, DEL, C1, U+2028 or U+2029 is refused (400), and nothing is created.
  test.each([['C0', 'a\u0001b@b.org'], ['C0 TAB', 'a\tb@b.org'], ['DEL', 'a\u007fb@b.org'], ['C1', 'a@b\u0085c.org'], ['U+2028', 'a\u2028b@b.org'], ['U+2029', 'a@b.or\u2029g']])(
    'rejects an email with %s',
    async (_, addr) => {
      const res = await pub.handler(ev('POST', '/api/public/request', { email: addr, first_name: 'Ada', last_name: 'L', consent: true }));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toBe('Invalid email address');
      expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
      expect(ses.commandCalls(CreateEmailIdentityCommand)).toHaveLength(0);
    },
  );

  test.each([['jos\u00e9@b.org', 'jos\u00e9@b.org'], ['A@B\u00dcCHER.de', 'a@b\u00fccher.de'], ['a@xn--bcher-kva.example', 'a@xn--bcher-kva.example']])(
    'accepts email %j',
    async (addr, stored) => {
      const res = await pub.handler(ev('POST', '/api/public/request', { email: addr, first_name: 'Ada', last_name: 'L', consent: true }));
      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(ddb.commandCalls(TransactWriteCommand)[0].args[0].input)).toContain(`"email":${JSON.stringify(stored)}`);
    },
  );

  test('leading and trailing spaces are trimmed before the rule and stored trimmed (40 characters after the trim)', async () => {
    const res = await pub.handler(ev('POST', '/api/public/request', { email: 'a@b.org', first_name: '  Ada ', last_name: ` ${'x'.repeat(40)}  `, consent: true }));
    expect(res.statusCode).toBe(200);
    const put = JSON.stringify(ddb.commandCalls(TransactWriteCommand)[0].args[0].input);
    expect(put).toContain('"first_name":"Ada"');
    expect(put).toContain(`"last_name":"${'x'.repeat(40)}"`);
  });

  test('past the global hourly cap: same answer, nothing created', async () => {
    ddb.on(UpdateCommand, { TableName: 'rl' }).resolvesOnce({ Attributes: { count: 1 } }).resolves({ Attributes: { count: 999 } });
    const res = await pub.handler(ev('POST', '/api/public/request', { email: 'a@b.org', first_name: 'A', last_name: 'B', consent: true }));
    expect(JSON.parse(res.body)).toEqual({ outcome: 'pending_approval' });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(ses.commandCalls(CreateEmailIdentityCommand)).toHaveLength(0);
  });
});

describe('auth cookies', () => {
  test('signout clears all session cookies with Secure/HttpOnly/SameSite=Strict and no Domain', async () => {
    const res = await auth.handler(ev('POST', '/api/auth/signout'));
    expect(res.cookies).toHaveLength(5); // id, refresh (/api), legacy refresh (/api/auth), pin, presence (/)
    expect(res.cookies).toContain('vid_s=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict');
    expect(res.cookies).toContain('vid_rt=; Path=/api/auth; Max-Age=0; Secure; HttpOnly; SameSite=Strict');
    for (const c of res.cookies) {
      expect(c).toMatch(/Max-Age=0; Secure; HttpOnly; SameSite=Strict$/);
      expect(c).not.toMatch(/Domain=/i);
    }
  });
});

describe('Cognito triggers', () => {
  const user = { email: 'm@x.org', 'custom:user_guid': 'g1' };
  const defEvent = (session: any[], member: any) => {
    ddb.on(GetCommand).resolves({ Item: member });
    return { request: { userAttributes: user, session, userNotFound: false }, response: {} } as any;
  };
  const active = { user_guid: 'g1', email: 'm@x.org', state: 'member', account_status: 'active' };

  test('magic link first; tokens after it when no PIN is set', async () => {
    let e = await define.handler(defEvent([], active));
    expect(e.response).toMatchObject({ challengeName: 'CUSTOM_CHALLENGE', issueTokens: false });
    e = await define.handler(defEvent([{ challengeName: 'CUSTOM_CHALLENGE', challengeResult: true, challengeMetadata: 'MAGIC' }], active));
    expect(e.response).toMatchObject({ issueTokens: true, failAuthentication: false });
  });

  test('PIN step only after a correct magic link, with limited retries', async () => {
    const withPin = { ...active, pin_hash: 'h' };
    const magicOk = { challengeName: 'CUSTOM_CHALLENGE', challengeResult: true, challengeMetadata: 'MAGIC' };
    const pinBad = { challengeName: 'CUSTOM_CHALLENGE', challengeResult: false, challengeMetadata: 'PIN' };
    expect((await define.handler(defEvent([magicOk], withPin))).response).toMatchObject({ challengeName: 'CUSTOM_CHALLENGE', issueTokens: false });
    expect((await define.handler(defEvent([magicOk, pinBad], withPin))).response.failAuthentication).toBe(false);
    expect((await define.handler(defEvent([magicOk, pinBad, pinBad, pinBad], withPin))).response.failAuthentication).toBe(true);
    const magicBad = { ...magicOk, challengeResult: false };
    expect((await define.handler(defEvent([magicBad], withPin))).response.failAuthentication).toBe(true);
  });

  test('suspended or canceled accounts cannot finish sign-in', async () => {
    const e = await define.handler(defEvent([], { ...active, account_status: 'suspended' }));
    expect(e.response.failAuthentication).toBe(true);
  });

  test('verify consumes a magic link exactly once (conditional update)', async () => {
    const token = 'A'.repeat(43);
    ddb.on(UpdateCommand, { TableName: 'links' }).resolvesOnce({}).rejects(Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' }));
    const mk = () => ({ request: { privateChallengeParameters: { step: 'MAGIC' }, challengeAnswer: token, userAttributes: user }, response: {} }) as any;
    expect((await verify.handler(mk())).response.answerCorrect).toBe(true);
    expect((await verify.handler(mk())).response.answerCorrect).toBe(false);
    const input = ddb.commandCalls(UpdateCommand, { TableName: 'links' })[0].args[0].input;
    expect(input.Key).toEqual({ token_hash: sha256Hex(token) });
    expect(input.ConditionExpression).toContain('attribute_not_exists(used_at)');
    expect(input.ExpressionAttributeValues![':e']).toBe('m@x.org');
  });
});

describe('PIN', () => {
  test.each(['123', 'abcd', '1111', '1234', '9876', '0000', '123456789'])('rejects weak/invalid %s', (p) => {
    expect(pinProblem(p)).not.toBeNull();
  });
  test.each(['4826', '73915', '20481937'])('accepts %s', (p) => {
    expect(pinProblem(p)).toBeNull();
  });

  test('hash is peppered and per-user', async () => {
    const h = await hashPin('g1', '4826');
    expect(h).not.toBe(sha256Hex('4826'));
    expect(await hashPin('g2', '4826')).not.toBe(h);
  });

  test('an attempt is reserved atomically BEFORE comparing (concurrent guesses can\'t overshoot)', async () => {
    const h = await hashPin('g1', '4826');
    ddb.on(UpdateCommand, { TableName: 'rl' }).resolves({ Attributes: { count: 2 } });
    expect(await checkPin('g1', h, '4827')).toEqual({ ok: false, locked: false, attemptsLeft: 3, justLocked: false });
    const reserve = ddb.commandCalls(UpdateCommand, { TableName: 'rl' })[0].args[0].input;
    expect(reserve.ConditionExpression).toBe('expires_at > :now AND #c < :max');
    expect(reserve.ExpressionAttributeValues![':max']).toBe(5);
  });

  test('when no attempt can be reserved the PIN is locked, even if correct', async () => {
    const h = await hashPin('g1', '4826');
    const ccf = Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' });
    ddb.on(UpdateCommand, { TableName: 'rl' }).rejects(ccf);
    ddb.on(PutCommand, { TableName: 'rl' }).rejects(ccf);
    ddb.on(GetCommand, { TableName: 'rl' }).resolves({ Item: { count: 5, expires_at: Math.floor(Date.now() / 1000) + 600 } });
    expect(await checkPin('g1', h, '4826')).toEqual({ ok: false, locked: true, attemptsLeft: 0, justLocked: false });
  });

  test('a correct PIN clears the counter', async () => {
    const h = await hashPin('g1', '4826');
    ddb.on(UpdateCommand, { TableName: 'rl' }).resolves({ Attributes: { count: 1 } });
    ddb.on(DeleteCommand).resolves({});
    expect(await checkPin('g1', h, '4826')).toEqual({ ok: true });
    expect(ddb.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({ key: 'pinfail#g1' });
  });
});

describe('POST /api/account/preferences', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const account = require('../../lambda/member/account');
  // Session verification is exercised elsewhere; here we stub the verifier.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const memberHttp = require('../../lambda/shared/member-http');

  beforeEach(() => {
    jest.spyOn(memberHttp, 'requireSession').mockResolvedValue({ email: 'm@x.org', user_guid: 'g1' });
    ddb.on(GetCommand, { TableName: 'members' }).resolves({ Item: { user_guid: 'g1', email: 'm@x.org', state: 'registered', account_status: 'active', email_verified: true } });
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(GetCommand, { TableName: 'subs' }).resolves({});
  });
  afterEach(() => jest.restoreAllMocks());

  test('records "skip for now" on the PIN step and reports it in Me', async () => {
    ddb.on(UpdateCommand, { TableName: 'members' }).resolves({
      Attributes: { user_guid: 'g1', email: 'm@x.org', state: 'registered', account_status: 'active', email_verified: true, pin_prompt_dismissed: true },
    });
    const res = await account.handler(ev('POST', '/api/account/preferences', { pin_prompt_dismissed: true }));
    expect(res.statusCode).toBe(200);
    const me = JSON.parse(res.body);
    expect(me.preferences).toEqual({ email_updates: true, pin_prompt_dismissed: true });
    expect(me.email_verified).toBe(true);
    const upd = ddb.commandCalls(UpdateCommand, { TableName: 'members' })[0].args[0].input;
    expect(Object.values(upd.ExpressionAttributeNames!)).toContain('pin_prompt_dismissed');
  });

  test('rejects empty and non-boolean updates', async () => {
    expect((await account.handler(ev('POST', '/api/account/preferences', {}))).statusCode).toBe(400);
    expect((await account.handler(ev('POST', '/api/account/preferences', { email_updates: 'yes' }))).statusCode).toBe(400);
  });
});

describe('account changes reach the running vault (MEMBER-API 2.0.0 "Account snapshot to the vault")', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const account = require('../../lambda/member/account');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const memberHttp = require('../../lambda/shared/member-http');
  const pushes = () => lam.commandCalls(InvokeCommand).filter((c) => c.args[0].input.FunctionName === 'account-push-fn').map((c) => c.args[0].input);
  const member = { user_guid: 'g1', email: 'm@x.org', state: 'member', account_status: 'active', email_verified: true, terms_version: 't1' };

  beforeEach(() => {
    process.env.ACCOUNT_PUSH_FN = 'account-push-fn';
    jest.spyOn(memberHttp, 'requireSession').mockResolvedValue({ email: 'm@x.org', user_guid: 'g1' });
    ddb.on(GetCommand, { TableName: 'members' }).resolves({ Item: member });
    ddb.on(UpdateCommand, { TableName: 'members' }).resolves({ Attributes: member });
    ddb.on(QueryCommand).resolves({ Items: [] });
  });
  afterEach(() => {
    delete process.env.ACCOUNT_PUSH_FN;
    jest.restoreAllMocks();
  });

  test('cancelling the subscription asks for a push (asynchronous, the member only)', async () => {
    ddb.on(GetCommand).callsFake((i) => (i.TableName === 'members' ? { Item: member } : { Item: { user_guid: 'g1', type_id: 'trial', type_name: 'Trial', status: 'trial', paid: false, started_at: 'x', expires_at: '2099-01-01T00:00:00.000Z' } }));
    const res = await account.handler(ev('POST', '/api/account/subscription/cancel'));
    expect(res.statusCode).toBe(200);
    expect(pushes()).toEqual([{ FunctionName: 'account-push-fn', InvocationType: 'Event', Payload: Buffer.from('{"user_guid":"g1"}') }]);
  });

  test('a failed push request never fails the change', async () => {
    lam.on(InvokeCommand).rejects(Object.assign(new Error('x'), { name: 'ServiceException' }));
    ddb.on(GetCommand).callsFake((i) => (i.TableName === 'members' ? { Item: member } : { Item: { user_guid: 'g1', type_id: 'trial', type_name: 'Trial', status: 'trial', paid: false, started_at: 'x', expires_at: '2099-01-01T00:00:00.000Z' } }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect((await account.handler(ev('POST', '/api/account/subscription/cancel'))).statusCode).toBe(200);
  });

  test('preferences and PIN changes do not push (the snapshot does not show them)', async () => {
    await account.handler(ev('POST', '/api/account/preferences', { email_updates: false }));
    expect(pushes()).toHaveLength(0);
  });
});
