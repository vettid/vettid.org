import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { AdminAddUserToGroupCommand, AdminCreateUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { CreateEmailIdentityCommand, GetEmailIdentityCommand, SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

Object.assign(process.env, {
  TABLE_MEMBERS: 'members', TABLE_INVITES: 'invites', TABLE_TERMS: 'terms', TABLE_SUBSCRIPTIONS: 'subs',
  TABLE_SUBSCRIPTION_TYPES: 'types', TABLE_AUDIT: 'audit', TABLE_RATELIMITS: 'rl', TABLE_MAGIC_LINKS: 'links',
  MEMBER_POOL_ID: 'us-east-1_pool', MEMBER_CLIENT_ID: 'client', PIN_PEPPER_SECRET_ARN: 'pepper',
  ORIGIN_VERIFY_SECRET_ARN: 'origin', SENDER_EMAIL: 'no-reply@vettid.org', ADMIN_EMAIL: 'admin@vettid.org',
  ACCOUNT_HOST: 'account.vettid.org',
});

/* eslint-disable @typescript-eslint/no-require-imports */
const pub = require('../../lambda/member/public');
const auth = require('../../lambda/member/auth');
const define = require('../../lambda/triggers/define-auth-challenge');
const verify = require('../../lambda/triggers/verify-auth-challenge');
const { pinProblem, hashPin, checkPin } = require('../../lambda/shared/pin');
const { sha256Hex } = require('../../lambda/shared/terms-pdf');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const idp = mockClient(CognitoIdentityProviderClient);
const ses = mockClient(SESv2Client);
const sm = mockClient(SecretsManagerClient);

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
  ddb.reset(); idp.reset(); ses.reset(); sm.reset();
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

  test('valid code → registered, invite use consumed in the same transaction, Cognito user created', async () => {
    idp.on(AdminCreateUserCommand).resolves({});
    idp.on(AdminAddUserToGroupCommand).resolves({});
    const res = await pub.handler(ev('POST', '/api/public/request', { ...body, invite_code: '7k3qx-m9tza' }));
    expect(JSON.parse(res.body)).toEqual({ outcome: 'registered' });
    const tx = ddb.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(tx[2].Update).toMatchObject({ TableName: 'invites', Key: { code: '7K3QX-M9TZA' } });
    expect(tx[2].Update!.ConditionExpression).toContain('uses < max_uses');
    expect(idp.commandCalls(AdminCreateUserCommand)[0].args[0].input.MessageAction).toBe('SUPPRESS');
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
  const member = { user_guid: 'g1', email: 'm@x.org', first_name: 'M', state: 'member', account_status: 'active', email_verified: true };

  test('eligible member: stores only the token hash and emails a fragment link', async () => {
    ddb.on(QueryCommand).resolves({ Items: [member] });
    const res = await auth.handler(ev('POST', '/api/auth/start', { email: 'M@x.org' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    const put = ddb.commandCalls(PutCommand).find((c) => c.args[0].input.TableName === 'links')!.args[0].input.Item!;
    const text = ses.commandCalls(SendEmailCommand)[0].args[0].input.Content!.Simple!.Body!.Text!.Data!;
    const token = /#t=([A-Za-z0-9_-]{43})&e=/.exec(text)![1];
    expect(put.token_hash).toBe(sha256Hex(token));
    expect(JSON.stringify(put)).not.toContain(token);
  });

  test.each([
    ['unknown address', []],
    ['unverified email', [{ ...member, email_verified: false }]],
    ['suspended', [{ ...member, account_status: 'suspended' }]],
    ['still requested', [{ ...member, state: 'requested' }]],
  ])('%s: same answer, no email', async (_n, items) => {
    ddb.on(QueryCommand).resolves({ Items: items });
    const res = await auth.handler(ev('POST', '/api/auth/start', { email: 'm@x.org' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
});

describe('auth cookies', () => {
  test('signout clears all session cookies with Secure/HttpOnly/SameSite=Strict and no Domain', async () => {
    const res = await auth.handler(ev('POST', '/api/auth/signout'));
    expect(res.cookies).toHaveLength(3);
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

  test('hash is peppered and per-user; wrong PIN counts toward lockout', async () => {
    const h = await hashPin('g1', '4826');
    expect(h).not.toBe(sha256Hex('4826'));
    expect(await hashPin('g2', '4826')).not.toBe(h);

    ddb.on(GetCommand, { TableName: 'rl' }).resolves({});
    ddb.on(UpdateCommand, { TableName: 'rl' }).resolves({ Attributes: { count: 1 } });
    expect(await checkPin('g1', h, '4826')).toEqual({ ok: true });
    expect(await checkPin('g1', h, '4827')).toEqual({ ok: false, locked: false, attemptsLeft: 4 });
  });

  test('locked after 5 failures even with the right PIN', async () => {
    const h = await hashPin('g1', '4826');
    ddb.on(GetCommand, { TableName: 'rl' }).resolves({ Item: { count: 5, expires_at: Math.floor(Date.now() / 1000) + 600 } });
    expect(await checkPin('g1', h, '4826')).toEqual({ ok: false, locked: true, attemptsLeft: 0 });
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
  });
});
