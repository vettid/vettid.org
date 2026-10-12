import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { transformSync } from 'esbuild';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { CreateEmailIdentityCommand, DeleteEmailIdentityCommand, GetEmailIdentityCommand, SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

Object.assign(process.env, {
  TABLE_NAME: 'list',
  MEMBERS_TABLE_NAME: 'members',
  ORIGIN_VERIFY_SECRET_ARN: 'origin',
  SENDER_EMAIL: 'no-reply@vettid.org',
  ADMIN_EMAIL: 'admin@vettid.org',
});

/**
 * The signup Lambdas are plain ESM (.mjs) and jest runs CommonJS, so load
 * them through esbuild's ESM→CJS transform and evaluate them with this test's
 * own `require`: dependencies resolve through jest's module registry, so
 * aws-sdk-client-mock patches the same SDK classes the handlers use.
 * Relative imports (./list-mail.mjs) load the same way, once.
 */
const loaded = new Map<string, any>();
function loadMjs(rel: string): any {
  const file = resolve(__dirname, '../..', rel);
  if (loaded.has(file)) return loaded.get(file);
  const { code } = transformSync(readFileSync(file, 'utf8'), { format: 'cjs', loader: 'js', target: 'node20', sourcefile: file });
  const mod = { exports: {} as any };
  const req = (id: string) => (id.startsWith('.') ? loadMjs(resolve(dirname(file), id)) : require(id));
  new Function('require', 'module', 'exports', code)(req, mod, mod.exports);
  loaded.set(file, mod.exports); // esbuild's CJS output replaces module.exports
  return mod.exports;
}

const ddb = mockClient(DynamoDBDocumentClient);
const ses = mockClient(SESv2Client);
const sm = mockClient(SecretsManagerClient);

const subscribe = loadMjs('lambda/signup/subscribe.mjs');
const check = loadMjs('lambda/signup/check-verifications.mjs');
const listMail = loadMjs('lambda/signup/list-mail.mjs');

const ORIGIN = 'origin-secret-value';
const post = (body: unknown, headers: Record<string, string> = {}) =>
  ({
    rawPath: '/api/subscribe',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'x-origin-verify': ORIGIN, 'content-type': 'application/json', ...headers },
    requestContext: { http: { method: 'POST' } },
  }) as any;
const confirmEv = (t: string, headers: Record<string, string> = {}) =>
  ({
    rawPath: '/api/subscribe/confirm',
    queryStringParameters: { t },
    headers: { 'x-origin-verify': ORIGIN, ...headers },
    requestContext: { http: { method: 'GET' } },
  }) as any;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const unsubGet = (u: string | undefined) =>
  ({
    rawPath: '/api/subscribe/unsubscribe',
    queryStringParameters: u === undefined ? undefined : { u },
    headers: { 'x-origin-verify': ORIGIN },
    requestContext: { http: { method: 'GET' } },
  }) as any;
/** The site page's form post: the token in the body. */
const unsubForm = (u: string, extra: Record<string, unknown> = {}) =>
  ({
    rawPath: '/api/subscribe/unsubscribe',
    body: `u=${encodeURIComponent(u)}`,
    headers: { 'x-origin-verify': ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
    requestContext: { http: { method: 'POST' } },
    ...extra,
  }) as any;
/** A mail provider's RFC 8058 one-click post: the token in the URL, no cookies. */
const unsubOneClick = (u: string) =>
  ({
    rawPath: '/api/subscribe/unsubscribe',
    queryStringParameters: { u },
    body: 'List-Unsubscribe=One-Click',
    headers: { 'x-origin-verify': ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
    requestContext: { http: { method: 'POST' } },
  }) as any;

let logged: jest.SpyInstance;
beforeEach(() => {
  ddb.reset(); ses.reset(); sm.reset();
  logged = jest.spyOn(console, 'log').mockImplementation(() => undefined); // handlers log outcome shapes
  sm.on(GetSecretValueCommand, { SecretId: 'origin' }).resolves({ SecretString: ORIGIN });
  ddb.on(GetCommand).resolves({});
  ddb.on(PutCommand).resolves({});
  ddb.on(UpdateCommand).resolves({ Attributes: { n: 1 } });
  ddb.on(DeleteCommand).resolves({});
  ses.on(SendEmailCommand).resolves({});
  ses.on(CreateEmailIdentityCommand).resolves({});
});

describe('subscribe: request guards', () => {
  test('requests without the CloudFront origin secret get 403 and touch nothing', async () => {
    for (const headers of [{ 'x-origin-verify': 'nope' }, { 'x-origin-verify': '' }]) {
      const res = await subscribe.handler(post({ email: 'a@example.com' }, headers));
      expect(res.statusCode).toBe(403);
    }
    expect(ddb.calls()).toHaveLength(0);
    expect(ses.calls()).toHaveLength(0);
  });

  test('confirm links need the origin secret too', async () => {
    const res = await subscribe.handler(confirmEv('x'.repeat(43), { 'x-origin-verify': 'nope' }));
    expect(res.statusCode).toBe(403);
  });

  test('non-JSON bodies (cross-site form posts) get 415', async () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
      const res = await subscribe.handler(post('{"email":"a@example.com"}', { 'content-type': ct }));
      expect(res.statusCode).toBe(415);
    }
    expect(ddb.calls()).toHaveLength(0);
  });

  test('application/json with a charset is accepted', async () => {
    ses.on(CreateEmailIdentityCommand).resolves({});
    const res = await subscribe.handler(post({ email: 'a@example.com' }, { 'content-type': 'Application/JSON; charset=utf-8' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

describe('subscribe: opt-in paths', () => {
  test('a new address goes through SES verification as a pending row', async () => {
    const res = await subscribe.handler(post({ email: 'New@Example.com' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(ses.commandCalls(CreateEmailIdentityCommand)[0].args[0].input).toEqual({ EmailIdentity: 'new@example.com' });
    const put = ddb.commandCalls(PutCommand)[0].args[0].input;
    expect(put.Item).toMatchObject({ email: 'new@example.com', status: 'pending' });
    expect(put.Item!.unsubToken).toMatch(TOKEN); // unconfirmed rows can be unsubscribed too
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  test('an already-verified address is NOT confirmed instantly: it gets a single-use link', async () => {
    ses.on(CreateEmailIdentityCommand).rejects(Object.assign(new Error('exists'), { name: 'AlreadyExistsException' }));
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: true });
    const res = await subscribe.handler(post({ email: 'member@example.com' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const puts = ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item!);
    const row = puts.find((i) => i.email === 'member@example.com')!;
    expect(row.status).toBe('pending_link'); // not 'pending' (the sweep would confirm it) and not 'confirmed'
    const now = Math.floor(Date.now() / 1000);
    expect(row.expiresAt).toBeGreaterThan(now + 47 * 3600);
    expect(row.expiresAt).toBeLessThanOrEqual(now + 48 * 3600);

    const mail = ses.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(mail.Destination!.ToAddresses).toEqual(['member@example.com']);
    expect(mail.Content!.Simple!.Subject!.Data).toBe('Confirm your VettID updates subscription');
    const token = /https:\/\/vettid\.org\/api\/subscribe\/confirm\?t=([A-Za-z0-9_-]+)/.exec(mail.Content!.Simple!.Body!.Text!.Data!)![1];
    // Only the hash is stored, never the token.
    const hash = createHash('sha256').update(token).digest('hex');
    expect(row.tokenHash).toBe(hash);
    expect(JSON.stringify(puts)).not.toContain(token);
    expect(puts.find((i) => i.email === `#confirm#${hash}`)).toMatchObject({ target: 'member@example.com' });

    // List mail: the unsubscribe link in the body (token in the fragment)
    // and the RFC 8058 headers (token in the query), both for this row.
    expect(row.unsubToken).toMatch(TOKEN);
    expect(row.unsubToken).not.toBe(token);
    expect(mail.Content!.Simple!.Body!.Text!.Data).toContain(`https://vettid.org/unsubscribe/#u=${row.unsubToken}`);
    expect(mail.Content!.Simple!.Headers).toEqual([
      { Name: 'List-Unsubscribe', Value: `<https://vettid.org/api/subscribe/unsubscribe?u=${row.unsubToken}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ]);
  });

  test('the global hourly cap also covers confirmation-link mail', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: { n: 201 } });
    ses.on(CreateEmailIdentityCommand).rejects(Object.assign(new Error('exists'), { name: 'AlreadyExistsException' }));
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: true });
    const res = await subscribe.handler(post({ email: 'member@example.com' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(ses.calls()).toHaveLength(0);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  test('existing rows get the same generic success and no mail', async () => {
    ddb.on(GetCommand).resolves({ Item: { email: 'a@example.com', status: 'confirmed' } });
    const res = await subscribe.handler(post({ email: 'a@example.com' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(ses.calls()).toHaveLength(0);
  });
});

describe('subscribe: confirm link', () => {
  const token = 'A'.repeat(43);
  const hash = createHash('sha256').update(token).digest('hex');
  const future = () => Math.floor(Date.now() / 1000) + 3600;

  test('a valid link confirms (conditionally, single use) and redirects to the site', async () => {
    ddb.on(GetCommand, { Key: { email: `#confirm#${hash}` } }).resolves({ Item: { target: 'm@example.com', expiresAt: future() } });
    const res = await subscribe.handler(confirmEv(token));
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://vettid.org/?subscribed=1');
    const upd = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(upd.Key).toEqual({ email: 'm@example.com' });
    expect(upd.ConditionExpression).toContain('tokenHash = :h');
    expect(upd.ExpressionAttributeValues![':h']).toBe(hash);
    expect(upd.ExpressionAttributeValues![':awaiting']).toBe('pending_link');
    // a row from before unsubscribe existed gets its token here
    expect(upd.UpdateExpression).toContain('unsubToken = if_not_exists(unsubToken, :u)');
    expect(upd.ExpressionAttributeValues![':u']).toMatch(TOKEN);
    // the used pointer (it names the address) is deleted, not left to its TTL
    expect(ddb.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({ email: `#confirm#${hash}` });
  });

  test('the admin notice says that somebody confirmed, and nothing about who', async () => {
    ddb.on(GetCommand, { Key: { email: `#confirm#${hash}` } }).resolves({ Item: { target: 'm@example.com', expiresAt: future() } });
    await subscribe.handler(confirmEv(token));
    const mails = ses.commandCalls(SendEmailCommand).map((c) => c.args[0].input);
    expect(mails).toHaveLength(1);
    expect(mails[0].Destination!.ToAddresses).toEqual(['admin@vettid.org']);
    const sent = JSON.stringify(mails[0]);
    expect(sent).not.toContain('m@example.com');
    expect(sent).not.toContain('example.com');
    expect(mails[0].Content!.Simple!.Body!.Text!.Data).toContain('Confirmed via: confirmation link');
  });

  test('replayed / stale links do not confirm', async () => {
    ddb.on(GetCommand, { Key: { email: `#confirm#${hash}` } }).resolves({ Item: { target: 'm@example.com', expiresAt: future() } });
    ddb.on(UpdateCommand).rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    const res = await subscribe.handler(confirmEv(token));
    expect(res.headers.location).toBe('https://vettid.org/?subscribed=0');
    expect(ses.calls()).toHaveLength(0);
  });

  test('expired, unknown and malformed tokens do not confirm', async () => {
    ddb.on(GetCommand, { Key: { email: `#confirm#${hash}` } }).resolves({ Item: { target: 'm@example.com', expiresAt: 1 } });
    for (const t of [token, 'B'.repeat(43), 'short', '']) {
      const res = await subscribe.handler(confirmEv(t));
      expect(res.headers.location).toBe('https://vettid.org/?subscribed=0');
    }
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});

describe('check-verifications: identity reclaim', () => {
  const expiredRow = { email: 'x@example.com', status: 'pending', expiresAt: 1 };
  beforeEach(() => {
    ddb.on(QueryCommand, { TableName: 'list', ExpressionAttributeValues: { ':pending': 'pending' } }).resolves({ Items: [expiredRow] });
    ddb.on(QueryCommand, { TableName: 'list', ExpressionAttributeValues: { ':release': 'release' } }).resolves({ Items: [] });
    ddb.on(DeleteCommand).resolves({});
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: false });
    ses.on(DeleteEmailIdentityCommand).resolves({});
  });

  test('deletes an unverified identity when no member uses the address', async () => {
    ddb.on(QueryCommand, { TableName: 'members' }).resolves({ Items: [] });
    const out = await check.handler();
    expect(out).toMatchObject({ reclaimed: 1, keptForMember: 0 });
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(1);
  });

  test("keeps the identity when a member row has the address (a pending member's verification)", async () => {
    ddb.on(QueryCommand, { TableName: 'members' }).resolves({ Items: [{ user_guid: 'g' }] });
    const out = await check.handler();
    expect(out).toMatchObject({ reclaimed: 0, keptForMember: 1 });
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
    const q = ddb.commandCalls(QueryCommand).find((c) => c.args[0].input.TableName === 'members')!.args[0].input;
    expect(q).toMatchObject({ IndexName: 'email-index', ExpressionAttributeValues: { ':e': 'x@example.com' } });
    // our expired row is still cleaned up
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  test('a failed member lookup keeps the identity (fail safe)', async () => {
    ddb.on(QueryCommand, { TableName: 'members' }).rejects(new Error('boom'));
    await check.handler();
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
  });

  test('pending_link rows are never swept to confirmed (only status=pending is queried)', async () => {
    await check.handler();
    const qs = ddb.commandCalls(QueryCommand).filter((c) => c.args[0].input.TableName === 'list').map((c) => c.args[0].input.ExpressionAttributeValues);
    expect(qs).toEqual([{ ':pending': 'pending' }, { ':release': 'release' }]);
  });
});

describe('check-verifications: confirming', () => {
  const row = { email: 'x@example.com', status: 'pending', unsubToken: 'T'.repeat(43) };
  beforeEach(() => {
    ddb.on(QueryCommand, { TableName: 'list', ExpressionAttributeValues: { ':pending': 'pending' } }).resolves({ Items: [row] });
    ddb.on(QueryCommand, { TableName: 'list', ExpressionAttributeValues: { ':release': 'release' } }).resolves({ Items: [] });
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: true });
    ddb.on(UpdateCommand).resolves({ Attributes: { ...row, status: 'confirmed' } });
  });

  test('a verified subscriber gets the welcome mail with their unsubscribe link and headers', async () => {
    const out = await check.handler();
    expect(out).toMatchObject({ confirmed: 1 });
    const upd = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(upd.ConditionExpression).toBe('#s = :pending'); // not one that unsubscribed since the query
    expect(upd.UpdateExpression).toContain('unsubToken = if_not_exists(unsubToken, :u)');
    const welcome = ses.commandCalls(SendEmailCommand).map((c) => c.args[0].input).find((m) => m.Destination!.ToAddresses![0] === 'x@example.com')!;
    expect(welcome.Content!.Simple!.Body!.Text!.Data).toContain(`https://vettid.org/unsubscribe/#u=${row.unsubToken}`);
    expect(welcome.Content!.Simple!.Headers).toEqual([
      { Name: 'List-Unsubscribe', Value: `<https://vettid.org/api/subscribe/unsubscribe?u=${row.unsubToken}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ]);
  });

  test('the admin notice carries no address', async () => {
    await check.handler();
    const notice = ses.commandCalls(SendEmailCommand).map((c) => c.args[0].input).find((m) => m.Destination!.ToAddresses![0] === 'admin@vettid.org')!;
    expect(JSON.stringify(notice)).not.toContain('example.com');
    expect(notice.Content!.Simple!.Headers).toBeUndefined(); // not list mail
  });

  test('a failed welcome mail does not undo the confirmation', async () => {
    ses.on(SendEmailCommand).rejects(new Error('ses down'));
    expect(await check.handler()).toMatchObject({ confirmed: 1 });
  });

  test('a row that left between the query and the update is not confirmed, mailed or announced', async () => {
    ddb.on(UpdateCommand).rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    expect(await check.handler()).toMatchObject({ confirmed: 0 });
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
});

describe('unsubscribe: the route', () => {
  const token = 'U'.repeat(43);
  const found = () => ddb.on(QueryCommand, { TableName: 'list', IndexName: 'unsub-index' }).resolves({ Items: [{ email: 'm@example.com', unsubToken: token }] });
  beforeEach(() => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(DeleteCommand).resolves({ Attributes: { email: 'm@example.com', status: 'confirmed', unsubToken: token } });
  });

  test('GET never unsubscribes and never looks anything up: it sends the token to the page, in the fragment', async () => {
    found();
    const res = await subscribe.handler(unsubGet(token));
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`https://vettid.org/unsubscribe/#u=${token}`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(ddb.calls()).toHaveLength(0);
    expect(ses.calls()).toHaveLength(0);
    for (const bad of ['short', 'x'.repeat(44), `${'U'.repeat(42)}\n`, 'a@example.com', undefined]) {
      const r = await subscribe.handler(unsubGet(bad));
      expect(r.headers.location).toBe('https://vettid.org/unsubscribe/');
    }
    expect(ddb.calls()).toHaveLength(0);
  });

  test('needs the origin secret like every route', async () => {
    const ev = unsubOneClick(token);
    ev.headers['x-origin-verify'] = 'nope';
    expect((await subscribe.handler(ev)).statusCode).toBe(403);
    expect(ddb.calls()).toHaveLength(0);
  });

  test("the page's POST removes the row (only the one carrying this token) and leaves a release marker", async () => {
    found();
    const res = await subscribe.handler(unsubForm(token));
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('https://vettid.org/unsubscribe/done/');
    expect(res.headers['cache-control']).toBe('no-store');

    const q = ddb.commandCalls(QueryCommand)[0].args[0].input;
    expect(q).toMatchObject({ IndexName: 'unsub-index', ExpressionAttributeValues: { ':t': token }, Limit: 1 });
    const del = ddb.commandCalls(DeleteCommand)[0].args[0].input;
    expect(del).toMatchObject({ Key: { email: 'm@example.com' }, ConditionExpression: 'unsubToken = :t', ExpressionAttributeValues: { ':t': token } });
    const marker = ddb.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(marker.email).toMatch(/^#release#[0-9a-f]{32}$/);
    expect(marker).toMatchObject({ status: 'release', target: 'm@example.com' });
    expect(marker.expiresAt).toBeUndefined(); // stays until the sweep settles it
    // this function deletes no SES identity and reads no member data
    expect(ses.calls()).toHaveLength(0);
    expect(ddb.commandCalls(QueryCommand).every((c) => c.args[0].input.TableName === 'list')).toBe(true);
  });

  test('a base64-encoded form body works too', async () => {
    found();
    const res = await subscribe.handler(unsubForm(token, { body: Buffer.from(`u=${token}`).toString('base64'), isBase64Encoded: true }));
    expect(res.statusCode).toBe(303);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  test('the RFC 8058 one-click POST (token in the URL, List-Unsubscribe=One-Click in the body) removes the row and answers 200', async () => {
    found();
    const res = await subscribe.handler(unsubOneClick(token));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toBe('You have been removed from the VettID mailing list.\n');
    expect(ddb.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({ email: 'm@example.com' });
  });

  test('an unconfirmed row can be removed too, and its confirm-link pointer goes with it', async () => {
    found();
    ddb.on(DeleteCommand).resolves({ Attributes: { email: 'm@example.com', status: 'pending_link', tokenHash: 'abc', unsubToken: token } });
    await subscribe.handler(unsubForm(token));
    expect(ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key)).toEqual([{ email: 'm@example.com' }, { email: '#confirm#abc' }]);
  });

  test('valid, used, unknown, stale and malformed tokens all get the same answer', async () => {
    const answers = async (ev: (t: string) => any) => {
      const out: any[] = [];
      // valid
      ddb.reset(); found(); ddb.on(PutCommand).resolves({}); ddb.on(DeleteCommand).resolves({ Attributes: { status: 'confirmed' } });
      out.push(await subscribe.handler(ev(token)));
      // used / unknown: the index has nothing
      ddb.reset(); ddb.on(QueryCommand).resolves({ Items: [] });
      out.push(await subscribe.handler(ev(token)));
      expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
      expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
      // stale: the index still answers, the row carries another token by now
      ddb.reset(); found(); ddb.on(PutCommand).resolves({});
      ddb.on(DeleteCommand).rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
      out.push(await subscribe.handler(ev(token)));
      // malformed, an address instead of a token, empty
      for (const bad of ['short', 'm@example.com', '', `${token}x`]) {
        ddb.reset();
        out.push(await subscribe.handler(ev(bad)));
        expect(ddb.calls()).toHaveLength(0);
      }
      return out;
    };
    for (const ev of [unsubForm, unsubOneClick]) {
      const out = await answers(ev);
      for (const res of out) expect(res).toEqual(out[0]);
    }
  });

  test('an address is never accepted in place of a token, and the index can only ever name a subscriber row', async () => {
    // even if the index somehow returned a sentinel row, nothing is deleted
    ddb.on(QueryCommand, { TableName: 'list', IndexName: 'unsub-index' }).resolves({ Items: [{ email: '#send-quota#2026-10-12T10' }] });
    await subscribe.handler(unsubForm(token));
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
    // a JSON body or an `email` field does nothing
    const ev = unsubForm(token);
    ev.body = 'email=m%40example.com';
    await subscribe.handler(ev);
    ev.headers['content-type'] = 'application/json';
    ev.body = JSON.stringify({ u: token });
    await subscribe.handler(ev);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(1);
  });

  test('a failure says so (503) instead of claiming the address was removed', async () => {
    ddb.on(QueryCommand).rejects(new Error('ddb down'));
    for (const ev of [unsubForm(token), unsubOneClick(token)]) {
      const res = await subscribe.handler(ev);
      expect(res.statusCode).toBe(503);
      expect(res.body).not.toContain('removed from');
    }
  });

  test('neither the address nor the token is ever logged', async () => {
    found();
    await subscribe.handler(unsubGet(token));
    await subscribe.handler(unsubForm(token));
    await subscribe.handler(unsubOneClick(token));
    const lines = logged.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lines).toContain('"outcome":"unsubscribed"');
    expect(lines).not.toContain(token);
    expect(lines).not.toContain('example.com');
  });

  test('signing up again after leaving works: a new row with a new token', async () => {
    found();
    await subscribe.handler(unsubForm(token));
    ddb.reset();
    ddb.on(GetCommand).resolves({}); // the row is gone
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({ Attributes: { n: 1 } });
    // the identity still exists (the sweep has not released it yet, or a member uses it)
    ses.on(CreateEmailIdentityCommand).rejects(Object.assign(new Error('exists'), { name: 'AlreadyExistsException' }));
    ses.on(GetEmailIdentityCommand).resolves({ VerifiedForSendingStatus: true });
    const res = await subscribe.handler(post({ email: 'm@example.com' }));
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    const row = ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item!).find((i) => i.email === 'm@example.com')!;
    expect(row.status).toBe('pending_link');
    expect(row.unsubToken).toMatch(TOKEN);
    expect(row.unsubToken).not.toBe(token);
  });
});

describe('check-verifications: finishing an unsubscribe (release markers)', () => {
  const marker = { email: '#release#00ff', status: 'release', target: 'gone@example.com' };
  beforeEach(() => {
    ddb.on(QueryCommand, { TableName: 'list', ExpressionAttributeValues: { ':pending': 'pending' } }).resolves({ Items: [] });
    ddb.on(QueryCommand, { TableName: 'list', ExpressionAttributeValues: { ':release': 'release' } }).resolves({ Items: [marker] });
    ddb.on(QueryCommand, { TableName: 'members' }).resolves({ Items: [] });
    ddb.on(DeleteCommand).resolves({});
    ses.on(DeleteEmailIdentityCommand).resolves({});
  });
  const markerDeleted = () => ddb.commandCalls(DeleteCommand).some((c) => c.args[0].input.Key!.email === marker.email);

  test('deletes the SES identity when nothing else uses the address, then the marker', async () => {
    const out = await check.handler();
    expect(out).toMatchObject({ released: 1, releaseKept: 0, releaseRetry: 0 });
    expect(ses.commandCalls(DeleteEmailIdentityCommand)[0].args[0].input).toEqual({ EmailIdentity: 'gone@example.com' });
    expect(markerDeleted()).toBe(true);
  });

  test("keeps a member's identity: their account email is the same SES identity", async () => {
    ddb.on(QueryCommand, { TableName: 'members' }).resolves({ Items: [{ user_guid: 'g' }] });
    const out = await check.handler();
    expect(out).toMatchObject({ released: 0, releaseKept: 1 });
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
    const q = ddb.commandCalls(QueryCommand).find((c) => c.args[0].input.TableName === 'members')!.args[0].input;
    expect(q).toMatchObject({ IndexName: 'email-index', ExpressionAttributeValues: { ':e': 'gone@example.com' } });
    expect(markerDeleted()).toBe(true);
  });

  test('a failed member lookup deletes nothing and keeps the marker for the next sweep', async () => {
    ddb.on(QueryCommand, { TableName: 'members' }).rejects(new Error('boom'));
    const out = await check.handler();
    expect(out).toMatchObject({ released: 0, releaseKept: 0, releaseRetry: 1 });
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
    expect(markerDeleted()).toBe(false);
  });

  test('keeps the identity of an address that is back on the list', async () => {
    ddb.on(GetCommand, { TableName: 'list', Key: { email: 'gone@example.com' } }).resolves({ Item: { email: 'gone@example.com', status: 'pending_link' } });
    const out = await check.handler();
    expect(out).toMatchObject({ released: 0, releaseKept: 1 });
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
    expect(markerDeleted()).toBe(true);
  });

  test("never deletes one of the project's own addresses", async () => {
    for (const target of ['admin@vettid.org', 'no-reply@staging.vettid.org']) {
      ddb.on(QueryCommand, { TableName: 'list', ExpressionAttributeValues: { ':release': 'release' } }).resolves({ Items: [{ ...marker, target }] });
      await check.handler();
    }
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
    // a look-alike domain is not ours
    ddb.on(QueryCommand, { TableName: 'list', ExpressionAttributeValues: { ':release': 'release' } }).resolves({ Items: [{ ...marker, target: 'a@notvettid.org' }] });
    await check.handler();
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(1);
  });

  test('an identity that is already gone settles the marker; an SES failure keeps it', async () => {
    ses.on(DeleteEmailIdentityCommand).rejects(Object.assign(new Error('nf'), { name: 'NotFoundException' }));
    expect(await check.handler()).toMatchObject({ released: 1, releaseRetry: 0 });
    expect(markerDeleted()).toBe(true);
    ddb.resetHistory();
    ses.on(DeleteEmailIdentityCommand).rejects(Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' }));
    expect(await check.handler()).toMatchObject({ released: 0, releaseRetry: 1 });
    expect(markerDeleted()).toBe(false);
  });
});

describe('list mail helpers', () => {
  test('tokens are 256 random bits, base64url, and differ', () => {
    const a = listMail.newUnsubscribeToken();
    const b = listMail.newUnsubscribeToken();
    expect(a).toMatch(TOKEN);
    expect(a).not.toBe(b);
    expect(listMail.UNSUB_TOKEN_RE.test(a)).toBe(true);
  });

  test('listMessage: body link in the fragment, one-click link in the headers, no address in either URL', () => {
    const t = 'k'.repeat(43);
    const msg = listMail.listMessage({ to: 's@example.com', subject: 'News', text: 'Hello.\n', token: t }).input;
    expect(msg.Destination.ToAddresses).toEqual(['s@example.com']);
    expect(msg.FromEmailAddress).toBe('VettID <no-reply@vettid.org>');
    expect(msg.Content.Simple.Body.Text.Data).toBe(`Hello.\n\n-- \nTo leave the VettID mailing list, open this link and press the button:\nhttps://vettid.org/unsubscribe/#u=${t}\n`);
    expect(msg.Content.Simple.Headers).toEqual(listMail.listHeaders(t));
    expect(listMail.unsubscribePageUrl(t) + listMail.unsubscribeOneClickUrl(t)).not.toContain('@');
  });

  test('ensureUnsubscribeToken keeps an existing token, creates a missing one, and reports a row that is gone', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: { email: 's@example.com', unsubToken: 'kept' } });
    expect(await listMail.ensureUnsubscribeToken(ddb as any, 'list', 's@example.com')).toBe('kept');
    const upd = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(upd.UpdateExpression).toBe('SET unsubToken = if_not_exists(unsubToken, :t)');
    expect(upd.ConditionExpression).toBe('attribute_exists(email)'); // never creates a row
    expect(upd.ExpressionAttributeValues![':t']).toMatch(TOKEN);
    ddb.on(UpdateCommand).rejects(Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }));
    expect(await listMail.ensureUnsubscribeToken(ddb as any, 'list', 's@example.com')).toBeUndefined();
  });
});
