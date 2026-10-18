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

// ---- a member's pending vault deletion: the admin's cancel, and reinstating ----

describe("a member's pending vault deletion", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
  const { SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const { AdminEnableUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
  /* eslint-enable */
  const lambda = mockClient(LambdaClient);
  const ses = mockClient(SESv2Client);
  const FN = 'arn:aws:lambda:us-east-1:123456789012:function:Member-StartOverCancelFn';
  const VID = 'a'.repeat(32);
  const DID = '01JB2Z6V9K3M4N5P6Q7R8S9T0V';
  const member = { ...pending, state: 'member', email: 'ada@example.org', account_status: 'suspended', suspend_reason: 'taken over?' };
  const path = `/admin/members/${G1}/vault/deletion/cancel`;
  let order: string[];

  const answer = (a: Record<string, unknown>) => ({ ok: true, task: 'cancel_start_over', cancelled: [], executing: [], changed: 0, recoveries: [], ...a });
  const job = (a: unknown, FunctionError?: string) =>
    lambda.on(InvokeCommand).callsFake(() => {
      order.push('cancel');
      return { StatusCode: 200, FunctionError, Payload: Buffer.from(a === undefined ? 'not json' : JSON.stringify(a)) };
    });
  const one = { vault_id: VID, deletion_id: DID, requested_at: 1_791_800_000 };
  const audits = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'audit').map((i) => i.Item as Record<string, any>);
  const events = () => audits().filter((a) => a.action);
  const mails = () => ses.commandCalls(SendEmailCommand).map((c: any) => ({
    to: c.args[0].input.Destination!.ToAddresses![0],
    subject: c.args[0].input.Content!.Simple!.Subject!.Data!,
    text: c.args[0].input.Content!.Simple!.Body!.Text!.Data!,
  }));

  beforeEach(() => {
    process.env.START_OVER_CANCEL_FN = FN;
    lambda.reset();
    ses.reset();
    ses.on(SendEmailCommand).resolves({});
    order = [];
    ddb.on(GetCommand).resolves({ Item: member });
    ddb.on(UpdateCommand).callsFake(() => {
      order.push('update');
      return { Attributes: { ...member, account_status: 'active' } };
    });
    idp.on(AdminEnableUserCommand).callsFake(() => {
      order.push('enable');
      return {};
    });
    idp.on(AdminUserGlobalSignOutCommand).callsFake(() => {
      order.push('signout');
      return {};
    });
  });
  afterEach(() => jest.restoreAllMocks()); // the console spies, also after a failed assertion
  afterAll(() => {
    lambda.restore();
    ses.restore();
  });

  describe('the staging time scale (MEMBER-API 2.8.0): the cancel email', () => {
    afterEach(() => {
      delete process.env.STAGE;
      delete process.env.TIME_SCALE;
    });
    test.each([
      ['staging at 24', { STAGE: 'staging', TIME_SCALE: '24' }, 'the 1 hour then starts again.', true],
      ['staging at 1', { STAGE: 'staging', TIME_SCALE: '1' }, 'the 24 hours then start again.', false],
      ['TIME_SCALE outside staging', { STAGE: 'prod', TIME_SCALE: '24' }, 'the 24 hours then start again.', false],
    ])('%s', async (_name, envs, says, note) => {
      Object.assign(process.env, envs);
      job(answer({ cancelled: [one] }));
      await handler(event('POST', path));
      const text = mails()[0].text;
      expect(text).toContain(`ask again on your account page; ${says}`);
      expect(text.endsWith(note ? 'looks wrong.\n\nStaging: 1 day = 1 hour.\n\n— VettID\n' : 'looks wrong.\n\n— VettID\n')).toBe(true);
    });
  });

  test('cancel: the cancel function is asked (synchronously, for this member only); audited with the admin as actor; the member is told', async () => {
    job(answer({ cancelled: [one] }));
    const res = await handler(event('POST', path));
    expect({ status: res.statusCode, body: JSON.parse(res.body) }).toEqual({ status: 200, body: { cancelled: true } });
    const [inv] = lambda.commandCalls(InvokeCommand).map((c: any) => c.args[0].input);
    expect(lambda.commandCalls(InvokeCommand)).toHaveLength(1);
    expect({ fn: inv.FunctionName, type: inv.InvocationType, payload: JSON.parse(Buffer.from(inv.Payload).toString()) }).toEqual({ fn: FN, type: 'RequestResponse', payload: { task: 'cancel_start_over', user_guid: G1 } });
    expect(events()).toEqual([expect.objectContaining({ actor: 'boss@vettid.org', action: 'member.vault_deletion_cancel', subject: G1, detail: { vault_id: VID, deletion_id: DID } })]);
    // The address is in its 90-day record, not in the event.
    expect(audits().filter((a) => !a.action)).toEqual([expect.objectContaining({ email: 'ada@example.org', expires_at: expect.any(Number) })]);
    expect(mails()).toEqual([{ to: 'ada@example.org', subject: 'VettID vault deletion cancelled', text: expect.stringContaining('has been cancelled by VettID support. Your vault and everything in it stay as they are.') }]);
    expect(mails()[0].text).toContain(`requested at ${new Date(one.requested_at * 1000).toISOString()}`);
    // Production's text, unchanged (MEMBER-API 2.8.0: no scale outside staging).
    expect(mails()[0].text).toContain('ask again on your account page; the 24 hours then start again.\n\nIf you did not ask for the deletion, secure your email account, and contact support@vettid.org if anything else looks wrong.\n\n— VettID\n');
    expect(mails()[0].text).not.toContain('Staging');
    // The account itself is not touched.
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(idp.commandCalls(AdminEnableUserCommand)).toHaveLength(0);
  });

  test('cancel works whatever the account status', async () => {
    for (const account_status of ['active', 'suspended', 'canceled']) {
      ddb.on(GetCommand).resolves({ Item: { ...member, account_status } });
      job(answer({ cancelled: [one] }));
      expect(JSON.parse((await handler(event('POST', path))).body)).toEqual({ cancelled: true });
    }
    expect(events().map((e) => e.action)).toEqual(Array(3).fill('member.vault_deletion_cancel'));
  });

  test('nothing pending (or cancelled already): {cancelled: false}, no event, no mail; so a repeat is harmless', async () => {
    job(answer({}));
    for (let i = 0; i < 2; i++) {
      const res = await handler(event('POST', path));
      expect({ status: res.statusCode, body: JSON.parse(res.body) }).toEqual({ status: 200, body: { cancelled: false } });
    }
    expect(events()).toHaveLength(0);
    expect(mails()).toHaveLength(0);
  });

  test('already being carried out: 409, no event, no mail', async () => {
    job(answer({ executing: [{ vault_id: VID, deletion_id: DID }] }));
    const res = await handler(event('POST', path));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).message).toMatch(/already being carried out/);
    expect(events()).toHaveLength(0);
    expect(mails()).toHaveLength(0);
  });

  test('changed while it was being cancelled: 409 (retry)', async () => {
    job(answer({ changed: 1 }));
    const res = await handler(event('POST', path));
    expect(res.statusCode).toBe(409);
    expect(events()).toHaveLength(0);
  });

  test('refused: not an admin (403, nothing asked), an unknown member or a marker row (404), a request that is not an account (409)', async () => {
    job(answer({ cancelled: [one] }));
    expect((await handler(event('POST', path, undefined, 'registered'))).statusCode).toBe(403);
    ddb.on(GetCommand).resolves({});
    expect((await handler(event('POST', path))).statusCode).toBe(404);
    expect((await handler(event('POST', '/admin/members/email:ada@example.org/vault/deletion/cancel'))).statusCode).toBe(404);
    ddb.on(GetCommand).resolves({ Item: pending });
    expect((await handler(event('POST', path))).statusCode).toBe(409);
    expect((await handler(event('GET', path))).statusCode).toBe(404); // POST only
    expect(lambda.commandCalls(InvokeCommand)).toHaveLength(0);
    expect(events()).toHaveLength(0);
  });

  test.each([
    ['the function failed', { errorMessage: 'boom' }, 'Unhandled'],
    ['a failed function whose payload looks like an answer', { ok: true, task: 'cancel_start_over', cancelled: [{ vault_id: 'a'.repeat(32), deletion_id: 'x', requested_at: 1 }], executing: [], changed: 0, recoveries: [] }, 'Unhandled'],
    ['an answer that is not this task\'s (the daily run\'s)', { deleted: 0, reclaimed: 0, expired: 0, vaultRetries: 0 }, undefined],
    ['a well-formed answer of another task', { ok: true, task: 'start_over', cancelled: [{ vault_id: 'a'.repeat(32), deletion_id: 'x', requested_at: 1 }], executing: [], changed: 0, recoveries: [] }, undefined],
    ['an answer that does not say ok', { task: 'cancel_start_over', cancelled: [], executing: [], changed: 0, recoveries: [] }, undefined],
    ['an answer without its lists', { ok: true, task: 'cancel_start_over' }, undefined],
    ['an answer without the recoveries (so that "no active recovery" is never assumed)', { ok: true, task: 'cancel_start_over', cancelled: [], executing: [], changed: 0 }, undefined],
    ['an answer that is not JSON', undefined, undefined],
  ])('%s: 500, and nothing is reported as cancelled', async (_name, a, fnError) => {
    job(a, fnError);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await handler(event('POST', path));
    expect(res.statusCode).toBe(500);
    expect(events()).toHaveLength(0);
    expect(mails()).toHaveLength(0);
    err.mockRestore();
  });

  test('the member is told even if the email cannot be sent: the cancel stands, is audited and is answered', async () => {
    job(answer({ cancelled: [one] }));
    ses.on(SendEmailCommand).rejects(Object.assign(new Error('rejected'), { name: 'MessageRejected' }));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await handler(event('POST', path));
    expect({ status: res.statusCode, body: JSON.parse(res.body) }).toEqual({ status: 200, body: { cancelled: true } });
    expect(events().map((e) => e.action)).toEqual(['member.vault_deletion_cancel']);
    expect(err.mock.calls).toEqual([['vault deletion cancel notice failed', 'MessageRejected']]);
  });

  test('the audit write fails after the record was removed: 500 (the cancel was made; the cancel function logged it; a repeat answers nothing pending)', async () => {
    job(answer({ cancelled: [one] }));
    ddb.on(PutCommand).rejects(new Error('audit down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await handler(event('POST', path))).statusCode).toBe(500);
    ddb.on(PutCommand).resolves({});
    job(answer({}));
    const res = await handler(event('POST', path));
    expect({ status: res.statusCode, body: JSON.parse(res.body) }).toEqual({ status: 200, body: { cancelled: false } });
  });

  test('reinstate: a pending vault deletion is cancelled first, while the account is still not active; audited (on: reinstate); the member is told', async () => {
    job(answer({ cancelled: [one] }));
    const res = await handler(event('POST', `/admin/members/${G1}/reinstate`));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ user_guid: G1, account_status: 'active' });
    expect(order).toEqual(['cancel', 'signout', 'enable', 'update']);
    expect(events().map((e) => [e.action, e.detail])).toEqual([
      ['member.vault_deletion_cancel', { vault_id: VID, deletion_id: DID, on: 'reinstate' }],
      ['member.reinstate', { from: 'suspended' }],
    ]);
    // The email says nothing about the reinstatement: it is sent when the deletion is cancelled, and stays true if the rest fails.
    expect(mails()).toEqual([{ to: 'ada@example.org', subject: 'VettID vault deletion cancelled', text: expect.stringContaining('has been cancelled by VettID support. Your vault and everything in it stay as they are.') }]);
    expect(mails()[0].text).toContain('ask again on your account page; the 24 hours then start again');
    expect(mails()[0].text).not.toMatch(/reinstat/i);
  });

  test('reinstate: from canceled too; with nothing pending it is as before (no cancel event, no mail)', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...member, account_status: 'canceled', delete_after: '2026-10-20T00:00:00Z' } });
    job(answer({}));
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`))).statusCode).toBe(200);
    expect(order).toEqual(['cancel', 'signout', 'enable', 'update']);
    expect(events().map((e) => [e.action, e.detail])).toEqual([['member.reinstate', { from: 'canceled' }]]);
    expect(mails()).toHaveLength(0);
  });

  test('reinstate: one already being carried out does not stop the reinstatement', async () => {
    job(answer({ executing: [{ vault_id: VID, deletion_id: DID }] }));
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`))).statusCode).toBe(200);
    expect(order).toEqual(['cancel', 'signout', 'enable', 'update']);
  });

  test.each([
    ['the cancel cannot be made', { errorMessage: 'boom' }, 'Unhandled', 500],
    ['the deletion changed meanwhile', { ok: true, task: 'cancel_start_over', cancelled: [], executing: [], changed: 1, recoveries: [] }, undefined, 409],
  ])('reinstate: %s: the account stays as it is (sign-in not enabled, status not changed)', async (_name, a, fnError, status) => {
    job(a, fnError);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`))).statusCode).toBe(status);
    expect(order).toEqual(['cancel']);
    expect(events().filter((e) => e.action === 'member.reinstate')).toHaveLength(0);
    err.mockRestore();
  });

  test('reinstate: an account that is already active is refused before anything is asked', async () => {
    ddb.on(GetCommand).resolves({ Item: { ...member, account_status: 'active' } });
    job(answer({ cancelled: [one] }));
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`))).statusCode).toBe(409);
    expect(order).toEqual([]);
  });

  test('reinstate: sign-in is enabled before the status is written, and a failure there leaves the account not active (so deletions stay held); a repeat finishes', async () => {
    job(answer({}));
    idp.on(AdminEnableUserCommand).callsFake(() => {
      order.push('enable');
      throw Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' });
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`))).statusCode).toBe(500);
    expect(order).toEqual(['cancel', 'signout', 'enable']); // no status write
    expect(events().filter((e) => e.action === 'member.reinstate')).toHaveLength(0);
    order = [];
    idp.on(AdminEnableUserCommand).callsFake(() => (order.push('enable'), {}));
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`))).statusCode).toBe(200);
    expect(order).toEqual(['cancel', 'signout', 'enable', 'update']);
  });

  // ---- reinstating with a recovery still active ----

  const recovery = { vault_id: VID, recovery_id: '01JB2Z6V9K3M4N5P6Q7R8S9T0X', state: 'available', available_at: 1_791_800_000, expires_at: 1_791_886_400 };
  const shown = { ...recovery, available_at: new Date(recovery.available_at * 1000).toISOString(), expires_at: new Date(recovery.expires_at * 1000).toISOString() };

  test('reinstate: an active recovery is not cancelled and not ignored: 409 recovery_active with the recovery, the account stays not active; a pending deletion is cancelled all the same', async () => {
    job(answer({ cancelled: [one], recoveries: [recovery] }));
    const res = await handler(event('POST', `/admin/members/${G1}/reinstate`));
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ error: 'recovery_active', message: expect.stringContaining(`is available and stays usable until ${shown.expires_at}`), recoveries: [shown] });
    expect(body.message).toMatch(/not stopped by the suspension/);
    expect(order).toEqual(['cancel']);
    expect(events().map((e) => [e.action, e.detail])).toEqual([['member.vault_deletion_cancel', { vault_id: VID, deletion_id: DID, on: 'reinstate' }]]);
    expect(mails().map((m) => m.subject)).toEqual(['VettID vault deletion cancelled']);
    // Saying false, or nothing, is not a confirmation.
    job(answer({ recoveries: [recovery] }));
    for (const b of [{ allow_active_recovery: false }, {}, undefined]) {
      expect((await handler(event('POST', `/admin/members/${G1}/reinstate`, b))).statusCode).toBe(409);
    }
    expect(order).toEqual(['cancel', 'cancel', 'cancel', 'cancel']);
    expect(events().filter((e) => e.action === 'member.reinstate')).toHaveLength(0);
  });

  test('reinstate: a pending recovery says when its code becomes available', async () => {
    job(answer({ recoveries: [{ ...recovery, state: 'pending' }] }));
    const body = JSON.parse((await handler(event('POST', `/admin/members/${G1}/reinstate`))).body);
    expect(body.message).toContain(`is pending (its code becomes available at ${shown.available_at}) and stays usable until ${shown.expires_at}`);
  });

  test('reinstate: with the confirmation it goes on, and the event beside member.reinstate records the recovery that was allowed', async () => {
    job(answer({ recoveries: [recovery] }));
    const res = await handler(event('POST', `/admin/members/${G1}/reinstate`, { allow_active_recovery: true }));
    expect(res.statusCode).toBe(200);
    expect(order).toEqual(['cancel', 'signout', 'enable', 'update']);
    expect(events().map((e) => [e.action, e.detail])).toEqual([
      ['member.reinstate_with_active_recovery', { vault_id: VID, recovery_id: recovery.recovery_id, state: 'available', expires_at: shown.expires_at }],
      ['member.reinstate', { from: 'suspended' }],
    ]);
  });

  test('reinstate: the record of the allowed recovery is written before sign-in is enabled, so it exists when a later step fails', async () => {
    job(answer({ recoveries: [recovery] }));
    ddb.on(PutCommand).callsFake((input) => {
      if (input.TableName === 'audit' && input.Item.action) order.push(`audit:${input.Item.action}`);
      return {};
    });
    idp.on(AdminEnableUserCommand).callsFake(() => {
      order.push('enable');
      throw Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' });
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`, { allow_active_recovery: true }))).statusCode).toBe(500);
    expect(order).toEqual(['cancel', 'audit:member.reinstate_with_active_recovery', 'signout', 'enable']);
    expect(events().map((e) => e.action)).toEqual(['member.reinstate_with_active_recovery']);
  });

  test("reinstate: the member's sessions are ended before sign-in is enabled (a suspension may have been half done); if that fails the account stays not active", async () => {
    job(answer({}));
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`))).statusCode).toBe(200);
    expect(order).toEqual(['cancel', 'signout', 'enable', 'update']);
    expect(idp.commandCalls(AdminUserGlobalSignOutCommand).map((c) => c.args[0].input)).toEqual([{ UserPoolId: 'us-east-1_pool', Username: 'ada@example.org' }]);
    order = [];
    idp.on(AdminUserGlobalSignOutCommand).callsFake(() => {
      order.push('signout');
      throw Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' });
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`))).statusCode).toBe(500);
    expect(order).toEqual(['cancel', 'signout']); // sign-in not enabled, status not written
    expect(events().filter((e) => e.action === 'member.reinstate')).toHaveLength(1); // the first call's only
  });

  test('reinstate: the confirmation changes nothing when no recovery is active, and must be a boolean', async () => {
    job(answer({}));
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`, { allow_active_recovery: true }))).statusCode).toBe(200);
    expect(events().map((e) => e.action)).toEqual(['member.reinstate']);
    order = [];
    expect((await handler(event('POST', `/admin/members/${G1}/reinstate`, { allow_active_recovery: 'yes' }))).statusCode).toBe(400);
    expect(order).toEqual([]);
  });

  test('the admin cancel of a deletion does not ask about a recovery', async () => {
    job(answer({ cancelled: [one], recoveries: [recovery] }));
    const res = await handler(event('POST', path));
    expect({ status: res.statusCode, body: JSON.parse(res.body) }).toEqual({ status: 200, body: { cancelled: true } });
  });

  // ---- suspend: the status first ----

  describe('suspend', () => {
    const active = { ...member, account_status: 'active', suspend_reason: undefined };
    const fail = () => Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' });
    const suspend = () => handler(event('POST', `/admin/members/${G1}/suspend`, { reason: 'looks taken over' }));
    beforeEach(() => {
      ddb.on(GetCommand).resolves({ Item: active });
      ddb.on(UpdateCommand).callsFake((input) => {
        order.push('status');
        return { Attributes: { ...active, account_status: 'suspended', suspend_reason: input.ExpressionAttributeValues[':s1'] } };
      });
      idp.on(AdminDisableUserCommand).callsFake(() => (order.push('disable'), {}));
      idp.on(AdminUserGlobalSignOutCommand).callsFake(() => (order.push('signout'), {}));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    test('the status is written first (conditional on active), then sign-in is disabled and the sessions ended; audited as before', async () => {
      const res = await suspend();
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ user_guid: G1, account_status: 'suspended' });
      expect(order).toEqual(['status', 'disable', 'signout']);
      const upd = ddb.commandCalls(UpdateCommand)[0].args[0].input;
      expect(Object.values(upd.ExpressionAttributeValues!)).toEqual(expect.arrayContaining(['suspended', 'looks taken over', 'active']));
      expect(upd.ConditionExpression).toContain('#c0 = :c0');
      expect(events().map((e) => [e.actor, e.action, e.subject, e.detail])).toEqual([['boss@vettid.org', 'member.suspend', G1, { reason: 'looks taken over' }]]); // no `repeat` on a first suspension
    });

    test.each([['disabling sign-in', AdminDisableUserCommand, ['status', 'disable']], ['ending the sessions', AdminUserGlobalSignOutCommand, ['status', 'disable', 'signout']]] as const)(
      '%s fails: the account is already suspended (the status was written), Suspend answers an error and no event; a repeat finishes without writing the status again',
      async (_name, command, sofar) => {
        idp.on(command as any).callsFake(() => {
          order.push(command === AdminDisableUserCommand ? 'disable' : 'signout');
          throw fail();
        });
        expect((await suspend()).statusCode).toBe(500);
        expect(order).toEqual(sofar);
        expect(events()).toHaveLength(0);
        // The repeat: the row now says suspended.
        order = [];
        ddb.on(GetCommand).resolves({ Item: { ...active, account_status: 'suspended', suspend_reason: 'looks taken over' } });
        idp.on(command as any).callsFake(() => (order.push(command === AdminDisableUserCommand ? 'disable' : 'signout'), {}));
        const res = await suspend();
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ account_status: 'suspended' });
        expect(order).toEqual(['disable', 'signout']);
        // The repeat's event says so: its reason is the one given now, the row keeps the first.
        expect(events().map((e) => [e.action, e.detail])).toEqual([['member.suspend', { reason: 'looks taken over', repeat: true }]]);
        expect(ddb.commandCalls(UpdateCommand)).toHaveLength(1); // the first attempt's only
      },
    );

    test('the status write fails (another admin changed the account): 409, and Cognito is not touched', async () => {
      ddb.on(UpdateCommand).rejects(Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' }));
      expect((await suspend()).statusCode).toBe(409);
      expect(order).toEqual([]);
      expect(events()).toHaveLength(0);
    });

    test('a canceled account is still refused (409), and a request that is not an account', async () => {
      ddb.on(GetCommand).resolves({ Item: { ...active, account_status: 'canceled' } });
      expect((await suspend()).statusCode).toBe(409);
      ddb.on(GetCommand).resolves({ Item: pending });
      expect((await suspend()).statusCode).toBe(409);
      expect(order).toEqual([]);
    });

    test('suspending does not touch a pending vault deletion (it waits; the cancel function is not asked)', async () => {
      job(answer({ cancelled: [one] }));
      expect((await suspend()).statusCode).toBe(200);
      expect(lambda.commandCalls(InvokeCommand)).toHaveLength(0);
    });
  });
});
