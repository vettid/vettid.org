import { mockClient } from 'aws-sdk-client-mock';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DeleteEmailIdentityCommand, SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { marshall } from '@aws-sdk/util-dynamodb';

Object.assign(process.env, {
  TABLE_MEMBERS: 'members', TABLE_SUBSCRIPTIONS: 'subs', TABLE_AUDIT: 'audit', TABLE_MAILING_LIST: 'list', TABLE_VAULTS: 'vaults', TABLE_RATELIMITS: 'rl',
  TABLE_VAULT_INSTANCES: 'instances', TABLE_VAULT_RELEASES: 'releases',
  VAULT_QUEUE_URL_PREFIX: 'https://sqs.us-east-1.amazonaws.com/123456789012/vettid-org-vault-control-',
  MEMBER_POOL_ID: 'pool', SENDER_EMAIL: 'no-reply@vettid.org', ACCOUNT_HOST: 'account.vettid.org',
});
/* eslint-disable @typescript-eslint/no-require-imports */
const cleanup = require('../../lambda/jobs/cleanup');
const stream = require('../../lambda/jobs/members-stream');
const alarms = require('../../lambda/jobs/vault-alarms');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const idp = mockClient(CognitoIdentityProviderClient);
const ses = mockClient(SESv2Client);
const sqs = mockClient(SQSClient);
const ccf = () => Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' });

beforeEach(() => {
  ddb.reset(); idp.reset(); ses.reset(); sqs.reset();
  ddb.on(PutCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [] });
  ddb.on(ScanCommand).resolves({ Items: [] });
  sqs.on(SendMessageCommand).resolves({});
});

describe('cleanup job', () => {
  const canceled = { user_guid: 'g1', email: 'gone@x.org', state: 'member', account_status: 'canceled', delete_after: '2020-01-01T00:00:00Z' };

  test('a member reinstated after the query is left completely alone', async () => {
    ddb.on(QueryCommand, { TableName: 'members', ExpressionAttributeValues: { ':s': 'member', ':c': 'canceled', ':now': expect.anything() } } as any).resolves({ Items: [canceled] });
    ddb.on(QueryCommand).callsFake((input) => (input.ExpressionAttributeValues?.[':c'] === 'canceled' && input.ExpressionAttributeValues?.[':s'] === 'member' ? { Items: [canceled] } : { Items: [] }));
    ddb.on(DeleteCommand).rejects(ccf()); // conditional row delete fails: reinstated
    const r = await cleanup.handler();
    expect(r.deleted).toBe(0);
    expect(idp.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(1); // only the guarded attempt
  });

  const R = 'c'.repeat(96);
  const QP = 'https://sqs.us-east-1.amazonaws.com/123456789012/vettid-org-vault-control-';
  const nowS = () => Math.floor(Date.now() / 1000);
  const liveInst = (id: string) => ({ instance_id: id, release: R, queue_url: QP + id, descriptor: 'd', attestation: 'a', heartbeat_at: nowS() });
  const withVaults = (vaults: Record<string, unknown>[]) =>
    ddb.on(QueryCommand).callsFake((input) => {
      if (input.TableName === 'vaults') return { Items: vaults };
      if (input.TableName === 'instances') return { Items: [] };
      return input.ExpressionAttributeValues?.[':c'] === 'canceled' && input.ExpressionAttributeValues?.[':s'] === 'member' ? { Items: [canceled] } : { Items: [] };
    });

  test('a canceled account: each sealed vault is asked to delete itself (§12.5); its row stays until the deletion notice', async () => {
    withVaults([
      { vault_id: 'a'.repeat(32), user_guid: 'g1', state: 'locked', sealed_release: R, lease: { instance_id: 'i1', lease_expires_at: nowS() + 60 } },
      { vault_id: 'b'.repeat(32), user_guid: 'g1', state: 'enrolling' }, // never sealed: nothing stored
      { vault_id: 'c'.repeat(32), user_guid: 'g1', state: 'deleted' },
    ]);
    ddb.on(GetCommand, { TableName: 'instances' } as any).resolves({ Item: liveInst('i1') });
    ddb.on(DeleteCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    idp.on(AdminDeleteUserCommand).resolves({});
    const r = await cleanup.handler();
    expect(r.deleted).toBe(1);
    const [send] = sqs.commandCalls(SendMessageCommand);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(1);
    expect(send.args[0].input.QueueUrl).toBe(QP + 'i1');
    const msg = JSON.parse(send.args[0].input.MessageBody!);
    expect(Object.keys(msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'enqueued_at']);
    expect(msg).toMatchObject({ v: 1, op: 'delete', vault_id: 'a'.repeat(32), user_guid: 'g1' });
    expect(msg.request_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const mark = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).find((i) => i.TableName === 'vaults')!;
    expect(mark).toMatchObject({ Key: { vault_id: 'a'.repeat(32) }, UpdateExpression: 'SET deletion_requested_at = :t' });
    const vaultDeletes = ddb.commandCalls(DeleteCommand).filter((c) => c.args[0].input.TableName === 'vaults').map((c) => c.args[0].input.Key);
    expect(vaultDeletes).toEqual([{ vault_id: 'b'.repeat(32) }, { vault_id: 'user#g1' }]);
    expect(ddb.commandCalls(DeleteCommand)[0].args[0].input).toMatchObject({ TableName: 'members', Key: { user_guid: 'g1' } });
  });

  test('no live instance: a start is requested, the deletion is marked, nothing is queued', async () => {
    withVaults([{ vault_id: 'a'.repeat(32), user_guid: 'g1', state: 'locked', sealed_release: R }]);
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'active' } });
    ddb.on(DeleteCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    idp.on(AdminDeleteUserCommand).resolves({});
    await cleanup.handler();
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    const ups = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(ups.find((i) => i.TableName === 'releases')).toMatchObject({ Key: { release: R } });
    expect(ups.find((i) => i.TableName === 'vaults')).toMatchObject({ UpdateExpression: 'SET deletion_requested_at = :t' });
  });

  test('a removed release (0.10.0) is never asked to start, unless reopened for a rescue', async () => {
    withVaults([{ vault_id: 'a'.repeat(32), user_guid: 'g1', state: 'locked', sealed_release: R }]);
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'removed', available: false } });
    ddb.on(DeleteCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    idp.on(AdminDeleteUserCommand).resolves({});
    await cleanup.handler();
    let ups = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(ups.find((i) => i.TableName === 'releases')).toBeUndefined();
    expect(ups.find((i) => i.TableName === 'vaults')).toMatchObject({ UpdateExpression: 'SET deletion_requested_at = :t' });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);

    ddb.resetHistory();
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'removed', rescue: true } });
    await cleanup.handler();
    ups = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(ups.find((i) => i.TableName === 'releases')).toMatchObject({ Key: { release: R } });
  });

  test('unreported deletions are retried; after 30 days they are flagged with the vault_id only', async () => {
    ddb.on(ScanCommand).resolves({ Items: [{ vault_id: 'a'.repeat(32), user_guid: 'g9', state: 'locked', sealed_release: R, deletion_requested_at: nowS() - 31 * 86_400 }] });
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'active' } });
    ddb.on(UpdateCommand).resolves({});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await cleanup.handler();
    expect(r.vaultRetries).toBe(1);
    expect(JSON.stringify(warn.mock.calls)).toContain('a'.repeat(32));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('g9');
    const scan = ddb.commandCalls(ScanCommand)[0].args[0].input;
    expect(scan.FilterExpression).toContain('#s <> :d');
    warn.mockRestore();
  });

  test('stale unverified request: row + marker removed; SES identity kept if the mailing list uses it', async () => {
    const stale = { user_guid: 'g2', email: 'list@x.org', state: 'requested', email_verified: false };
    ddb.on(QueryCommand).callsFake((input) => (input.ExpressionAttributeValues?.[':r'] === 'requested' ? { Items: [stale] } : { Items: [] }));
    ddb.on(DeleteCommand).resolves({});
    ddb.on(GetCommand, { TableName: 'list' }).resolves({ Item: { email: 'list@x.org' } });
    const r = await cleanup.handler();
    expect(r.reclaimed).toBe(1);
    expect(ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input.Key)).toEqual([{ user_guid: 'g2' }, { user_guid: 'email:list@x.org' }]);
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
  });

  test('stale unverified request not on the list: its SES identity is deleted too', async () => {
    const stale = { user_guid: 'g3', email: 'nobody@x.org', state: 'requested', email_verified: false };
    ddb.on(QueryCommand).callsFake((input) => (input.ExpressionAttributeValues?.[':r'] === 'requested' ? { Items: [stale] } : { Items: [] }));
    ddb.on(DeleteCommand).resolves({});
    ddb.on(GetCommand, { TableName: 'list' }).resolves({});
    ses.on(DeleteEmailIdentityCommand).resolves({});
    await cleanup.handler();
    expect(ses.commandCalls(DeleteEmailIdentityCommand)[0].args[0].input.EmailIdentity).toBe('nobody@x.org');
  });
});

describe('members stream mailer', () => {
  const rec = (img: Record<string, unknown>) => ({ eventName: 'MODIFY', dynamodb: { NewImage: marshall(img) } });
  const ready = { user_guid: 'g1', email: 'm@x.org', first_name: 'Evil\nhttps://phish', state: 'registered', account_status: 'active', email_verified: true };

  test('the once-only claim re-checks the live row (never recreates a deleted member)', async () => {
    ddb.on(UpdateCommand).resolves({});
    ses.on(SendEmailCommand).resolves({});
    await stream.handler({ Records: [rec(ready)] } as any, {} as any, () => undefined);
    const claim = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(claim.ConditionExpression).toContain('attribute_exists(user_guid)');
    expect(claim.ConditionExpression).toContain('account_status = :active');
    const text = ses.commandCalls(SendEmailCommand)[0].args[0].input.Content!.Simple!.Body!.Text!.Data!;
    expect(text).not.toContain('phish'); // no member-supplied text in system email
  });

  test('if the claim fails (deleted/suspended/already sent) nothing is emailed', async () => {
    ddb.on(UpdateCommand).rejects(ccf());
    await stream.handler({ Records: [rec(ready)] } as any, {} as any, () => undefined);
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
});

describe('vault alarm mailer (VAULT-MESSAGING 0.9.0 §11.5)', () => {
  const VID = 'a'.repeat(32);
  const AID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
  const row = (extra: Record<string, unknown> = {}) => ({
    vault_id: VID, user_guid: 'g1', state: 'unlocked',
    alarm: { kind: 'credential_clone', alarm_id: AID, at: 1_790_000_000 }, alarm_pending: true, ...extra,
  });
  const rec = (img: Record<string, unknown>, eventName = 'MODIFY') => ({ eventName, dynamodb: { NewImage: marshall(img, { removeUndefinedValues: true }) } });
  const updates = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'vaults');
  const audits = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'audit').map((i) => i.Item!);
  let count: number;

  beforeEach(() => {
    count = 0;
    ddb.on(UpdateCommand, { TableName: 'rl' } as any).callsFake(() => ({ Attributes: { count: ++count } }));
    ddb.on(UpdateCommand, { TableName: 'vaults' } as any).resolves({});
    ddb.on(GetCommand, { TableName: 'members' } as any).resolves({ Item: { user_guid: 'g1', email: 'm@x.org', account_status: 'active' } });
    ses.on(SendEmailCommand).resolves({});
  });

  test('claims first (conditional on the alarm id), then mails the member and audits; no secrets in the mail', async () => {
    await alarms.handler({ Records: [rec(row())] } as any, {} as any, () => undefined);
    const [claim, stamp] = updates();
    expect(claim).toMatchObject({ Key: { vault_id: VID }, UpdateExpression: 'REMOVE alarm_pending', ExpressionAttributeValues: { ':t': true, ':id': AID } });
    expect(claim.ConditionExpression).toBe('alarm_pending = :t AND alarm.alarm_id = :id');
    expect(stamp.UpdateExpression).toBe('SET alarm.emailed_at = :now');
    const sent = ses.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(sent.Destination!.ToAddresses).toEqual(['m@x.org']);
    const text = sent.Content!.Simple!.Body!.Text!.Data!;
    expect(text).toContain(new Date(1_790_000_000_000).toISOString());
    expect(text).toContain('https://account.vettid.org/');
    expect(text).not.toContain(VID);
    expect(audits()).toEqual([expect.objectContaining({ action: 'vault.alarm_email', actor: 'system', subject: 'g1',
      detail: { vault_id: VID, kind: 'credential_clone', alarm_id: AID, mailed: true } })]);
  });

  test('records without a pending alarm (lease renewals, lifecycle writes, removals) are ignored', async () => {
    const r = await Promise.all([
      alarms.processRecord(rec(row({ alarm_pending: undefined }))),
      alarms.processRecord(rec({ vault_id: VID, user_guid: 'g1', state: 'locked' })),
      alarms.processRecord(rec(row(), 'REMOVE')),
      alarms.processRecord(rec(row({ alarm: { kind: 'credential_clone', alarm_id: 'not-a-ulid', at: 1 } }))),
      alarms.processRecord(rec(row({ vault_id: 'user#g1' }))),
    ]);
    expect(r).toEqual(['ignored', 'ignored', 'ignored', 'ignored', 'ignored']);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  test('a lost claim (already mailed, or replaced by a newer alarm) sends nothing', async () => {
    ddb.on(UpdateCommand, { TableName: 'vaults' } as any).rejects(ccf());
    expect(await alarms.processRecord(rec(row()))).toBe('claimed_elsewhere');
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  test(`at most ${4} alarm mails per vault per day; the rest are audited, not mailed`, async () => {
    for (let i = 0; i < 6; i++) await alarms.processRecord(rec(row()));
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(alarms.MAX_MAILS_PER_DAY);
    const limited = audits().filter((a) => a.detail.reason === 'rate_limited');
    expect(limited).toHaveLength(2);
    expect(ddb.commandCalls(UpdateCommand).find((c) => c.args[0].input.TableName === 'rl')!.args[0].input.Key!.key).toMatch(/^vault-alarm-mail#a{32}#\d+$/);
  });

  test('member missing: nothing mailed, audited as no_member', async () => {
    ddb.on(GetCommand, { TableName: 'members' } as any).resolves({});
    expect(await alarms.processRecord(rec(row()))).toBe('not_mailed');
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
    expect(audits()[0].detail).toMatchObject({ mailed: false, reason: 'no_member' });
    expect(await alarms.processRecord(rec(row({ user_guid: undefined })))).toBe('not_mailed');
  });

  test('unknown alarm kinds are claimed and audited but never mailed', async () => {
    expect(await alarms.processRecord(rec(row({ alarm: { kind: 'other', alarm_id: AID, at: 1 } })))).toBe('not_mailed');
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
    expect(audits()[0].detail).toMatchObject({ reason: 'unknown_kind' });
  });

  test('a transient send failure puts alarm_pending back and rethrows (the stream retries)', async () => {
    ses.on(SendEmailCommand).rejects(Object.assign(new Error('x'), { name: 'Throttling' }));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(alarms.handler({ Records: [rec(row())] } as any, {} as any, () => undefined)).rejects.toThrow('x');
    const restore = updates()[1];
    expect(restore).toMatchObject({ UpdateExpression: 'SET alarm_pending = :t', ExpressionAttributeValues: { ':t': true, ':id': AID } });
    expect(restore.ConditionExpression).toContain('alarm.alarm_id = :id');
    expect(JSON.stringify(err.mock.calls)).not.toContain('m@x.org');
    expect(audits()).toHaveLength(0);
    err.mockRestore();
  });

  test('a permanent rejection (SES sandbox) is audited and not retried', async () => {
    ses.on(SendEmailCommand).rejects(Object.assign(new Error('x'), { name: 'MessageRejected' }));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await alarms.processRecord(rec(row()))).toBe('not_mailed');
    expect(updates()).toHaveLength(1); // the claim only
    expect(audits()[0].detail).toMatchObject({ mailed: false, reason: 'rejected' });
    err.mockRestore();
  });

  describe('vault_deleted notice (§12.5)', () => {
    const del = (extra: Record<string, unknown> = {}) => row({ state: 'deleted', alarm: { kind: 'vault_deleted', alarm_id: AID, at: 1_790_000_000 }, ...extra });
    const deletes = () => ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'vaults');

    test('mails the member, then removes the vault row and the pointer naming it; never rate-limited', async () => {
      ddb.on(DeleteCommand).resolves({});
      for (let i = 0; i < 6; i++) expect(await alarms.processRecord(rec(del()))).toBe('mailed');
      expect(count).toBe(0); // no rate limit
      const text = ses.commandCalls(SendEmailCommand)[0].args[0].input.Content!.Simple!.Body!.Text!.Data!;
      expect(ses.commandCalls(SendEmailCommand)[0].args[0].input.Content!.Simple!.Subject!.Data).toBe('Your VettID vault was deleted');
      expect(text).toContain('cannot be restored');
      expect(text).not.toContain(VID);
      const [rowDel, ptrDel] = deletes();
      expect(rowDel).toMatchObject({ Key: { vault_id: VID }, ConditionExpression: '#s = :deleted', ExpressionAttributeValues: { ':deleted': 'deleted' } });
      expect(ptrDel).toMatchObject({ Key: { vault_id: 'user#g1' }, ConditionExpression: 'current_vault_id = :id', ExpressionAttributeValues: { ':id': VID } });
      expect(audits()[0].detail).toMatchObject({ kind: 'vault_deleted', mailed: true });
    });

    test('a pointer naming another vault is kept (the conditional delete fails quietly)', async () => {
      ddb.on(DeleteCommand, { Key: { vault_id: 'user#g1' } } as any).rejects(ccf());
      ddb.on(DeleteCommand, { Key: { vault_id: VID } } as any).resolves({});
      expect(await alarms.processRecord(rec(del()))).toBe('mailed');
      expect(deletes()).toHaveLength(2);
    });

    test('no member: the rows still go; a transient send failure keeps them and rethrows', async () => {
      ddb.on(DeleteCommand).resolves({});
      ddb.on(GetCommand, { TableName: 'members' } as any).resolves({});
      expect(await alarms.processRecord(rec(del()))).toBe('not_mailed');
      expect(deletes()).toHaveLength(2);
      expect(audits()[0].detail).toMatchObject({ kind: 'vault_deleted', reason: 'no_member' });
      ddb.resetHistory();
      ddb.on(GetCommand, { TableName: 'members' } as any).resolves({ Item: { user_guid: 'g1', email: 'm@x.org' } });
      ses.on(SendEmailCommand).rejects(Object.assign(new Error('x'), { name: 'Throttling' }));
      const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(alarms.processRecord(rec(del()))).rejects.toThrow('x');
      expect(deletes()).toHaveLength(0);
      err.mockRestore();
    });
  });
});
