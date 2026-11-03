import { mockClient } from 'aws-sdk-client-mock';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { AdminDeleteUserCommand, AdminDisableUserCommand, AdminEnableUserCommand, AdminGetUserCommand, AdminUserGlobalSignOutCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { createHash } from 'node:crypto';
import { DeleteEmailIdentityCommand, SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { marshall } from '@aws-sdk/util-dynamodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

Object.assign(process.env, {
  TABLE_MEMBERS: 'members', TABLE_SUBSCRIPTIONS: 'subs', TABLE_AUDIT: 'audit', TABLE_MAILING_LIST: 'list', TABLE_VAULTS: 'vaults', TABLE_RATELIMITS: 'rl',
  TABLE_VAULT_INSTANCES: 'instances', TABLE_VAULT_RELEASES: 'releases', TABLE_VAULT_REQUESTS: 'requests',
  VAULT_QUEUE_URL_PREFIX: 'https://sqs.us-east-1.amazonaws.com/123456789012/vettid-org-vault-control-',
  MEMBER_POOL_ID: 'pool', SENDER_EMAIL: 'no-reply@vettid.org', ACCOUNT_HOST: 'account.vettid.org',
  VAULT_SERVICE_PARAM: '/vettid-org/prod/switch/vault-service',
});
/* eslint-disable @typescript-eslint/no-require-imports */
const cleanup = require('../../lambda/jobs/cleanup');
const stream = require('../../lambda/jobs/members-stream');
const alarms = require('../../lambda/jobs/vault-alarms');
const serviceWatch = require('../../lambda/jobs/vault-service-watch');
const vaultService = require('../../lambda/shared/vault-service');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const idp = mockClient(CognitoIdentityProviderClient);
const ses = mockClient(SESv2Client);
const sqs = mockClient(SQSClient);
const ssm = mockClient(SSMClient);
const PAUSED = JSON.stringify({ enabled: false, reason: 'incident', set_by: 'ops@vettid.org', set_at: '2026-10-05T20:00:00.000Z' });
const ccf = () => Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' });
/** MEMBER-API 2.11.0: the account deletion's mark on each vault row it asks. */
const MARK_ACCOUNT = 'SET account_deleted_at = if_not_exists(account_deleted_at, :t)';

beforeEach(() => {
  ddb.reset(); idp.reset(); ses.reset(); sqs.reset(); ssm.reset();
  vaultService.resetVaultServiceCache();
  ssm.on(GetParameterCommand).rejects(Object.assign(new Error('nf'), { name: 'ParameterNotFound' }));
  ddb.on(PutCommand).resolves({});
  ddb.on(QueryCommand).resolves({ Items: [] });
  ddb.on(ScanCommand).resolves({ Items: [] });
  sqs.on(SendMessageCommand).resolves({});
  // The sign-in user under the canceled account's address is its own.
  idp.on(AdminGetUserCommand).resolves({ UserAttributes: [{ Name: 'custom:user_guid', Value: 'g1' }] });
});

describe('cleanup job', () => {
  const R = 'c'.repeat(96);
  const QP = 'https://sqs.us-east-1.amazonaws.com/123456789012/vettid-org-vault-control-';
  const nowS = () => Math.floor(Date.now() / 1000);
  const liveInst = (id: string) => ({ instance_id: id, release: R, queue_url: QP + id, descriptor: 'd', attestation: 'a', heartbeat_at: nowS() });
  /** The retry of vault deletions already asked (the Scan with deletion_requested_at): the routing of the host's `delete`. */
  const retryScan = (items: Record<string, unknown>[]) =>
    ddb.on(ScanCommand).callsFake((i) => (String(i.FilterExpression).includes('deletion_requested_at < :recent') ? { Items: items } : { Items: [] }));
  const asked = (extra: Record<string, unknown> = {}) => ({ vault_id: 'a'.repeat(32), user_guid: 'g9', state: 'locked', sealed_release: R, deletion_requested_at: nowS() - 7200, ...extra });

  test('a vault already asked, its leaseholder live: the host delete goes to its queue', async () => {
    retryScan([asked({ lease: { instance_id: 'i1', lease_expires_at: nowS() + 60 } })]);
    ddb.on(GetCommand, { TableName: 'instances' } as any).resolves({ Item: liveInst('i1') });
    ddb.on(UpdateCommand).resolves({});
    expect((await cleanup.handler()).vaultRetries).toBe(1);
    const [send] = sqs.commandCalls(SendMessageCommand);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(1);
    expect(send.args[0].input.QueueUrl).toBe(QP + 'i1');
    const msg = JSON.parse(send.args[0].input.MessageBody!);
    expect(Object.keys(msg)).toEqual(['v', 'op', 'vault_id', 'user_guid', 'request_id', 'enqueued_at']);
    expect(msg).toMatchObject({ v: 1, op: 'delete', vault_id: 'a'.repeat(32), user_guid: 'g9' });
    expect(msg.request_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('no live instance: a start is requested, nothing is queued', async () => {
    retryScan([asked()]);
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'active' } });
    ddb.on(UpdateCommand).resolves({});
    await cleanup.handler();
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    const ups = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(ups.find((i) => i.TableName === 'releases')).toMatchObject({ Key: { release: R } });
  });

  test('a removed release (0.10.0) is never asked to start, unless reopened for a rescue', async () => {
    retryScan([asked()]);
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'removed', available: false } });
    ddb.on(UpdateCommand).resolves({});
    await cleanup.handler();
    let ups = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(ups.find((i) => i.TableName === 'releases')).toBeUndefined();
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);

    ddb.resetHistory();
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'removed', rescue: true } });
    await cleanup.handler();
    ups = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(ups.find((i) => i.TableName === 'releases')).toMatchObject({ Key: { release: R } });
  });

  test('vault service paused: nothing queued, no start', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: PAUSED } });
    retryScan([asked({ lease: { instance_id: 'i1', lease_expires_at: nowS() + 60 } })]);
    ddb.on(GetCommand, { TableName: 'instances' } as any).resolves({ Item: liveInst('i1') });
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'active' } });
    ddb.on(UpdateCommand).resolves({});
    await cleanup.handler();
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).find((i) => i.TableName === 'releases')).toBeUndefined();
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

  describe('MEMBER-API 2.11.0: the account deletion mark is best effort and reaches vaults asked before it', () => {
    const retryScan = (items: Record<string, unknown>[]) =>
      ddb.on(ScanCommand).callsFake((i) => (String(i.FilterExpression).includes('deletion_requested_at < :recent') ? { Items: items } : { Items: [] }));
    const marks = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.UpdateExpression === MARK_ACCOUNT);

    test('a mark that fails (not a condition) is logged and the vault, and every later one, is still asked', async () => {
      const lease = { instance_id: 'i1', lease_expires_at: nowS() + 60 };
      retryScan([asked({ lease }), asked({ vault_id: 'b'.repeat(32), lease })]);
      ddb.on(GetCommand, { TableName: 'members' } as any).resolves({}); // the member row is gone
      ddb.on(GetCommand, { TableName: 'instances' } as any).resolves({ Item: liveInst('i1') });
      ddb.on(UpdateCommand).resolves({});
      ddb.on(UpdateCommand, { UpdateExpression: MARK_ACCOUNT } as any).rejects(Object.assign(new Error('x'), { name: 'ProvisionedThroughputExceededException' }));
      const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await cleanup.handler();
      expect(sqs.commandCalls(SendMessageCommand).map((c) => JSON.parse(c.args[0].input.MessageBody!).vault_id)).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
      const lines = err.mock.calls.filter((c) => c[0] === 'vault account deletion mark not written');
      expect(lines.map((c) => JSON.parse(c[1] as string))).toEqual([
        { vault_id: 'a'.repeat(32), error: 'ProvisionedThroughputExceededException' },
        { vault_id: 'b'.repeat(32), error: 'ProvisionedThroughputExceededException' },
      ]);
      err.mockRestore();
    });

    test('the retry marks a vault asked before 2.11.0 whose member row is gone; not with the member there, a start-over, a marked row or a read error', async () => {
      const base = { user_guid: 'g9', state: 'locked', sealed_release: R, deletion_requested_at: nowS() - 7200 };
      retryScan([
        { ...base, vault_id: 'a'.repeat(32) },
        { ...base, vault_id: 'b'.repeat(32), user_guid: 'g8' },
        { ...base, vault_id: 'c'.repeat(32), deletion: { deletion_id: 'x', state: 'executing' } },
        { ...base, vault_id: 'd'.repeat(32), account_deleted_at: nowS() - 7200 },
        { ...base, vault_id: 'e'.repeat(32), user_guid: 'g7' },
      ]);
      ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'active' } });
      ddb.on(GetCommand, { TableName: 'members' } as any).callsFake((i) => {
        if (i.Key.user_guid === 'g8') return { Item: { user_guid: 'g8' } };
        if (i.Key.user_guid === 'g7') throw Object.assign(new Error('x'), { name: 'InternalServerError' });
        return {};
      });
      ddb.on(UpdateCommand).resolves({});
      const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const r = await cleanup.handler();
      expect(r.vaultRetries).toBe(5);
      expect(marks().map((m) => m.Key!.vault_id)).toEqual(['a'.repeat(32)]);
      const reads = ddb.commandCalls(GetCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'members' && ['g9', 'g8', 'g7'].includes(i.Key!.user_guid));
      expect(reads.every((i) => i.ConsistentRead === true)).toBe(true);
      expect(err.mock.calls.filter((c) => c[0] === 'vault account deletion mark not written').map((c) => JSON.parse(c[1] as string))).toEqual([{ vault_id: 'e'.repeat(32), error: 'InternalServerError' }]);
      err.mockRestore();
      warn.mockRestore();
    });
  });

  test('stale unverified request: row + marker removed; SES identity kept if the mailing list uses it', async () => {
    const stale = { user_guid: 'g2', email: 'list@x.org', state: 'requested', email_verified: false };
    ddb.on(QueryCommand).callsFake((input) => (input.ExpressionAttributeValues?.[':r'] === 'requested' ? { Items: [stale] } : { Items: [] }));
    ddb.on(GetCommand, { TableName: 'list' }).resolves({ Item: { email: 'list@x.org' } });
    const r = await cleanup.handler();
    expect(r.reclaimed).toBe(1);
    expect(ddb.commandCalls(TransactWriteCommand).map((c) => c.args[0].input.TransactItems!.map((i) => i.Delete!.Key))).toEqual([[{ user_guid: 'g2' }, { user_guid: 'email:list@x.org' }]]);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
  });

  test('stale unverified request not on the list: its SES identity is deleted too', async () => {
    const stale = { user_guid: 'g3', email: 'nobody@x.org', state: 'requested', email_verified: false };
    ddb.on(QueryCommand).callsFake((input) => (input.ExpressionAttributeValues?.[':r'] === 'requested' ? { Items: [stale] } : { Items: [] }));
    ddb.on(GetCommand, { TableName: 'list' }).resolves({});
    ses.on(DeleteEmailIdentityCommand).resolves({});
    await cleanup.handler();
    expect(ses.commandCalls(DeleteEmailIdentityCommand)[0].args[0].input.EmailIdentity).toBe('nobody@x.org');
  });
});

describe('cleanup job: start-overs (MEMBER-API 2.1.0, VAULT-MESSAGING 0.16.0 §11.11.9)', () => {
  const R = 'c'.repeat(96);
  const QP = 'https://sqs.us-east-1.amazonaws.com/123456789012/vettid-org-vault-control-';
  const nowS = () => Math.floor(Date.now() / 1000);
  const DID = '01JB2Z6V9K3M4N5P6Q7R8S9T0V';
  const row = (deletion: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    vault_id: 'a'.repeat(32), user_guid: 'g1', state: 'locked', sealed_release: R, lease: { instance_id: 'i1', lease_expires_at: nowS() + 60 },
    deletion: { deletion_id: DID, requested_at: nowS() - 86_500, ...deletion }, ...extra,
  });
  const run = () => cleanup.handler({ task: 'start_over' });
  const vaultUpdates = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'vaults');
  const audits = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'audit').map((i) => i.Item);

  beforeEach(() => {
    ddb.on(GetCommand, { TableName: 'instances' } as any).resolves({ Item: { instance_id: 'i1', release: R, queue_url: QP + 'i1', descriptor: 'd', attestation: 'a', heartbeat_at: nowS() } });
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'active' } });
    ddb.on(UpdateCommand).resolves({});
    member({ account_status: 'active' });
  });
  // The member the job reads before it carries a start-over out.
  const member = (m: Record<string, unknown> | null) =>
    ddb.on(GetCommand, { TableName: 'members' } as any).resolves(m ? { Item: { user_guid: 'g1', email: 'g1@x.org', state: 'member', ...m } } : {});
  const memberReads = () => ddb.commandCalls(GetCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'members');

  test('a pending one past deletes_at: marked executing (conditional), the host delete queued, queued_at set, audited', async () => {
    ddb.on(ScanCommand).resolves({ Items: [row({ state: 'pending', deletes_at: nowS() - 5 })] });
    expect(await run()).toEqual({ executed: 1, retried: 0 });
    const scan = ddb.commandCalls(ScanCommand)[0].args[0].input;
    expect(scan.FilterExpression).toBe('attribute_exists(deletion) AND #s <> :d');
    const [mark, requested, queued] = vaultUpdates();
    expect(mark).toMatchObject({ UpdateExpression: 'SET deletion.#st = :ex', ConditionExpression: 'deletion.deletion_id = :id AND deletion.#st = :p', ExpressionAttributeValues: { ':ex': 'executing', ':p': 'pending', ':id': DID } });
    expect(requested).toMatchObject({ UpdateExpression: 'SET deletion_requested_at = :t' });
    expect(queued).toMatchObject({ UpdateExpression: 'SET deletion.queued_at = :t', ConditionExpression: 'deletion.deletion_id = :id' });
    const [send] = sqs.commandCalls(SendMessageCommand);
    expect(send.args[0].input.QueueUrl).toBe(QP + 'i1');
    expect(JSON.parse(send.args[0].input.MessageBody!)).toMatchObject({ v: 1, op: 'delete', vault_id: 'a'.repeat(32), user_guid: 'g1' });
    expect(audits()).toEqual([expect.objectContaining({ action: 'vault.deletion_executed' })]);
  });

  test('not yet due, cancelled meanwhile, or already queued: nothing is sent', async () => {
    ddb.on(ScanCommand).resolves({ Items: [
      row({ state: 'pending', deletes_at: nowS() + 60 }),
      row({ state: 'executing', deletes_at: nowS() - 600, queued_at: nowS() - 300 }, { vault_id: 'b'.repeat(32) }),
      row({ state: 'pending', deletes_at: nowS() - 5 }, { vault_id: 'c'.repeat(32) }),
      { vault_id: 'd'.repeat(32), user_guid: 'g4', state: 'locked' }, // no deletion
    ] });
    ddb.on(UpdateCommand, { Key: { vault_id: 'c'.repeat(32) } } as any).rejects(ccf()); // the cancel won
    expect(await run()).toEqual({ executed: 0, retried: 0 });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  test('no instance running: a start is requested and the next run sends it', async () => {
    ddb.on(ScanCommand).resolves({ Items: [row({ state: 'pending', deletes_at: nowS() - 5 }, { lease: undefined })] });
    ddb.on(QueryCommand).resolves({ Items: [] });
    expect(await run()).toEqual({ executed: 1, retried: 0 });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(vaultUpdates().map((u) => u.UpdateExpression)).not.toContain('SET deletion.queued_at = :t');
    expect(ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).find((i) => i.TableName === 'releases')).toBeDefined();

    ddb.resetHistory();
    ddb.on(ScanCommand).resolves({ Items: [row({ state: 'executing', deletes_at: nowS() - 300 }, { deletion_requested_at: nowS() - 300 })] });
    expect(await run()).toEqual({ executed: 0, retried: 1 });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(1);
    expect(vaultUpdates().map((u) => u.UpdateExpression)).toEqual(['SET deletion.queued_at = :t']);
  });

  test('vault service paused: marked executing, nothing queued, no start', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: PAUSED } });
    ddb.on(ScanCommand).resolves({ Items: [row({ state: 'pending', deletes_at: nowS() - 5 })] });
    expect(await run()).toEqual({ executed: 1, retried: 0 });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).find((i) => i.TableName === 'releases')).toBeUndefined();
  });

  test('the daily run does not execute start-overs', async () => {
    ddb.on(ScanCommand).resolves({ Items: [] });
    await cleanup.handler();
    expect(ddb.commandCalls(ScanCommand).map((c) => c.args[0].input.FilterExpression)).not.toContain('attribute_exists(deletion) AND #s <> :d');
  });

  // ---- only for an active account ----

  afterEach(() => jest.restoreAllMocks()); // the console spies below, also after a failed assertion

  test('an active account: the member row is read (consistently) before anything is written', async () => {
    ddb.on(ScanCommand).resolves({ Items: [row({ state: 'pending', deletes_at: nowS() - 5 })] });
    expect(await cleanup.executeStartOvers(nowS())).toEqual({ executed: 1, retried: 0, held: NONE });
    expect(memberReads()).toEqual([{ TableName: 'members', Key: { user_guid: 'g1' }, ConsistentRead: true }]);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(1);
  });

  const NONE = { not_active: 0, no_member: 0, read_error: 0 };
  test.each([
    ['suspended', { account_status: 'suspended' }, 'not_active'],
    ['canceled (its vaults go with the account, by the daily run)', { account_status: 'canceled', delete_after: '2099-01-01T00:00:00Z' }, 'not_active'],
    ['not an account', { state: 'requested', account_status: 'active' }, 'not_active'],
    ['without a member row (an orphan: held, never erased on a missing row)', null, 'no_member'],
  ])('a due deletion of an account that is %s stays pending: not marked, not queued, not audited, not cancelled', async (_name, m, reason) => {
    member(m);
    ddb.on(ScanCommand).resolves({ Items: [row({ state: 'pending', deletes_at: nowS() - 5 })] });
    expect(await cleanup.executeStartOvers(nowS())).toEqual({ executed: 0, retried: 0, held: { ...NONE, [reason]: 1 } });
    expect(memberReads()).toHaveLength(1);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  test('the member row cannot be read: held (nothing is deleted on doubt), and the run goes on to the next vault', async () => {
    ddb.on(GetCommand, { TableName: 'members', Key: { user_guid: 'g1' } } as any).rejects(Object.assign(new Error('x'), { name: 'ProvisionedThroughputExceededException' }));
    ddb.on(GetCommand, { TableName: 'members', Key: { user_guid: 'g2' } } as any).resolves({ Item: { user_guid: 'g2', state: 'member', account_status: 'active' } });
    ddb.on(ScanCommand).resolves({ Items: [
      row({ state: 'pending', deletes_at: nowS() - 5 }),
      row({ state: 'pending', deletes_at: nowS() - 5 }, { vault_id: 'b'.repeat(32), user_guid: 'g2' }),
      row({ state: 'pending', deletes_at: nowS() - 5 }, { vault_id: 'c'.repeat(32), user_guid: undefined }), // no owner on the row
    ] });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await cleanup.executeStartOvers(nowS())).toEqual({ executed: 1, retried: 0, held: { not_active: 0, no_member: 1, read_error: 1 } });
    expect(vaultUpdates().map((u) => u.Key)).toEqual([{ vault_id: 'b'.repeat(32) }, { vault_id: 'b'.repeat(32) }, { vault_id: 'b'.repeat(32) }]);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(1);
    expect(err.mock.calls.map((c) => String(c[0]))).toEqual(['start-over held: the member row could not be read']);
    err.mockRestore();
  });

  test('held for as long as the account is suspended, whatever the time passed; active again (had the reinstatement not cancelled it): carried out', async () => {
    member({ account_status: 'suspended' });
    ddb.on(ScanCommand).resolves({ Items: [row({ state: 'pending', deletes_at: nowS() - 30 * 86_400 })] });
    for (let i = 0; i < 3; i++) expect(await run()).toEqual({ executed: 0, retried: 0 });
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    member({ account_status: 'active' });
    expect(await run()).toEqual({ executed: 1, retried: 0 });
  });

  test('every run writes what it held, by reason, as one EMF line of its own (zeros too); the startOvers line keeps its two fields', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    member({ account_status: 'suspended' });
    ddb.on(GetCommand, { TableName: 'members', Key: { user_guid: 'g2' } } as any).resolves({});
    ddb.on(GetCommand, { TableName: 'members', Key: { user_guid: 'g3' } } as any).rejects(Object.assign(new Error('x'), { name: 'AccessDeniedException' }));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    ddb.on(ScanCommand).resolves({ Items: [
      row({ state: 'pending', deletes_at: nowS() - 5 }),
      row({ state: 'pending', deletes_at: nowS() - 5 }, { vault_id: 'b'.repeat(32) }),
      row({ state: 'pending', deletes_at: nowS() - 5 }, { vault_id: 'c'.repeat(32), user_guid: 'g2' }),
      row({ state: 'pending', deletes_at: nowS() - 5 }, { vault_id: 'd'.repeat(32), user_guid: 'g3' }),
    ] });
    expect(await run()).toEqual({ executed: 0, retried: 0 });
    const lines = log.mock.calls.map((c) => c[0]);
    expect(lines).toHaveLength(3); // 2.10.0: and the deletion resume's own EMF line after them
    expect(lines[0]).toBe('{"startOvers":{"executed":0,"retried":0}}');
    const emf = JSON.parse(lines[1]);
    expect(emf).toMatchObject({ StartOverHeldNotActive: 2, StartOverHeldNoMember: 1, StartOverHeldReadError: 1 });
    expect(emf._aws.CloudWatchMetrics).toEqual([{ Namespace: 'VettID/MemberApi', Dimensions: [[]], Metrics: [
      { Name: 'StartOverHeldNotActive', Unit: 'Count' }, { Name: 'StartOverHeldNoMember', Unit: 'Count' }, { Name: 'StartOverHeldReadError', Unit: 'Count' },
    ] }]);
    expect(lines[1]).not.toMatch(/g1|g2|g3|x\.org/); // counts only
    log.mockClear();
    ddb.on(ScanCommand).resolves({ Items: [] });
    expect(await run()).toEqual({ executed: 0, retried: 0 });
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      '{"startOvers":{"executed":0,"retried":0}}',
      expect.stringContaining('"StartOverHeldNotActive":0,"StartOverHeldNoMember":0,"StartOverHeldReadError":0'),
      expect.stringContaining('"DeletionResumesPending":0'),
    ]);
  });

  test('not yet due: the member row is not read; one already executing is not held back by a later suspension', async () => {
    member({ account_status: 'suspended' });
    ddb.on(ScanCommand).resolves({ Items: [
      row({ state: 'pending', deletes_at: nowS() + 60 }),
      row({ state: 'executing', deletes_at: nowS() - 300 }, { vault_id: 'b'.repeat(32), deletion_requested_at: nowS() - 300 }),
    ] });
    expect(await cleanup.executeStartOvers(nowS())).toEqual({ executed: 0, retried: 1, held: NONE });
    expect(memberReads()).toHaveLength(0);
  });

  test("a pending start-over on a vault the account's own deletion already asked to delete: left to the daily retry, not held", async () => {
    member(null); // the account was deleted after its 7 days; its row is gone
    ddb.on(ScanCommand).resolves({ Items: [row({ state: 'pending', deletes_at: nowS() - 5 }, { deletion_requested_at: nowS() - 60 })] });
    expect(await cleanup.executeStartOvers(nowS())).toEqual({ executed: 0, retried: 0, held: NONE });
    expect(memberReads()).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(audits()).toHaveLength(0);
  });

  test('MEMBER-API 2.14.0: a canceled account past its 7 days whose vault has a pending start-over: held (vault), its vault never asked by the account deletion', async () => {
    const deletesAt = new Date(Date.now() - 2 * 86_400_000).toISOString(); // due at a run already scheduled
    member({ account_status: 'canceled', delete_after: deletesAt, account_deletion: { deletion_id: 'D1', deletes_at: deletesAt, mailing_list: 'keep', mailed_at: deletesAt } });
    const gone = { user_guid: 'g1', email: 'g1@x.org', state: 'member', account_status: 'canceled', delete_after: deletesAt };
    ddb.on(QueryCommand).callsFake((input) => {
      if (input.TableName === 'vaults') return { Items: [row({ state: 'pending', deletes_at: nowS() + 3600 })] };
      if (input.TableName === 'instances') return { Items: [] };
      return input.ExpressionAttributeValues?.[':c'] === 'canceled' && input.ExpressionAttributeValues?.[':s'] === 'member' ? { Items: [gone] } : { Items: [] };
    });
    ses.on(SendEmailCommand).resolves({});
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await cleanup.handler()).toMatchObject({ deleted: 0, failures: 0, incomplete: 0 });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(vaultUpdates()).toEqual([]);
    expect(audits()).toEqual([expect.objectContaining({ action: 'member.deletion_held', detail: { reason: 'vault', vault_ids: ['a'.repeat(32)] } })]);
    jest.restoreAllMocks();
  });

  // ---- the admin API's cancel (its own function, handler cancelHandler) ----

  describe('task cancel_start_over (the function the admin API invokes)', () => {
    const G = '11111111-2222-4333-8444-555555555555';
    const A = 'a'.repeat(32);
    const cancel = (user_guid: unknown = G) => cleanup.cancelHandler({ task: 'cancel_start_over', user_guid });
    const answer = (a: Record<string, unknown> = {}) => ({ ok: true, task: 'cancel_start_over', cancelled: [], executing: [], changed: 0, recoveries: [], ...a });
    /**
     * The vaults table as the task reads it: the member's pointer row and each
     * vault row from the base table, and whatever the (eventually consistent)
     * user-index answers, which may be stale or incomplete.
     */
    const vaults = (t: { pointer?: string | null; index?: Record<string, unknown>[]; base: Record<string, unknown>[] }) =>
      ddb.on(QueryCommand).callsFake((input) => {
        if (input.TableName !== 'vaults') return { Items: [] };
        if (input.IndexName) return { Items: t.index ?? t.base };
        const id = input.ExpressionAttributeValues?.[':id'];
        if (id === `user#${G}`) return { Items: t.pointer === null ? [] : [{ vault_id: id, current_vault_id: t.pointer ?? (t.base[0]?.vault_id as string) }] };
        return { Items: t.base.filter((r) => r.vault_id === id) };
      });
    const queries = () => ddb.commandCalls(QueryCommand).map((c) => c.args[0].input);
    const removes = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    const pendingRow = (extra: Record<string, unknown> = {}, deletion: Record<string, unknown> = {}) => row({ state: 'pending', deletes_at: nowS() - 5, ...deletion }, { user_guid: G, ...extra });

    test('a pending one is removed, only if it is still that deletion and pending; the answer names it; the removal is logged with its ids', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const requested_at = nowS() - 86_500;
      vaults({ base: [pendingRow({}, { requested_at })] });
      expect(await cancel()).toEqual(answer({ cancelled: [{ vault_id: A, deletion_id: DID, requested_at }] }));
      expect(removes()).toEqual([{
        TableName: 'vaults', Key: { vault_id: A }, UpdateExpression: 'REMOVE deletion',
        ConditionExpression: 'deletion.deletion_id = :id AND deletion.#st = :p', ExpressionAttributeNames: { '#st': 'state' }, ExpressionAttributeValues: { ':id': DID, ':p': 'pending' },
      }]);
      expect(log.mock.calls.map((c) => c[0])).toEqual([JSON.stringify({ startOverCancel: { user_guid: G, vault_id: A, deletion_id: DID } })]);
      // Nothing else: no vault is asked to delete itself, no row is deleted, no member row is read, nothing is audited here (the admin API audits).
      expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
      expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
      expect(ddb.commandCalls(ScanCommand)).toHaveLength(0);
      expect(ddb.commandCalls(GetCommand)).toHaveLength(0);
      expect(audits()).toHaveLength(0);
    });

    test('the reads: the pointer row and every vault row from the base table, consistently; the index only for ids', async () => {
      vaults({ base: [pendingRow()] });
      await cancel();
      expect(queries()).toEqual([
        { TableName: 'vaults', KeyConditionExpression: 'vault_id = :id', ExpressionAttributeValues: { ':id': `user#${G}` }, ConsistentRead: true, Limit: 1 },
        expect.objectContaining({ TableName: 'vaults', IndexName: 'user-index', KeyConditionExpression: 'user_guid = :g', ExpressionAttributeValues: { ':g': G } }),
        { TableName: 'vaults', KeyConditionExpression: 'vault_id = :id', ExpressionAttributeValues: { ':id': A }, ConsistentRead: true, Limit: 1 },
      ]);
    });

    test('a stale index is not believed: it shows no deletion, the base table has a pending one: cancelled', async () => {
      vaults({ index: [{ vault_id: A, user_guid: G, state: 'locked' }], base: [pendingRow()] });
      expect((await cancel()).cancelled).toEqual([expect.objectContaining({ vault_id: A, deletion_id: DID })]);
      expect(removes()).toHaveLength(1);
    });

    test('a vault the index does not list at all is found through the pointer row, and its pending deletion cancelled', async () => {
      vaults({ pointer: A, index: [], base: [pendingRow()] });
      expect((await cancel()).cancelled).toEqual([expect.objectContaining({ vault_id: A, deletion_id: DID })]);
      expect(removes()).toHaveLength(1);
    });

    test('a stale index the other way: it still shows a pending deletion, the base table has none (or another one): nothing is written for the stale one', async () => {
      vaults({ index: [pendingRow()], base: [{ vault_id: A, user_guid: G, state: 'locked' }] });
      expect(await cancel()).toEqual(answer());
      expect(removes()).toHaveLength(0);
      ddb.resetHistory();
      const NEWER = '01JB2Z6V9K3M4N5P6Q7R8S9T0Z';
      vaults({ index: [pendingRow()], base: [pendingRow({}, { deletion_id: NEWER })] });
      expect((await cancel()).cancelled).toEqual([expect.objectContaining({ deletion_id: NEWER })]);
      expect(removes().map((u) => u.ExpressionAttributeValues)).toEqual([{ ':id': NEWER, ':p': 'pending' }]);
    });

    test("a row that is not this member's (by the base table) is never touched, whatever the index or the pointer says", async () => {
      vaults({ pointer: A, index: [pendingRow()], base: [pendingRow({ user_guid: 'someone-else' })] });
      expect(await cancel()).toEqual(answer());
      expect(removes()).toHaveLength(0);
    });

    test('every vault of the member is looked at once: the current one and an earlier one from the index', async () => {
      const B = 'b'.repeat(32);
      vaults({ pointer: A, index: [{ vault_id: B, user_guid: G }, { vault_id: A, user_guid: G }], base: [pendingRow(), { vault_id: B, user_guid: G, state: 'deleted', deletion: { deletion_id: DID, state: 'pending', deletes_at: 1 } }] });
      expect((await cancel()).cancelled.map((c: any) => c.vault_id)).toEqual([A]);
      expect(queries().filter((q) => !q.IndexName).map((q) => q.ExpressionAttributeValues?.[':id'])).toEqual([`user#${G}`, A, B]);
    });

    test('not due yet: cancelled all the same; none, no pointer and no vault, a deleted vault or a malformed record: nothing to do (so a repeat is harmless)', async () => {
      vaults({ base: [pendingRow({}, { deletes_at: nowS() + 3600 })] });
      expect((await cancel()).cancelled).toHaveLength(1);
      for (const base of [
        [],
        [{ vault_id: A, user_guid: G, state: 'locked' }],
        [pendingRow({ state: 'deleted' })],
        [{ vault_id: A, user_guid: G, state: 'locked', deletion: { state: 'pending' } }],
        [pendingRow({}, { state: 'cancelled' })],
      ]) {
        ddb.resetHistory();
        vaults({ pointer: base.length ? A : null, base });
        expect(await cancel()).toEqual(answer());
        expect(removes()).toHaveLength(0);
      }
    });

    test('one already executing is reported and left as it is', async () => {
      vaults({ base: [pendingRow({}, { state: 'executing', deletes_at: nowS() - 600, queued_at: nowS() - 300 })] });
      expect(await cancel()).toEqual(answer({ executing: [{ vault_id: A, deletion_id: DID }] }));
      expect(removes()).toHaveLength(0);
    });

    test('changed between the read and the write (the member cancelled, or it was just carried out): counted, not reported as cancelled, not logged as cancelled', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      vaults({ base: [pendingRow()] });
      ddb.on(UpdateCommand).rejects(ccf());
      expect(await cancel()).toEqual(answer({ changed: 1 }));
      expect(log).not.toHaveBeenCalled();
    });

    test('any other failure of the write is a failure of the task, never "changed" or "nothing to cancel"', async () => {
      vaults({ base: [pendingRow()] });
      ddb.on(UpdateCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
      await expect(cancel()).rejects.toThrow('denied');
    });

    test('a failed read is a failure of the task too (the pointer, the index or a row)', async () => {
      for (const failOn of ['pointer', 'index', 'row']) {
        ddb.on(QueryCommand).callsFake((input) => {
          const which = input.IndexName ? 'index' : input.ExpressionAttributeValues?.[':id'] === `user#${G}` ? 'pointer' : 'row';
          if (which === failOn) throw Object.assign(new Error(`no ${which}`), { name: 'InternalServerError' });
          return which === 'pointer' ? { Items: [{ vault_id: `user#${G}`, current_vault_id: A }] } : { Items: [pendingRow()] };
        });
        await expect(cancel()).rejects.toThrow(`no ${failOn}`);
      }
      expect(removes()).toHaveLength(0);
    });

    test('an active recovery is reported with its state and times, and never changed; an ended one is not reported', async () => {
      const t = nowS();
      const rec = (r: Record<string, unknown>) => ({ vault_id: A, user_guid: G, state: 'locked', recovery: { recovery_id: DID, requested_at: t - 100, available_at: t + 86_300, expires_at: t + 172_700, ...r } });
      for (const [r, state] of [
        [{ state: 'pending' }, 'pending'],
        [{ state: 'pending', available_at: t - 10, expires_at: t + 86_390 }, 'available'],
        [{ state: 'registered', available_at: t - 10, expires_at: t + 86_390 }, 'registered'],
      ] as [Record<string, unknown>, string][]) {
        const row = rec(r);
        vaults({ base: [row] });
        expect(await cleanup.cancelStartOvers(G, t)).toEqual(answer({ recoveries: [{ vault_id: A, recovery_id: DID, state, available_at: row.recovery.available_at, expires_at: row.recovery.expires_at }] }));
      }
      for (const r of [{ state: 'cancelled' }, { state: 'unavailable' }, { state: 'completed' }, { state: 'pending', expires_at: t }, { state: 'registered', expires_at: t - 1 }, { state: 'pending', expires_at: undefined }]) {
        vaults({ base: [rec(r)] });
        expect(await cleanup.cancelStartOvers(G, t)).toEqual(answer());
      }
      expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
      // Beside a pending deletion: both are answered, only the deletion is written.
      vaults({ base: [{ ...pendingRow(), recovery: rec({ state: 'pending' }).recovery }] });
      const both = await cleanup.cancelStartOvers(G, t);
      expect([both.cancelled.length, both.recoveries.length]).toEqual([1, 1]);
      expect(removes().map((u) => u.UpdateExpression)).toEqual(['REMOVE deletion']);
    });

    test('anything but an account id is refused before any read', async () => {
      for (const bad of [undefined, '', 'g1', 'email:someone@x.org', 'user#' + G, { S: G }]) {
        await expect(cleanup.cancelHandler({ task: 'cancel_start_over', user_guid: bad })).rejects.toThrow('user_guid is not an account id');
      }
      expect(ddb.calls()).toHaveLength(0);
    });

    test('this function runs that task and nothing else: any other task, or none, is refused and nothing is read or written', async () => {
      for (const ev of [undefined, {}, { user_guid: G }, { task: 'start_over', user_guid: G }, { task: 'requests' }, { task: 'daily' }, { task: 'CANCEL_START_OVER', user_guid: G }]) {
        await expect(cleanup.cancelHandler(ev)).rejects.toThrow('runs the task cancel_start_over only');
      }
      expect(ddb.calls()).toHaveLength(0);
      expect(idp.calls()).toHaveLength(0);
      expect(sqs.calls()).toHaveLength(0);
    });

    test("the job's own handler does not know the task: it cancels nothing (the schedules never send it)", async () => {
      vaults({ base: [pendingRow()] });
      await cleanup.handler({ task: 'cancel_start_over', user_guid: G });
      expect(removes().filter((u) => u.UpdateExpression === 'REMOVE deletion')).toHaveLength(0);
    });
  });
});

describe('cleanup job: the deletion resume (MEMBER-API 2.10.0, VAULT-MESSAGING 0.51.0 §12.5)', () => {
  const R = 'c'.repeat(96);
  const QP = 'https://sqs.us-east-1.amazonaws.com/123456789012/vettid-org-vault-control-';
  const V = 'a'.repeat(32);
  const NOW = 1_800_000_000;
  // A vault that marked its deletion `age` seconds ago and is not `deleted`.
  const marked = (age: number, extra: Record<string, unknown> = {}) => ({
    vault_id: V, user_guid: 'g1', state: 'locked', sealed_release: R, lease: { instance_id: 'i1', lease_expires_at: NOW + 60 },
    deleting_at: NOW - age, ...extra,
  });
  const sends = () => sqs.commandCalls(SendMessageCommand).map((c) => ({ url: c.args[0].input.QueueUrl, body: JSON.parse(c.args[0].input.MessageBody!) }));
  const vaultUpdates = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'vaults');
  const scanRows = (rows: Record<string, unknown>[]) =>
    ddb.on(ScanCommand).callsFake((input) => (input.FilterExpression === 'attribute_exists(deleting_at) AND #s <> :d' ? { Items: rows } : { Items: [] }));

  beforeEach(() => {
    ddb.on(GetCommand, { TableName: 'instances' } as any).resolves({ Item: { instance_id: 'i1', release: R, queue_url: QP + 'i1', descriptor: 'd', attestation: 'a', heartbeat_at: NOW } });
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'active' } });
    ddb.on(UpdateCommand).resolves({});
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  test('scans the rows with deleting_at that are not deleted; one at least 2 minutes old gets delete_resume at the leaseholder and deletion_resumed_at', async () => {
    scanRows([marked(120)]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 1, pending: 0 });
    const scan = ddb.commandCalls(ScanCommand)[0].args[0].input;
    expect(scan).toMatchObject({ TableName: 'vaults', FilterExpression: 'attribute_exists(deleting_at) AND #s <> :d', ExpressionAttributeNames: { '#s': 'state' }, ExpressionAttributeValues: { ':d': 'deleted' } });
    const [s] = sends();
    expect(s.url).toBe(QP + 'i1');
    expect(Object.keys(s.body).sort()).toEqual(['enqueued_at', 'op', 'request_id', 'user_guid', 'v', 'vault_id']); // no envelope
    expect(s.body).toMatchObject({ v: 1, op: 'delete_resume', vault_id: V, user_guid: 'g1', enqueued_at: new Date(NOW * 1000).toISOString() });
    expect(s.body.request_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(vaultUpdates()).toEqual([{ TableName: 'vaults', Key: { vault_id: V }, UpdateExpression: 'SET deletion_resumed_at = :t', ConditionExpression: 'attribute_exists(vault_id)', ExpressionAttributeValues: { ':t': NOW } }]);
  });

  test('a mark younger than 2 minutes, a deleted row, or a row without a numeric mark: nothing', async () => {
    scanRows([marked(119), marked(600, { vault_id: 'b'.repeat(32), state: 'deleted' }), marked(600, { vault_id: 'd'.repeat(32), deleting_at: 'x' })]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 0, pending: 0 });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  test('the first hour: sent at every run, whatever deletion_resumed_at says', async () => {
    scanRows([marked(3599, { deletion_resumed_at: NOW - 300 })]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 1, pending: 0 });
    scanRows([marked(600, { deletion_resumed_at: NOW - 1 })]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 1, pending: 0 });
    expect(sends().map((s) => s.body.op)).toEqual(['delete_resume', 'delete_resume']);
  });

  test('after the first hour: sent only when deletion_resumed_at is at least 1 hour old (or absent)', async () => {
    scanRows([marked(3600, { deletion_resumed_at: NOW - 300 }), marked(7200, { vault_id: 'b'.repeat(32), deletion_resumed_at: NOW - 3599 })]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 0, pending: 2 });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);

    scanRows([marked(7200, { deletion_resumed_at: NOW - 3600 }), marked(5 * 86_400, { vault_id: 'b'.repeat(32) })]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 2, pending: 2 });
    expect(vaultUpdates().map((u) => u.UpdateExpression)).toEqual(['SET deletion_resumed_at = :t', 'SET deletion_resumed_at = :t']);
  });

  test('routed as delete is: no live lease, a live instance of the sealed release; none running, a start is requested and nothing is marked', async () => {
    ddb.on(QueryCommand, { TableName: 'instances' } as any).resolves({ Items: [{ instance_id: 'i2', release: R, load: 0 }] });
    ddb.on(GetCommand, { TableName: 'instances', Key: { instance_id: 'i2' } } as any).resolves({ Item: { instance_id: 'i2', release: R, queue_url: QP + 'i2', descriptor: 'd', attestation: 'a', heartbeat_at: NOW } });
    scanRows([marked(300, { lease: undefined })]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 1, pending: 0 });
    expect(sends().map((s) => s.url)).toEqual([QP + 'i2']);

    sqs.resetHistory(); ddb.resetHistory();
    ddb.on(QueryCommand, { TableName: 'instances' } as any).resolves({ Items: [] });
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 0, pending: 0 });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(vaultUpdates()).toHaveLength(0); // set only when queued: the next run sends once the instance runs
    expect(ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).find((i) => i.TableName === 'releases')).toBeDefined();
  });

  test('vault service paused: nothing sent, no start, nothing marked; still counted as pending', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: PAUSED } });
    scanRows([marked(300), marked(2 * 3600, { vault_id: 'b'.repeat(32) })]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 0, pending: 1 });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  test('a removed release and no live leaseholder: nothing sent and no start, as for delete', async () => {
    ddb.on(GetCommand, { TableName: 'releases' } as any).resolves({ Item: { release: R, release_number: 3, status: 'removed' } });
    scanRows([marked(300, { lease: undefined })]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 0, pending: 0 });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  test('a row with neither a sealed release nor a lease: nothing sent, and the row is never deleted here', async () => {
    scanRows([marked(300, { sealed_release: undefined, lease: undefined })]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 0, pending: 0 });
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  test('NEVER delete: whatever the mark\'s age or state, only delete_resume is sent, and deletion_requested_at is never set', async () => {
    const ages = [120, 600, 3599, 3600, 7200, 86_400, 31 * 86_400];
    scanRows(ages.map((a, i) => marked(a, { vault_id: String(i).repeat(32), state: i % 2 ? 'unlocked' : 'locked' })));
    await cleanup.resumeDeletions(NOW);
    expect(sends()).toHaveLength(ages.length);
    expect(sends().every((s) => s.body.op === 'delete_resume')).toBe(true);
    for (const u of ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input)) {
      expect(JSON.stringify(u)).not.toContain('deletion_requested_at');
      expect(JSON.stringify(u)).not.toContain('deleting_at'); // never written by the job
    }
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  test('a send that fails: logged with the vault_id and error name, not marked, the run goes on', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sqs.on(SendMessageCommand).rejectsOnce(Object.assign(new Error('x'), { name: 'QueueDoesNotExist' })).resolves({});
    scanRows([marked(300), marked(300, { vault_id: 'b'.repeat(32) })]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 1, pending: 0 });
    expect(err.mock.calls).toEqual([['vault delete_resume enqueue failed', JSON.stringify({ vault_id: V, error: 'QueueDoesNotExist' })]]);
    expect(vaultUpdates().map((u) => u.Key)).toEqual([{ vault_id: 'b'.repeat(32) }]);
  });

  test('the row went meanwhile (deleted): the mark\'s write fails its condition and is not an error', async () => {
    ddb.on(UpdateCommand).rejects(ccf());
    scanRows([marked(300)]);
    expect(await cleanup.resumeDeletions(NOW)).toEqual({ sent: 1, pending: 0 });
  });

  describe('logged: "vault deletion resume pending", vault_id only', () => {
    const logged = () => (console.warn as jest.Mock).mock.calls.filter((c) => c[0] === 'vault deletion resume pending');
    test.each([
      [3599, 0], [3600, 1], [3600 + 299, 1], [3600 + 300, 0], [7200, 0], [29 * 86_400, 0],
      [30 * 86_400, 1], [30 * 86_400 + 299, 1], [30 * 86_400 + 300, 0], [31 * 86_400, 1], [31 * 86_400 + 3600, 0], [45 * 86_400 + 120, 1],
    ])('a mark %i seconds old: logged %i time(s) by this run', async (age, n) => {
      scanRows([marked(age, { deletion_resumed_at: NOW - 60 })]);
      await cleanup.resumeDeletions(NOW);
      expect(logged()).toHaveLength(n);
      for (const c of logged()) expect(c[1]).toBe(JSON.stringify({ vault_id: V }));
    });

    test('once in the first hour, over a day of 5-minute runs; nothing else of the member in the line', async () => {
      const deletingAt = NOW;
      let count = 0;
      for (let t = deletingAt; t < deletingAt + 86_400; t += 300) {
        (console.warn as jest.Mock).mockClear();
        scanRows([marked(t - deletingAt, { deleting_at: deletingAt, deletion_resumed_at: t - 60 })]);
        await cleanup.resumeDeletions(t);
        count += logged().length;
        for (const c of (console.warn as jest.Mock).mock.calls) expect(String(c.join(' '))).not.toMatch(/g1|x\.org/);
      }
      expect(count).toBe(1);
    });
  });

  test('the 5-minute run: the start-overs first, then the resume; one EMF line DeletionResumesPending (namespace VettID/MemberApi, no dimensions) at every run, zeros too', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const now = Math.floor(Date.now() / 1000);
    scanRows([marked(300, { deleting_at: now - 300 }), marked(2 * 3600, { vault_id: 'b'.repeat(32), deleting_at: now - 2 * 3600, deletion_resumed_at: now - 600 })]);
    expect(await cleanup.handler({ task: 'start_over' })).toEqual({ executed: 0, retried: 0 }); // the run's answer is unchanged
    expect(ddb.commandCalls(ScanCommand).map((c) => c.args[0].input.FilterExpression)).toEqual(['attribute_exists(deletion) AND #s <> :d', 'attribute_exists(deleting_at) AND #s <> :d']);
    const lines = log.mock.calls.map((c) => c[0]);
    expect(lines[0]).toBe('{"startOvers":{"executed":0,"retried":0}}');
    const emf = JSON.parse(lines[2]);
    expect(emf._aws.CloudWatchMetrics).toEqual([{ Namespace: 'VettID/MemberApi', Dimensions: [[]], Metrics: [{ Name: 'DeletionResumesPending', Unit: 'Count' }] }]);
    expect(emf.DeletionResumesPending).toBe(1);
    expect(lines[2]).not.toMatch(/g1|aaaa|bbbb/); // counts only
    expect(sends().map((s) => s.body.vault_id)).toEqual([V]);

    log.mockClear();
    scanRows([]);
    await cleanup.handler({ task: 'start_over' });
    expect(JSON.parse(log.mock.calls[2][0]).DeletionResumesPending).toBe(0);
  });

  test('a resume sweep that fails: logged, the metric line is still written, the start-overs\' answer stands', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    ddb.on(ScanCommand).callsFake((input) => {
      if (input.FilterExpression === 'attribute_exists(deleting_at) AND #s <> :d') throw Object.assign(new Error('x'), { name: 'ProvisionedThroughputExceededException' });
      return { Items: [] };
    });
    expect(await cleanup.handler({ task: 'start_over' })).toEqual({ executed: 0, retried: 0 });
    expect(err.mock.calls).toEqual([['deletion resume sweep failed', 'ProvisionedThroughputExceededException']]);
    expect(JSON.parse(log.mock.calls[2][0]).DeletionResumesPending).toBe(0);
  });

  test('the daily run and the requests run do not resume', async () => {
    await cleanup.handler();
    await cleanup.handler({ task: 'requests' });
    expect(ddb.commandCalls(ScanCommand).map((c) => c.args[0].input.FilterExpression)).not.toContain('attribute_exists(deleting_at) AND #s <> :d');
  });
});

describe('cleanup job: vaults whose member row is gone (daily run)', () => {
  const R = 'c'.repeat(96);
  const QP = 'https://sqs.us-east-1.amazonaws.com/123456789012/vettid-org-vault-control-';
  const nowS = () => Math.floor(Date.now() / 1000);
  const A = 'a'.repeat(32);
  const B = 'b'.repeat(32);
  const vault = (extra: Record<string, unknown> = {}) => ({ vault_id: A, user_guid: 'g7', state: 'locked', sealed_release: R, lease: { instance_id: 'i1', lease_expires_at: nowS() + 60 }, ...extra });
  const ORPHAN_SCAN = 'attribute_exists(user_guid) AND attribute_not_exists(deletion_requested_at) AND #s <> :d';
  /** The vaults table: the orphan scan answers `scan`; the retry scan nothing; the user-index each owner's rows. */
  const table = (scan: Record<string, unknown>[]) => {
    ddb.on(ScanCommand).callsFake((input) => ({ Items: input.FilterExpression === ORPHAN_SCAN ? scan : [] }));
    ddb.on(QueryCommand).callsFake((input) => (input.TableName === 'vaults' && input.IndexName === 'user-index' ? { Items: scan.filter((v) => v.user_guid === input.ExpressionAttributeValues?.[':g']) } : { Items: [] }));
  };
  const members = (present: string[], failing: string[] = []) =>
    ddb.on(GetCommand).callsFake((input) => {
      if (input.TableName === 'instances') return { Item: { instance_id: 'i1', release: R, queue_url: QP + 'i1', descriptor: 'd', attestation: 'a', heartbeat_at: nowS() } };
      if (input.TableName !== 'members') return {};
      const g = input.Key.user_guid;
      if (failing.includes(g)) throw Object.assign(new Error('x'), { name: 'ProvisionedThroughputExceededException' });
      return present.includes(g) ? { Item: { user_guid: g, state: 'member', account_status: 'active' } } : {};
    });
  const memberReads = () => ddb.commandCalls(GetCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'members');
  const audits = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'audit').map((i) => i.Item);
  const vaultDeletes = () => ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'vaults').map((i) => i.Key);
  let log: jest.SpyInstance;
  const lines = () => log.mock.calls.map((c) => String(c[0]));
  const emf = () => lines().map((l) => JSON.parse(l)).find((l) => l._aws && 'OrphanVaultDeletions' in l);

  beforeEach(() => {
    ddb.on(UpdateCommand).resolves({});
    ddb.on(DeleteCommand).resolves({});
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const DAY = 86_400;
  const vaultWrites = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'vaults');
  const MARK = { UpdateExpression: 'SET orphan_seen_at = :t', ConditionExpression: 'attribute_exists(vault_id) AND attribute_not_exists(orphan_seen_at) AND attribute_not_exists(deletion_requested_at)' };
  const nothingIrreversible = () => {
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(vaultWrites().filter((i) => i.UpdateExpression !== MARK.UpdateExpression && i.UpdateExpression !== 'REMOVE orphan_seen_at')).toEqual([]);
    expect(vaultDeletes()).toEqual([]);
    expect(audits()).toEqual([]);
  };

  test('first sight of a vault without a member row: only marked (conditional, never moved), warned and counted for the alarm; nothing irreversible', async () => {
    table([vault(), vault({ vault_id: B, state: 'enrolling', sealed_release: undefined, lease: undefined })]);
    members([]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await cleanup.handler();
    expect(memberReads()).toEqual([{ TableName: 'members', Key: { user_guid: 'g7' }, ConsistentRead: true }]); // once per owner, consistently
    expect(vaultWrites()).toEqual([
      expect.objectContaining({ Key: { vault_id: A }, ...MARK, ExpressionAttributeValues: { ':t': expect.any(Number) } }),
      expect.objectContaining({ Key: { vault_id: B }, ...MARK }),
    ]);
    nothingIrreversible();
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain('orphaned vaults: a vault without a member row, marked');
    expect(lines()).toContain('{"vaultOrphans":{"marked":2,"waiting":0,"cleared":0,"requested":0,"operator_held":0,"held":0,"read_errors":0,"failures":0}}');
    expect(emf()).toMatchObject({ OrphanVaultsSeen: 2, OrphanVaultsWaiting: 0, OrphanVaultDeletions: 0, OrphanVaultsOperatorHeld: 0, OrphanVaultsHeld: 0 });
    // The summary line and the answer are as before.
    expect(Object.keys(r)).toEqual(['deleted', 'reclaimed', 'expired', 'vaultRetries', 'declined', 'failures', 'incomplete']);
    expect(lines()).toContain(JSON.stringify(r));
  });

  test('a mark that is already there is not moved (the conditional write fails quietly)', async () => {
    table([vault()]);
    members([]);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    ddb.on(UpdateCommand).rejects(ccf());
    await cleanup.handler();
    expect(emf()).toMatchObject({ OrphanVaultsSeen: 0, OrphanVaultsHeld: 0 });
    nothingIrreversible();
  });

  test('inside the 7 days: waiting, nothing written', async () => {
    table([vault({ orphan_seen_at: nowS() - 6 * DAY })]);
    members([]);
    await cleanup.handler();
    expect(vaultWrites()).toEqual([]);
    nothingIrreversible();
    expect(emf()).toMatchObject({ OrphanVaultsSeen: 0, OrphanVaultsWaiting: 1, OrphanVaultDeletions: 0 });
  });

  test("7 days after the mark, the member row still missing: asked to delete itself exactly as for a canceled account (the host's delete, the mark, a never-sealed row and the pointer row deleted), audited, alarmed", async () => {
    const seen = nowS() - 7 * DAY - 60;
    table([vault({ orphan_seen_at: seen }), vault({ vault_id: B, state: 'enrolling', sealed_release: undefined, lease: undefined, orphan_seen_at: seen + 30 })]);
    members([]);
    await cleanup.handler();
    const [send] = sqs.commandCalls(SendMessageCommand);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(1);
    expect(send.args[0].input.QueueUrl).toBe(QP + 'i1');
    expect(JSON.parse(send.args[0].input.MessageBody!)).toMatchObject({ v: 1, op: 'delete', vault_id: A, user_guid: 'g7' });
    // MEMBER-API 2.11.0: marked as an account deletion (A only: B was never sealed), then asked.
    expect(vaultWrites()).toEqual([
      expect.objectContaining({ Key: { vault_id: A }, UpdateExpression: MARK_ACCOUNT }),
      expect.objectContaining({ Key: { vault_id: A }, UpdateExpression: 'SET deletion_requested_at = :t' }),
    ]);
    expect(vaultDeletes()).toEqual([{ vault_id: B }, { vault_id: 'user#g7' }]);
    expect(audits()).toEqual([expect.objectContaining({ actor: 'system', action: 'vault.orphan_deletion_requested', subject: 'g7', detail: { vault_ids: [A, B], orphan_seen_at: seen } })]);
    expect(emf()).toMatchObject({ OrphanVaultsSeen: 0, OrphanVaultDeletions: 1, OrphanVaultsHeld: 0 });
  });

  test("one of the member's vaults marked long ago, another not yet: the new one is marked and nothing is deleted until every mark is 7 days old", async () => {
    table([vault({ orphan_seen_at: nowS() - 30 * DAY }), vault({ vault_id: B })]);
    members([]);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await cleanup.handler();
    expect(vaultWrites()).toEqual([expect.objectContaining({ Key: { vault_id: B }, ...MARK })]);
    nothingIrreversible();
  });

  test('the member row is back (a restore, a read that was wrong): the mark is removed, nothing else', async () => {
    table([vault({ orphan_seen_at: nowS() - 30 * DAY }), vault({ vault_id: B })]);
    members(['g7']);
    await cleanup.handler();
    expect(vaultWrites()).toEqual([{ TableName: 'vaults', Key: { vault_id: A }, UpdateExpression: 'REMOVE orphan_seen_at', ConditionExpression: 'attribute_exists(orphan_seen_at)' }]);
    nothingIrreversible();
    expect(lines()).toContain('{"vaultOrphans":{"marked":0,"waiting":0,"cleared":1,"requested":0,"operator_held":0,"held":0,"read_errors":0,"failures":0}}');
  });

  test("an operator's hold on one vault keeps all of that member's vaults out: not marked, not deleted, however old the mark", async () => {
    table([vault({ orphan_seen_at: nowS() - 30 * DAY }), vault({ vault_id: B, orphan_hold: true })]);
    members([]);
    await cleanup.handler();
    expect(vaultWrites()).toEqual([]);
    nothingIrreversible();
    expect(emf()).toMatchObject({ OrphanVaultsOperatorHeld: 1, OrphanVaultDeletions: 0, OrphanVaultsHeld: 0 });
  });

  test.each([['the string "true"', 'true'], ['the number 1', 1], ['false (still present)', false], ['null', null]])('a hold written as %s is still a hold (fail safe), with a warning', async (_n, hold) => {
    table([vault({ orphan_seen_at: nowS() - 30 * DAY, orphan_hold: hold })]);
    members([]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await cleanup.handler();
    expect(vaultWrites()).toEqual([]);
    nothingIrreversible();
    expect(emf()).toMatchObject({ OrphanVaultsOperatorHeld: 1, OrphanVaultDeletions: 0 });
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain('orphaned vaults: orphan_hold is not the boolean true; treated as a hold');
  });

  test('the first run after the deploy: vaults already without a member (one with a start-over held for the missing row, as after an old admin Delete) are only marked', async () => {
    const DID = '01JB2Z6V9K3M4N5P6Q7R8S9T0V';
    members(['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9', 'x10', 'x11', 'x12']);
    table([
      vault({ deletion: { deletion_id: DID, state: 'pending', deletes_at: nowS() - 90 * DAY } }),
      vault({ vault_id: B, user_guid: 'g8' }),
      ...Array.from({ length: 12 }, (_, i) => vault({ vault_id: String.fromCharCode(100 + i).repeat(32), user_guid: `x${i + 1}` })),
    ]);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await cleanup.handler();
    expect(vaultWrites().map((i) => [i.Key, i.UpdateExpression])).toEqual([[{ vault_id: A }, MARK.UpdateExpression], [{ vault_id: B }, MARK.UpdateExpression]]);
    nothingIrreversible();
  });

  test("rows the scan's filter should not have returned are checked again and skipped: already asked, deleted, no owner, a pointer row", async () => {
    table([
      vault({ deletion_requested_at: nowS() - 60 }),
      vault({ vault_id: B, state: 'deleted' }),
      vault({ vault_id: 'c'.repeat(32), user_guid: undefined }),
      { vault_id: 'user#g7', current_vault_id: A },
    ]);
    members([]);
    await cleanup.handler();
    expect(ddb.commandCalls(ScanCommand).map((c) => c.args[0].input).find((i) => i.FilterExpression === ORPHAN_SCAN)).toMatchObject({ TableName: 'vaults', ExpressionAttributeNames: { '#s': 'state' }, ExpressionAttributeValues: { ':d': 'deleted' } });
    expect(memberReads()).toEqual([]);
    expect(vaultWrites()).toEqual([]);
    nothingIrreversible();
  });

  test('a member row that cannot be read: nothing written for it; the next owner is still handled; counted for the alarm', async () => {
    const old = nowS() - 8 * DAY;
    members(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], ['g7']);
    table([vault({ orphan_seen_at: old }), vault({ vault_id: B, user_guid: 'g8', orphan_seen_at: old }), ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((g, i) => vault({ vault_id: String(i).repeat(32), user_guid: g }))]);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await cleanup.handler();
    expect(sqs.commandCalls(SendMessageCommand).map((c) => JSON.parse(c.args[0].input.MessageBody!).vault_id)).toEqual([B]);
    expect(audits().map((a) => a!.subject)).toEqual(['g8']);
    expect(emf()).toMatchObject({ OrphanVaultDeletions: 1, OrphanVaultsHeld: 1 });
    expect(err.mock.calls.map((c) => String(c[0]))).toContain('orphaned vaults: a member row could not be read');
  });

  test(`more than ${5} members without a row: none is marked or asked, at every run until that is no longer so; held and alarmed`, async () => {
    expect(cleanup.ORPHAN_LIMIT).toBe(5);
    const present = Array.from({ length: 60 }, (_, i) => `p${i}`);
    const rows = (n: number) => [
      ...Array.from({ length: n }, (_, i) => vault({ vault_id: String(i).repeat(32), user_guid: `g${i}`, orphan_seen_at: nowS() - 30 * DAY })),
      ...present.map((g, i) => vault({ vault_id: `${i}`.padStart(32, 'f'), user_guid: g })),
    ];
    members(present);
    table(rows(6));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 2; i++) {
      ddb.resetHistory(); log.mockClear();
      await cleanup.handler();
      expect(vaultWrites()).toEqual([]);
      nothingIrreversible();
      expect(emf()).toMatchObject({ OrphanVaultsSeen: 0, OrphanVaultDeletions: 0, OrphanVaultsHeld: 6 });
    }
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain('orphaned vaults: held, more members without a row than one run accepts');
    // Five, among 65 owners, are within both limits.
    ddb.resetHistory(); log.mockClear();
    table(rows(5));
    await cleanup.handler();
    expect(audits()).toHaveLength(5);
  });

  test(`more than ${15} % of the owners without a row (a members table restored from an older backup): held, however few`, async () => {
    expect(cleanup.ORPHAN_SHARE).toBe(0.15);
    const old = nowS() - 30 * DAY;
    // 2 of 10 owners (20 %): held.
    members(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    const others = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((g, i) => vault({ vault_id: `${i}`.padStart(32, 'f'), user_guid: g }));
    table([vault({ orphan_seen_at: old }), vault({ vault_id: B, user_guid: 'g8', orphan_seen_at: old }), ...others]);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await cleanup.handler();
    nothingIrreversible();
    expect(emf()).toMatchObject({ OrphanVaultsHeld: 2 });
    // 1 of 9 (at least one is always allowed): handled.
    ddb.resetHistory(); log.mockClear();
    table([vault({ orphan_seen_at: old }), ...others]);
    await cleanup.handler();
    expect(audits()).toHaveLength(1);
    // A single owner, without a row: one is allowed.
    ddb.resetHistory(); log.mockClear();
    table([vault({ orphan_seen_at: old })]);
    await cleanup.handler();
    expect(audits()).toHaveLength(1);
  });

  test('the scan itself fails: the rest of the run goes on, and the failure is counted for the alarm', async () => {
    ddb.on(ScanCommand).callsFake((input) => {
      if (input.FilterExpression === ORPHAN_SCAN) throw Object.assign(new Error('x'), { name: 'InternalServerError' });
      return { Items: [] };
    });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await cleanup.handler();
    expect(r).toMatchObject({ vaultRetries: 0, expired: 0 });
    expect(emf()).toMatchObject({ OrphanVaultDeletions: 0, OrphanVaultsHeld: 1 });
  });

  test('a start-over held for a missing member row is not carried out by the 5-minute run; once the daily scan has asked the vault, that run leaves it to the retry', async () => {
    const DID = '01JB2Z6V9K3M4N5P6Q7R8S9T0V';
    const pending = vault({ deletion: { deletion_id: DID, state: 'pending', deletes_at: nowS() - 5 } });
    members([]);
    ddb.on(ScanCommand).resolves({ Items: [pending] });
    expect((await cleanup.executeStartOvers(nowS())).held).toEqual({ not_active: 0, no_member: 1, read_error: 0 });
    ddb.on(ScanCommand).resolves({ Items: [{ ...pending, deletion_requested_at: nowS() - 60 }] });
    expect((await cleanup.executeStartOvers(nowS())).held).toEqual({ not_active: 0, no_member: 0, read_error: 0 });
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});

describe('task member_vaults (the function the admin API invokes before a Delete)', () => {
  const G = '11111111-2222-4333-8444-555555555555';
  const A = 'a'.repeat(32);
  const B = 'b'.repeat(32);
  const check = (user_guid: unknown = G) => cleanup.memberVaultsHandler({ task: 'member_vaults', user_guid });
  const vaults = (t: { pointer?: string; index: Record<string, unknown>[]; base: Record<string, unknown>[] }) =>
    ddb.on(QueryCommand).callsFake((input) => {
      if (input.TableName !== 'vaults') return { Items: [] };
      if (input.IndexName) return { Items: t.index };
      const id = input.ExpressionAttributeValues?.[':id'];
      if (id === `user#${G}`) return { Items: t.pointer ? [{ vault_id: id, current_vault_id: t.pointer }] : [] };
      return { Items: t.base.filter((r) => r.vault_id === id) };
    });

  test("the member's vaults that are not deleted, each read again from the base table, consistently; the current one found through the pointer even when the index does not list it", async () => {
    vaults({ pointer: A, index: [{ vault_id: B, user_guid: G }], base: [{ vault_id: A, user_guid: G, state: 'locked' }, { vault_id: B, user_guid: G, state: 'deleted' }] });
    expect(await check()).toEqual({ ok: true, task: 'member_vaults', vaults: [{ vault_id: A, state: 'locked', never_sealed: true }] });
    const reads = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input).filter((i) => !i.IndexName);
    expect(reads.every((i) => i.ConsistentRead === true)).toBe(true);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  test("a deletion asked for and not yet reported still counts; a row of another member, and none at all, do not", async () => {
    vaults({ index: [{ vault_id: A, user_guid: G }, { vault_id: B, user_guid: G }], base: [{ vault_id: A, user_guid: G, state: 'locked', deletion_requested_at: 1 }, { vault_id: B, user_guid: 'other' }] });
    expect((await check()).vaults).toEqual([{ vault_id: A, state: 'locked', never_sealed: true }]);
    vaults({ index: [], base: [] });
    expect((await check()).vaults).toEqual([]);
  });

  test('MEMBER-API 2.14.0: never_sealed says whether a row has neither a sealed release nor a lease (the account deletion does not count it; the admin Delete does)', async () => {
    const R = 'c'.repeat(96);
    vaults({
      index: [{ vault_id: A, user_guid: G }, { vault_id: B, user_guid: G }, { vault_id: 'c'.repeat(32), user_guid: G }],
      base: [
        { vault_id: A, user_guid: G, state: 'enrolling' },
        { vault_id: B, user_guid: G, state: 'enrolling', lease: { instance_id: 'i1', lease_expires_at: 1 } },
        { vault_id: 'c'.repeat(32), user_guid: G, state: 'locked', sealed_release: R },
      ],
    });
    expect((await check()).vaults).toEqual([
      { vault_id: A, state: 'enrolling', never_sealed: true },
      { vault_id: B, state: 'enrolling', never_sealed: false },
      { vault_id: 'c'.repeat(32), state: 'locked', never_sealed: false },
    ]);
  });

  test('a failed read fails the task (never "no vault"); anything but an account id, or another task, is refused before any read', async () => {
    ddb.on(QueryCommand).rejects(Object.assign(new Error('x'), { name: 'AccessDeniedException' }));
    await expect(check()).rejects.toThrow();
    ddb.resetHistory();
    await expect(check('email:a@b.c')).rejects.toThrow('not an account id');
    await expect(cleanup.memberVaultsHandler({ task: 'cancel_start_over', user_guid: G })).rejects.toThrow('member_vaults only');
    await expect(cleanup.memberVaultsHandler()).rejects.toThrow('member_vaults only');
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(0);
  });
});

describe('cleanup job: account deletions (MEMBER-API 2.14.0; ACCOUNT-ADMIN-PLAN §5.4.3)', () => {
  const R = 'c'.repeat(96);
  const A = 'a'.repeat(32);
  const B = 'b'.repeat(32);
  const H = 3_600_000;
  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
  const nowS = () => Math.floor(Date.now() / 1000);
  const deletion = (over: Record<string, unknown> = {}) => ({
    deletion_id: 'D1', requested_at: iso(-7 * 24 * H - H), deletes_at: iso(-H), mailing_list: 'remove',
    cancel_hash: 'h', mail_claimed_at: iso(-7 * 24 * H - H), mailed_at: iso(-7 * 24 * H - H), ...over,
  });
  const account = (over: Record<string, unknown> = {}) => ({
    user_guid: 'g1', email: 'gone@x.org', state: 'member', account_status: 'canceled', delete_after: iso(-H), account_deletion: deletion(), ...over,
  });
  const sealed = { vault_id: A, user_guid: 'g1', state: 'locked', sealed_release: R, lease: { instance_id: 'i1', lease_expires_at: nowS() + 60 } };
  const neverSealed = { vault_id: B, user_guid: 'g1', state: 'enrolling' };
  let order: string[];
  let current: Record<string, unknown> | undefined;
  /** The query finds `m`; the consistent read answers `current` (default `m`); the member's vault rows; the mailing list's row. */
  const setup = (m: Record<string, unknown>, vaults: Record<string, unknown>[] = [], list?: Record<string, unknown>) => {
    current = m;
    ddb.on(QueryCommand).callsFake((input) => {
      if (input.TableName === 'vaults') {
        if (input.IndexName === 'user-index') return { Items: vaults.map((v) => ({ vault_id: v.vault_id, user_guid: v.user_guid })) };
        return { Items: vaults.filter((v) => v.vault_id === input.ExpressionAttributeValues?.[':id']) };
      }
      if (input.TableName === 'members' && input.ExpressionAttributeValues?.[':c'] === 'canceled' && input.ExpressionAttributeValues?.[':s'] === 'member') return { Items: [m] };
      return { Items: [] };
    });
    ddb.on(GetCommand, { TableName: 'members' } as any).callsFake(() => (order.push('read'), { Item: current }));
    ddb.on(GetCommand, { TableName: 'list' } as any).resolves(list ? { Item: list } : {});
  };
  const audits = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'audit').map((i) => i.Item!);
  const mails = () => ses.commandCalls(SendEmailCommand).map((c) => ({ to: c.args[0].input.Destination!.ToAddresses![0], subject: c.args[0].input.Content!.Simple!.Subject!.Data }));
  const vaultDeletes = () => ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'vaults');
  const listWrites = () => [
    ...ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'list').map((i) => ({ put: i.Item })),
    ...ddb.commandCalls(DeleteCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'list').map((i) => ({ del: i })),
  ];
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  const heldEmf = () => log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('AccountDeletionsHeld')).map((l) => JSON.parse(l));
  /** Nothing of the account is deleted, and nothing is written to its row or its vaults. */
  const nothingDeleted = () => {
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(idp.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
  };

  // The daily run, as scheduled: 07:00 UTC (plus the seconds it takes to start).
  const RUN = Date.parse('2026-11-10T07:00:30.000Z');
  beforeEach(() => {
    jest.useFakeTimers({ now: RUN, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
    order = [];
    idp.on(AdminEnableUserCommand).callsFake(() => (order.push('enable'), {}));
    ddb.on(DeleteCommand).callsFake((i) => (order.push(`delete:${i.TableName}:${Object.values(i.Key)[0]}`), {}));
    ddb.on(TransactWriteCommand).callsFake(() => (order.push('transaction'), {}));
    ddb.on(PutCommand).callsFake((i) => (i.TableName === 'list' && order.push('list:marker'), {}));
    idp.on(AdminDisableUserCommand).callsFake(() => (order.push('disable'), {}));
    idp.on(AdminUserGlobalSignOutCommand).callsFake(() => (order.push('sign_out'), {}));
    idp.on(AdminDeleteUserCommand).callsFake(() => (order.push('user_delete'), {}));
    ses.on(SendEmailCommand).resolves({});
    ses.on(DeleteEmailIdentityCommand).resolves({});
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('in order: read again, sign-in disabled and sessions ended, the vaults read, the never-sealed row deleted under its condition, row and marker under the guard, then the rest', async () => {
    setup(account(), [neverSealed], { email: 'gone@x.org', unsubToken: 'u1', status: 'confirmed' });
    const r = await cleanup.handler();
    expect(r).toMatchObject({ deleted: 1, failures: 0, incomplete: 0 });
    expect(order).toEqual([
      'read', 'disable', 'sign_out', 'read',
      `delete:vaults:${B}`,
      'transaction',
      'user_delete', 'delete:subs:g1', 'delete:vaults:user#g1', 'delete:list:gone@x.org',
    ]);
    const [nsDelete] = vaultDeletes();
    expect(nsDelete).toEqual({ TableName: 'vaults', Key: { vault_id: B }, ConditionExpression: 'user_guid = :g AND attribute_not_exists(sealed_release) AND attribute_not_exists(lease)', ExpressionAttributeValues: { ':g': 'g1' } });
    expect(ddb.commandCalls(GetCommand).map((c) => c.args[0].input).find((i) => i.TableName === 'members')).toEqual({ TableName: 'members', Key: { user_guid: 'g1' }, ConsistentRead: true });
    const [tx] = ddb.commandCalls(TransactWriteCommand).map((c) => c.args[0].input.TransactItems!);
    expect(tx[0].Delete).toEqual({
      TableName: 'members', Key: { user_guid: 'g1' },
      ConditionExpression: 'account_status = :c AND delete_after < :now AND account_deletion.deletion_id = :id',
      ExpressionAttributeValues: { ':c': 'canceled', ':now': expect.any(String), ':id': 'D1' },
    });
    expect(tx[1].Delete!.Key).toEqual({ user_guid: 'email:gone@x.org' });
    expect(audits()).toEqual([expect.objectContaining({ actor: 'system', action: 'member.delete_after_cancel', subject: 'g1', detail: { deletion_id: 'D1', mailing_list: 'removed', vault_ids: [B], identity: 'kept' } })]); // the mock still shows the list's row
    // Never the vault deletion of the old cancel: no host delete, no account_deleted_at, no deletion_requested_at; no email after the deletion.
    expect(sqs.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(mails()).toEqual([]);
    expect(heldEmf()).toEqual([expect.objectContaining({ AccountDeletionsHeld: 0 })]);
  });

  test('not yet due: sign-in disabled and the sessions ended again (a request whose Cognito steps failed is finished), nothing else', async () => {
    setup(account({ delete_after: iso(3 * 24 * H), account_deletion: deletion({ deletes_at: iso(3 * 24 * H) }) }), [sealed]);
    await cleanup.handler();
    expect(order).toEqual(['read', 'disable', 'sign_out', 'read']);
    expect(idp.commandCalls(AdminDisableUserCommand).map((c) => c.args[0].input)).toEqual([{ UserPoolId: 'pool', Username: 'gone@x.org' }]);
    expect(ddb.commandCalls(QueryCommand).filter((c) => c.args[0].input.TableName === 'vaults')).toHaveLength(0);
    nothingDeleted();
    expect(audits()).toEqual([]);
  });

  test('cancelled after the query (the consistent read finds it active, or gone): not touched at all, not even disabled', async () => {
    setup(account(), []);
    current = { ...account(), account_status: 'active', account_deletion: undefined };
    await cleanup.handler();
    expect(order).toEqual(['read']);
    current = undefined;
    order = [];
    await cleanup.handler();
    expect(order).toEqual(['read']);
    nothingDeleted();
    expect(audits()).toEqual([]);
  });

  test('the race: a cancel (or reinstate) enabled sign-in and wrote active after the job read the row as canceled: the job reads again after its disable and enables sign-in again; nothing deleted', async () => {
    const notDue = account({ delete_after: iso(H), account_deletion: deletion({ deletes_at: iso(H) }) });
    setup(notDue, [neverSealed]);
    let reads = 0;
    ddb.on(GetCommand, { TableName: 'members' } as any).callsFake(() => (order.push('read'), { Item: reads++ === 0 ? notDue : { ...notDue, account_status: 'active', account_deletion: undefined } }));
    const r = await cleanup.handler();
    expect(order).toEqual(['read', 'disable', 'sign_out', 'read', 'enable']);
    expect(idp.commandCalls(AdminEnableUserCommand).map((c) => c.args[0].input)).toEqual([{ UserPoolId: 'pool', Username: 'gone@x.org' }]);
    expect(ddb.commandCalls(GetCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'members').every((i) => i.ConsistentRead === true)).toBe(true);
    expect(r).toMatchObject({ failures: 0 });
  });

  test('the race: still canceled on the second read: sign-in stays disabled', async () => {
    setup(account({ delete_after: iso(H), account_deletion: deletion({ deletes_at: iso(H) }) }));
    await cleanup.handler();
    expect(order).toEqual(['read', 'disable', 'sign_out', 'read']);
    expect(idp.commandCalls(AdminEnableUserCommand)).toHaveLength(0);
  });

  test('a sign-out that fails after the disable: the read again and the enable still run (the race is still covered), and it counts', async () => {
    const notDue = account({ delete_after: iso(H), account_deletion: deletion({ deletes_at: iso(H) }) });
    setup(notDue);
    let reads = 0;
    ddb.on(GetCommand, { TableName: 'members' } as any).callsFake(() => (order.push('read'), { Item: reads++ === 0 ? notDue : { ...notDue, account_status: 'active' } }));
    idp.on(AdminUserGlobalSignOutCommand).callsFake(() => {
      order.push('sign_out');
      throw Object.assign(new Error('x'), { name: 'TooManyRequestsException' });
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await cleanup.handler()).failures).toBe(1);
    expect(order).toEqual(['read', 'disable', 'sign_out', 'read', 'enable']);
    expect(err.mock.calls.map((c) => String(c[0]))).toContain('canceled account: sign-in not disabled');
  });

  test('the enable after the disable fails: its own log line, counted; the run goes on', async () => {
    const notDue = account({ delete_after: iso(H), account_deletion: deletion({ deletes_at: iso(H) }) });
    setup(notDue);
    let reads = 0;
    ddb.on(GetCommand, { TableName: 'members' } as any).callsFake(() => (order.push('read'), { Item: reads++ === 0 ? notDue : { ...notDue, account_status: 'active' } }));
    idp.on(AdminEnableUserCommand).rejects(Object.assign(new Error('gone@x.org'), { name: 'TooManyRequestsException' }));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await cleanup.handler()).failures).toBe(1);
    const lines = err.mock.calls.map((c) => c.join(' '));
    expect(lines).toContainEqual('canceled account: sign-in not enabled again {"user_guid":"g1","error":"TooManyRequestsException"}');
    expect(lines.some((l) => l.startsWith('canceled account: sign-in not disabled'))).toBe(false);
    expect(JSON.stringify(err.mock.calls)).not.toContain('gone@x.org');
  });

  test('due by the scheduled run the confirmation named, not by the clock: deletes_at 07:00:03 and a run that starts at 07:00:05 deletes nothing (the email said the next day); the next day\'s run deletes it', async () => {
    const deletesAt = '2026-11-10T07:00:03.000Z';
    jest.setSystemTime(Date.parse('2026-11-10T07:00:05.000Z'));
    setup(account({ delete_after: deletesAt, account_deletion: deletion({ deletes_at: deletesAt }) }), [neverSealed]);
    await cleanup.handler();
    expect(order).toEqual(['read', 'disable', 'sign_out', 'read']); // not due: only the re-disable
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(audits()).toEqual([]);
    jest.setSystemTime(Date.parse('2026-11-11T07:00:01.000Z'));
    order = [];
    const r = await cleanup.handler();
    expect(r.deleted).toBe(1);
    expect(order).toContain('transaction');
  });

  test('a sign-in user under the address with another id is not disabled; a missing one is nothing to do', async () => {
    setup(account({ delete_after: iso(H), account_deletion: deletion({ deletes_at: iso(H) }) }));
    idp.on(AdminGetUserCommand).resolves({ UserAttributes: [{ Name: 'custom:user_guid', Value: 'someone-else' }] });
    await cleanup.handler();
    expect(order).toEqual(['read']);
    idp.on(AdminGetUserCommand).rejects(Object.assign(new Error('nf'), { name: 'UserNotFoundException' }));
    const r = await cleanup.handler();
    expect(r.failures).toBe(0);
  });

  test('a disable that fails is counted and logged by id; the run goes on (the next run tries again)', async () => {
    setup(account({ delete_after: iso(H), account_deletion: deletion({ deletes_at: iso(H) }) }));
    idp.on(AdminDisableUserCommand).rejects(Object.assign(new Error('gone@x.org'), { name: 'TooManyRequestsException' }));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await cleanup.handler()).failures).toBe(1);
    expect(err.mock.calls.map((c) => c.join(' '))).toContainEqual('canceled account: sign-in not disabled {"user_guid":"g1","error":"TooManyRequestsException"}');
    expect(JSON.stringify(err.mock.calls)).not.toContain('gone@x.org');
  });

  test.each([
    ['a sealed vault', [sealed], 'vault', [A]],
    ['an enrollment under way (a lease, no release)', [{ vault_id: A, user_guid: 'g1', state: 'enrolling', lease: { instance_id: 'i1', lease_expires_at: nowS() + 60 } }], 'enrolling', [A]],
    ['an enrollment whose lease has expired (no proof that no instance will report)', [{ vault_id: A, user_guid: 'g1', state: 'enrolling', lease: { instance_id: 'i1', lease_expires_at: nowS() - 3600 } }], 'enrolling', [A]],
    ['a vault being deleted (asked, not yet reported)', [{ ...sealed, deletion_requested_at: nowS() - 60 }], 'vault', [A]],
  ])('held for %s: nothing deleted, nothing written to the row, audited with the reason, counted, and the member emailed at this first run', async (_n, vaults, reason, ids) => {
    setup(account(), [...vaults, neverSealed]);
    const r = await cleanup.handler();
    expect(r).toMatchObject({ deleted: 0, failures: 0 });
    expect(order).toEqual(['read', 'disable', 'sign_out', 'read']);
    nothingDeleted();
    // vault_ids for reason vault only.
    expect(audits()).toEqual([expect.objectContaining({ actor: 'system', action: 'member.deletion_held', subject: 'g1', detail: reason === 'vault' ? { reason, vault_ids: ids } : { reason } })]);
    expect(heldEmf()).toEqual([expect.objectContaining({ AccountDeletionsHeld: 1, _aws: expect.objectContaining({ CloudWatchMetrics: [expect.objectContaining({ Namespace: 'VettID/MemberApi' })] }) })]);
    expect(mails()).toEqual([{ to: 'gone@x.org', subject: 'Your VettID account was not deleted yet' }]);
    expect(warn.mock.calls.map((c) => c.join(' '))).toContainEqual(`canceled account: deletion held {"user_guid":"g1","reason":"${reason}"}`);
  });

  const marks = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'rl');

  test('once per scheduled run: the hold writes a marker (conditional) before its audit and email; a retried invoke or a second run in the same slot finds it and neither audits nor mails again (still held and counted)', async () => {
    setup(account(), [sealed]);
    await cleanup.handler();
    expect(marks()).toEqual([{
      TableName: 'rl',
      Item: { key: `acctdel-held#g1#${Date.parse('2026-11-10T07:00:00.000Z') / 1000}`, expires_at: Date.parse('2026-11-10T07:00:00.000Z') / 1000 + 2 * 86_400 },
      ConditionExpression: 'attribute_not_exists(#k)',
      ExpressionAttributeNames: { '#k': 'key' },
    }]);
    expect(audits().map((a) => a.action)).toEqual(['member.deletion_held']);
    expect(mails()).toHaveLength(1);
    // The same slot again (an EventBridge retry, 20 minutes later): the marker is there.
    jest.setSystemTime(Date.parse('2026-11-10T07:20:00.000Z'));
    ddb.resetHistory(); ses.resetHistory(); log.mockClear();
    ddb.on(PutCommand, { TableName: 'rl' } as any).rejects(ccf());
    const r = await cleanup.handler();
    expect(r).toMatchObject({ deleted: 0, failures: 0 });
    expect(audits()).toEqual([]);
    expect(mails()).toEqual([]);
    expect(heldEmf()[0].AccountDeletionsHeld).toBe(1);
    nothingDeleted();
  });

  test('a marker that cannot be written: the hold is audited, but no email (a second one could reach the member)', async () => {
    setup(account(), [sealed]);
    ddb.on(PutCommand, { TableName: 'rl' } as any).rejects(Object.assign(new Error('x'), { name: 'InternalServerError' }));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await cleanup.handler();
    expect(audits().map((a) => a.action)).toEqual(['member.deletion_held']);
    expect(mails()).toEqual([]);
    expect(err.mock.calls.map((c) => c.join(' '))).toContainEqual('canceled account: held, run marker not written {"user_guid":"g1","error":"InternalServerError"}');
  });

  test('a retried run after a deletion finds no row: member.delete_after_cancel is written once (the guard lets one transaction through)', async () => {
    setup(account(), []);
    await cleanup.handler();
    expect(audits().map((a) => a.action)).toEqual(['member.delete_after_cancel']);
    ddb.resetHistory();
    current = undefined; // the row went with the transaction
    await cleanup.handler();
    expect(audits()).toEqual([]);
    // Two runs that both read it before either deleted it: the second transaction fails its guard.
    ddb.resetHistory();
    current = account();
    ddb.on(TransactWriteCommand).rejects(Object.assign(new Error('t'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }] }));
    await cleanup.handler();
    expect(audits()).toEqual([]);
  });

  test('the held email goes only at the run scheduled (07:00 UTC) for the first run at or after deletes_at; later runs hold and audit without it', async () => {
    setup(account({ delete_after: iso(-25 * H), account_deletion: deletion({ deletes_at: iso(-25 * H) }) }), [sealed]);
    await cleanup.handler();
    expect(audits().map((a) => a.action)).toEqual(['member.deletion_held']);
    expect(mails()).toEqual([]);
  });

  test('a run that starts late (07:40) is still the scheduled run: the email once; the next day not again, even within 24 hours of deletes_at', async () => {
    const deletesAt = '2026-11-10T07:20:00.000Z'; // due at the run of the 11th; a late run on the 10th (07:40) already sees it due
    jest.setSystemTime(Date.parse('2026-11-10T07:40:00.000Z'));
    setup(account({ delete_after: deletesAt, account_deletion: deletion({ deletes_at: deletesAt }) }), [sealed]);
    await cleanup.handler();
    expect(mails()).toEqual([]); // the 10th's run is not the one scheduled for it
    jest.setSystemTime(Date.parse('2026-11-11T07:00:05.000Z'));
    ses.resetHistory();
    await cleanup.handler();
    expect(mails()).toEqual([{ to: 'gone@x.org', subject: 'Your VettID account was not deleted yet' }]);
    jest.setSystemTime(Date.parse('2026-11-12T07:05:00.000Z'));
    ses.resetHistory();
    await cleanup.handler();
    expect(mails()).toEqual([]);
  });

  test('deletes_at in the seconds after 07:00: two runs within 24 hours of it both hold, and only one mails (the old 24-hour window mailed at both)', async () => {
    const deletesAt = '2026-11-10T07:00:10.000Z';
    for (const [at, n] of [['2026-11-10T07:00:30.000Z', 0], ['2026-11-11T07:00:05.000Z', 1]] as const) {
      jest.setSystemTime(Date.parse(at));
      ses.resetHistory();
      setup(account({ delete_after: deletesAt, account_deletion: deletion({ deletes_at: deletesAt }) }), [sealed]);
      await cleanup.handler();
      expect(mails()).toHaveLength(n);
    }
  });

  test.each([
    ['the confirmation was claimed and never recorded as sent', account({ account_deletion: deletion({ mailed_at: undefined }) })],
    ['the confirmation was never claimed', account({ account_deletion: deletion({ mailed_at: undefined, mail_claimed_at: undefined, cancel_hash: undefined }) })],
    ['a canceled row without a deletion record (before 0.3.0)', account({ account_deletion: undefined })],
  ])('held (reason mail) when %s: nothing deleted, no email', async (_n, m) => {
    setup(m, [neverSealed]);
    await cleanup.handler();
    nothingDeleted();
    expect(audits()).toEqual([expect.objectContaining({ action: 'member.deletion_held', detail: { reason: 'mail' } })]);
    expect(heldEmf()[0].AccountDeletionsHeld).toBe(1);
    expect(mails()).toEqual([]);
  });

  test('the vault check comes before the mail check', async () => {
    setup(account({ account_deletion: deletion({ mailed_at: undefined }) }), [sealed]);
    await cleanup.handler();
    expect(audits()[0].detail).toEqual({ reason: 'vault', vault_ids: [A] });
  });

  test('a vault read that fails: nothing deleted, not taken as "no vault", counted as a failure', async () => {
    setup(account(), []);
    ddb.on(QueryCommand, { TableName: 'vaults' } as any).rejects(Object.assign(new Error('x'), { name: 'AccessDeniedException' }));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await cleanup.handler();
    expect(r).toMatchObject({ deleted: 0, failures: 1 });
    nothingDeleted();
    expect(audits()).toEqual([]);
  });

  test.each([
    ['a lease appeared', { lease: { instance_id: 'i1', lease_expires_at: 1 } }],
    ['a release appeared', { sealed_release: R }],
    ['the row names another member now', { user_guid: 'g2' }],
  ])('a never-sealed row whose condition fails (%s, read again consistently): the rest waits, held (enrolling)', async (_n, change) => {
    const rows: Record<string, unknown>[] = [{ ...neverSealed }];
    setup(account(), rows);
    ddb.on(DeleteCommand, { TableName: 'vaults' } as any).callsFake(() => {
      Object.assign(rows[0], change);
      throw ccf();
    });
    const r = await cleanup.handler();
    expect(r).toMatchObject({ deleted: 0, failures: 0 });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(idp.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    expect(audits()).toEqual([expect.objectContaining({ action: 'member.deletion_held', detail: { reason: 'enrolling' } })]);
    expect(heldEmf()[0].AccountDeletionsHeld).toBe(1);
  });

  test('a never-sealed row already gone when its delete runs (the condition fails on a missing row): done, not a hold; the account goes', async () => {
    const rows: Record<string, unknown>[] = [{ ...neverSealed }];
    setup(account(), rows);
    ddb.on(DeleteCommand, { TableName: 'vaults' } as any).callsFake(() => {
      rows.length = 0;
      throw ccf();
    });
    const r = await cleanup.handler();
    expect(r).toMatchObject({ deleted: 1, failures: 0 });
    expect(audits().map((a) => a.action)).toEqual(['member.delete_after_cancel']);
    expect(heldEmf()[0].AccountDeletionsHeld).toBe(0);
    const reread = ddb.commandCalls(QueryCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'vaults' && i.ExpressionAttributeValues?.[':id'] === B);
    expect(reread.length).toBeGreaterThanOrEqual(2); // the vault check, and the read again after the failed condition
    expect(reread.every((i) => i.ConsistentRead === true)).toBe(true);
  });

  test('a never-sealed delete that fails otherwise: nothing else deleted, counted as a failure, tried again next run', async () => {
    setup(account(), [neverSealed]);
    ddb.on(DeleteCommand, { TableName: 'vaults' } as any).rejects(Object.assign(new Error('x'), { name: 'InternalServerError' }));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await cleanup.handler();
    expect(r).toMatchObject({ deleted: 0, failures: 1 });
    expect(ddb.commandCalls(TransactWriteCommand)).toHaveLength(0);
    expect(audits()).toEqual([]);
  });

  test('the guard fails (cancelled by the link or reinstated after the read, or another deletion): nothing else is touched', async () => {
    setup(account(), []);
    ddb.on(TransactWriteCommand).rejects(Object.assign(new Error('t'), { name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }] }));
    const r = await cleanup.handler();
    expect(r).toMatchObject({ deleted: 0, failures: 0 });
    expect(idp.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    expect(ddb.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(listWrites()).toEqual([]);
    expect(audits()).toEqual([]);
  });

  describe('the mailing-list entry (§5.4.3.1), after the row is gone', () => {
    const entry = (over: Record<string, unknown> = {}) => ({ email: 'gone@x.org', unsubToken: 'u1', status: 'confirmed', ...over });
    const listReads = () => ddb.commandCalls(GetCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'list');

    test('the list created the identity: a release marker first, then the row conditional on the unsubToken just read, then the confirm-link pointer', async () => {
      setup(account(), [], entry({ ownsIdentity: true, status: 'pending', tokenHash: 'th' }));
      ddb.on(DeleteCommand, { TableName: 'list' } as any).callsFake((i) => (order.push(`delete:list:${i.Key.email}`), i.Key.email === 'gone@x.org' ? { Attributes: entry({ ownsIdentity: true, status: 'pending', tokenHash: 'th' }) } : {}));
      await cleanup.handler();
      expect(order.slice(order.indexOf('transaction'))).toEqual(['transaction', 'user_delete', 'delete:subs:g1', 'delete:vaults:user#g1', 'list:marker', 'delete:list:gone@x.org', 'delete:list:#confirm#th']);
      expect(listReads()[0]).toEqual({ TableName: 'list', Key: { email: 'gone@x.org' }, ConsistentRead: true });
      const [marker, row, pointer] = listWrites();
      expect(marker).toEqual({ put: { email: expect.stringMatching(/^#release#[0-9a-f]{32}$/), status: 'release', requestedAt: expect.any(String), target: 'gone@x.org', ownsIdentity: true } });
      expect(row).toEqual({ del: { TableName: 'list', Key: { email: 'gone@x.org' }, ConditionExpression: 'unsubToken = :t', ExpressionAttributeValues: { ':t': 'u1' }, ReturnValues: 'ALL_OLD' } });
      expect(pointer).toEqual({ del: { TableName: 'list', Key: { email: '#confirm#th' } } });
      expect(audits()[0].detail).toMatchObject({ mailing_list: 'removed' });
    });

    test('the identity is not the list\'s: no marker; the row still goes', async () => {
      setup(account(), [], entry());
      await cleanup.handler();
      expect(listWrites()).toEqual([{ del: expect.objectContaining({ Key: { email: 'gone@x.org' }, ConditionExpression: 'unsubToken = :t' }) }]);
      expect(audits()[0].detail).toMatchObject({ mailing_list: 'removed' });
    });

    test('a new sign-up meanwhile (the unsubToken changed): the row stays, kept; its marker finds the row in use', async () => {
      setup(account(), [], entry({ ownsIdentity: true }));
      ddb.on(DeleteCommand, { TableName: 'list' } as any).rejects(ccf());
      const r = await cleanup.handler();
      expect(r).toMatchObject({ deleted: 1, incomplete: 0 });
      expect(listWrites().map((w) => Object.keys(w)[0])).toEqual(['put', 'del']);
      expect(audits()[0].detail).toMatchObject({ mailing_list: 'kept' });
    });

    test('a removal that fails is recorded as incomplete; the SES identity step still runs', async () => {
      setup(account(), [], entry());
      ddb.on(DeleteCommand, { TableName: 'list' } as any).rejects(Object.assign(new Error('x'), { name: 'InternalServerError' }));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const r = await cleanup.handler();
      expect(r).toMatchObject({ deleted: 1, incomplete: 1 });
      expect(audits()[0].detail).toMatchObject({ mailing_list: 'kept', incomplete: ['mailing_list'] });
    });

    test('mailing_list keep: the list is only read; kept (its identity too), or not_listed', async () => {
      setup(account({ account_deletion: deletion({ mailing_list: 'keep' }) }), [], entry({ ownsIdentity: true }));
      await cleanup.handler();
      expect(listWrites()).toEqual([]);
      expect(ses.commandCalls(DeleteEmailIdentityCommand)).toHaveLength(0);
      expect(audits()[0].detail).toMatchObject({ mailing_list: 'kept', identity: 'kept' });
      ddb.resetHistory();
      setup(account({ account_deletion: deletion({ mailing_list: 'keep' }) }), []);
      await cleanup.handler();
      expect(audits()[0].detail).toMatchObject({ mailing_list: 'not_listed', identity: 'deleted' });
    });

    test('remove, but not on the list: not_listed, nothing written to it', async () => {
      setup(account(), []);
      await cleanup.handler();
      expect(listWrites()).toEqual([]);
      expect(audits()[0].detail).toMatchObject({ mailing_list: 'not_listed' });
    });
  });
});

describe('members stream mailer: the account deletion confirmation (ACCOUNT-ADMIN-PLAN §5.4.3)', () => {
  const rec = (img: Record<string, unknown>) => ({ eventName: 'MODIFY', dynamodb: { NewImage: marshall(img, { removeUndefinedValues: true }) } });
  const d = { deletion_id: 'D1', requested_at: '2026-11-03T10:00:00.000Z', deletes_at: '2026-11-10T10:00:00.000Z', mailing_list: 'remove' };
  const row = (over: Record<string, unknown> = {}) => ({ user_guid: '11111111-2222-4333-8444-555555555555', email: 'leaving@x.org', state: 'member', account_status: 'canceled', delete_after: d.deletes_at, account_deletion: d, ...over });
  const run = (img: Record<string, unknown>) => stream.handler({ Records: [rec(img)] } as any, {} as any, () => undefined);
  const updates = () => ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
  const sent = () => ses.commandCalls(SendEmailCommand).map((c) => c.args[0].input);
  let log: jest.SpyInstance;
  let err: jest.SpyInstance;
  beforeEach(() => {
    ddb.on(UpdateCommand).resolves({});
    ddb.on(GetCommand, { TableName: 'list' } as any).resolves({ Item: { email: 'leaving@x.org' } });
    ses.on(SendEmailCommand).resolves({});
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  test('claims first (the hash and the claim in one write, still canceled, this deletion, no claim), sends, then records mailed_at', async () => {
    await run(row());
    const [claim, mailed] = updates();
    expect(claim).toEqual({
      TableName: 'members', Key: { user_guid: row().user_guid },
      UpdateExpression: 'SET account_deletion.cancel_hash = :h, account_deletion.mail_claimed_at = :n',
      ConditionExpression:
        'account_status = :c AND account_deletion.deletion_id = :id AND attribute_not_exists(account_deletion.mail_claimed_at) AND ' +
        '(attribute_not_exists(account_deletion.mail_failures) OR account_deletion.mail_failures < :max)',
      ExpressionAttributeValues: { ':h': expect.stringMatching(/^[0-9a-f]{64}$/), ':n': expect.any(String), ':c': 'canceled', ':id': 'D1', ':max': 3 },
    });
    expect(mailed).toMatchObject({ UpdateExpression: 'SET account_deletion.mailed_at = :n', ConditionExpression: 'account_deletion.deletion_id = :id AND account_deletion.cancel_hash = :h', ExpressionAttributeValues: { ':h': claim.ExpressionAttributeValues![':h'], ':id': 'D1' } });
    const [mail] = sent();
    expect(sent()).toHaveLength(1);
    expect(mail.Destination!.ToAddresses).toEqual(['leaving@x.org']);
    expect(mail.Content!.Simple!.Subject!.Data).toBe('Your VettID account will be deleted');
    const text = mail.Content!.Simple!.Body!.Text!.Data!;
    // The link carries the token whose secret's SHA-256 is the stored hash.
    const token = /#t=([^\s]+)/.exec(text)![1];
    expect(token.startsWith(`${row().user_guid}.`)).toBe(true);
    expect(createHash('sha256').update(token.split('.')[1]).digest('hex')).toBe(claim.ExpressionAttributeValues![':h']);
    expect(text).toBe(
      'Your VettID account is closed, and will be deleted after 11 November 2026, 07:00 UTC. That deletes your membership, your sign-in, ' +
        'your subscription and your email address from VettID, and removes you from the VettID mailing list. To keep your account, use this link until then:\n\n' +
        `https://account.vettid.org/account/delete/cancel/#t=${token}\n\n` +
        "If you didn't ask for this, use the link and write to support@vettid.org.\n",
    );
    expect(ddb.calls().map((c) => c.args[0].constructor.name)).toEqual(['GetCommand', 'UpdateCommand', 'UpdateCommand']);
    // Nothing of the token, the link or the address in a log.
    expect(JSON.stringify([log.mock.calls, err.mock.calls])).not.toContain(token);
  });

  test.each([
    ['keep, on the list', 'keep', true, '; your address stays on the mailing list.'],
    ['remove, not on the list', 'remove', false, 'from VettID. To keep'],
    ['keep, not on the list', 'keep', false, 'from VettID. To keep'],
  ])('the wording follows the mailing list (%s)', async (_n, list, on, phrase) => {
    if (!on) ddb.on(GetCommand, { TableName: 'list' } as any).resolves({});
    await run(row({ account_deletion: { ...d, mailing_list: list } }));
    expect(sent()[0].Content!.Simple!.Body!.Text!.Data).toContain(phrase);
  });

  test('a lost claim (a retry, a second record, cancelled meanwhile): nothing sent', async () => {
    ddb.on(UpdateCommand).rejects(ccf());
    await run(row());
    expect(sent()).toHaveLength(0);
    expect(updates()).toHaveLength(1);
  });

  test('a row already claimed, not canceled, or without a deletion record is not mailed at all', async () => {
    for (const img of [row({ account_deletion: { ...d, mail_claimed_at: 'x' } }), row({ account_status: 'active' }), row({ account_deletion: undefined })]) await run(img);
    expect(sent()).toHaveLength(0);
    expect(updates()).toHaveLength(0);
  });

  test('a failed send: the claim and the hash taken off (only this claim), logged by error name, counted, and the record failed so the stream retries; mailed_at never written', async () => {
    ses.on(SendEmailCommand).rejects(Object.assign(new Error('leaving@x.org'), { name: 'TooManyRequestsException' }));
    await expect(run(row())).rejects.toThrow();
    const [claim, unclaim] = updates();
    expect(updates()).toHaveLength(2);
    expect(unclaim).toEqual({
      TableName: 'members', Key: { user_guid: row().user_guid },
      UpdateExpression:
        'SET account_deletion.mail_failures = if_not_exists(account_deletion.mail_failures, :zero) + :one ' +
        'REMOVE account_deletion.cancel_hash, account_deletion.mail_claimed_at',
      ConditionExpression: 'account_deletion.deletion_id = :id AND account_deletion.cancel_hash = :h',
      ExpressionAttributeValues: { ':id': 'D1', ':h': claim.ExpressionAttributeValues![':h'], ':zero': 0, ':one': 1 },
    });
    expect(err.mock.calls.map((c) => c.join(' '))).toContainEqual(`account deletion mail failed {"user_guid":"${row().user_guid}","error":"TooManyRequestsException"}`);
    const metric = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('AccountDeletionMailFailures')).map((l) => JSON.parse(l));
    expect(metric).toEqual([expect.objectContaining({ AccountDeletionMailFailures: 1, _aws: expect.objectContaining({ CloudWatchMetrics: [expect.objectContaining({ Namespace: 'VettID/MemberApi' })] }) })]);
    expect(JSON.stringify([log.mock.calls, err.mock.calls])).not.toContain('leaving@x.org');
  });

  test('failures are counted on the row: the take-off\'s own record and the stream\'s retries end after 3 sends; the account is then left for the job to hold (mail)', async () => {
    // The live row, as DynamoDB would keep it; every write's new image is fed back as a record.
    const live: any = row();
    const images: any[] = [];
    ddb.on(UpdateCommand).callsFake((i) => {
      const d = live.account_deletion;
      if (String(i.UpdateExpression).startsWith('SET account_deletion.cancel_hash')) {
        if (d.mail_claimed_at || (d.mail_failures ?? 0) >= i.ExpressionAttributeValues[':max']) throw ccf();
        live.account_deletion = { ...d, cancel_hash: i.ExpressionAttributeValues[':h'], mail_claimed_at: 'x' };
      } else if (String(i.UpdateExpression).includes('mail_failures')) {
        const { cancel_hash: _h, mail_claimed_at: _c, ...rest } = d;
        live.account_deletion = { ...rest, mail_failures: (d.mail_failures ?? 0) + 1 };
      }
      images.push(JSON.parse(JSON.stringify(live)));
      return {};
    });
    ses.on(SendEmailCommand).rejects(Object.assign(new Error('x'), { name: 'MessageRejected' }));
    // The first record, retried by the stream 3 times, and every image the writes made.
    const queue: any[] = [row(), row(), row(), row()];
    let handled = 0;
    while (queue.length && handled < 50) {
      handled++;
      const before = images.length;
      await run(queue.shift()).catch(() => undefined);
      queue.push(...images.slice(before));
    }
    expect(handled).toBeLessThan(50);
    expect(sent()).toHaveLength(3);
    expect(live.account_deletion).toEqual({ ...d, mail_failures: 3 });
    // A record of the row now sends nothing and writes nothing.
    ddb.resetHistory(); ses.resetHistory();
    await run(live);
    expect(updates()).toHaveLength(0);
    expect(sent()).toHaveLength(0);
  });

  test('SES accepted but mailed_at could not be written: logged, not thrown; the claim stays, so no record sends again (and the job holds the account, reason mail)', async () => {
    ddb.on(UpdateCommand).callsFake((i) => {
      if (String(i.UpdateExpression).startsWith('SET account_deletion.mailed_at')) throw Object.assign(new Error('x'), { name: 'InternalServerError' });
      return {};
    });
    await expect(run(row())).resolves.toBeUndefined();
    expect(sent()).toHaveLength(1);
    expect(err.mock.calls.map((c) => c.join(' '))).toContainEqual(`account deletion mail not recorded {"user_guid":"${row().user_guid}","error":"InternalServerError"}`);
    // The claim's image (and any later one) without mailed_at: nothing sends.
    ses.resetHistory(); ddb.resetHistory();
    await run(row({ account_deletion: { ...d, cancel_hash: 'h', mail_claimed_at: 'x' } }));
    expect(sent()).toHaveLength(0);
    expect(updates()).toHaveLength(0);
  });

  test('a list read that fails fails the record before anything is claimed', async () => {
    ddb.on(GetCommand, { TableName: 'list' } as any).rejects(Object.assign(new Error('x'), { name: 'InternalServerError' }));
    await expect(run(row())).rejects.toThrow();
    expect(updates()).toHaveLength(0);
    expect(sent()).toHaveLength(0);
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
      expect(rowDel).toMatchObject({ Key: { vault_id: VID }, ConditionExpression: '#s = :deleted AND attribute_not_exists(att_sweep_pending)', ExpressionAttributeValues: { ':deleted': 'deleted' } });
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

    describe('2.11.0: the record kept after the row is removed (vdeleted#<vault_id>, 90 days)', () => {
      const KEY = { key: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE' + 'A'.repeat(88), kid: '0123456789abcdef0123456789abcdef' };
      const NEXT = { key: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE' + 'B'.repeat(88), kid: 'fedcba9876543210fedcba9876543210' };
      const tombstones = () => ddb.commandCalls(PutCommand).map((c) => c.args[0].input).filter((i) => i.TableName === 'requests');

      test('put before the row is deleted: the public keys, deleted_at, cause and expires_at = now + 90 days, nothing else', async () => {
        ddb.on(DeleteCommand).resolves({});
        const before = Math.floor(Date.now() / 1000);
        expect(await alarms.processRecord(rec(del({ app_key: { ...KEY, seq: 1 }, app_key_next: { ...NEXT, seq: 2 } })))).toBe('mailed');
        const [t] = tombstones();
        expect(tombstones()).toHaveLength(1);
        // Not the member's user_guid: nothing needs it.
        expect(Object.keys(t.Item!).sort()).toEqual(['cause', 'deleted_at', 'expires_at', 'keys', 'request_id', 'vault_id']);
        expect(t.Item).toMatchObject({ request_id: `vdeleted#${VID}`, vault_id: VID, keys: [KEY, NEXT], deleted_at: 1_790_000_000, cause: 'vault' });
        expect(t.Item!.expires_at - before).toBeGreaterThanOrEqual(90 * 86_400);
        expect(t.Item!.expires_at - before).toBeLessThanOrEqual(90 * 86_400 + 5);
        expect(t.ConditionExpression).toBeUndefined();
        const calls = ddb.calls().map((c) => c.args[0]);
        const putAt = calls.findIndex((c) => c instanceof PutCommand && c.input.TableName === 'requests');
        const delAt = calls.findIndex((c) => c instanceof DeleteCommand && (c.input as any).Key.vault_id === VID);
        expect(putAt).toBeGreaterThanOrEqual(0);
        expect(putAt).toBeLessThan(delAt);
      });

      test('the cause: account (account_deleted_at, or an older ask without a start-over), start_over, vault', async () => {
        ddb.on(DeleteCommand).resolves({});
        await alarms.processRecord(rec(del({ app_key: KEY, account_deleted_at: 1_789_000_000 })));
        await alarms.processRecord(rec(del({ app_key: KEY, deletion_requested_at: 1_789_000_000 })));
        await alarms.processRecord(rec(del({ app_key: KEY, deletion_requested_at: 1_789_000_000, deletion: { deletion_id: 'x', state: 'executing' } })));
        await alarms.processRecord(rec(del({ app_key: KEY, user_guid: undefined, alarm: { kind: 'vault_deleted', alarm_id: AID, at: 'n/a' } })));
        expect(tombstones().map((t) => t.Item!.cause)).toEqual(['account', 'account', 'start_over', 'vault']);
        expect(tombstones()[3].Item!.deleted_at).toBeNull();
        // A stale app_key_next (not ahead of app_key) is not the vault's key.
        ddb.resetHistory();
        await alarms.processRecord(rec(del({ app_key: { ...KEY, seq: 3 }, app_key_next: { ...NEXT, seq: 3 } })));
        expect(tombstones()[0].Item!.keys).toEqual([KEY]);
      });

      test('the follow-up writes it too, before its delete', async () => {
        ddb.on(DeleteCommand).resolves({});
        const swept = { vault_id: VID, user_guid: 'g1', state: 'deleted', app_key: KEY, alarm: { kind: 'vault_deleted', alarm_id: AID, at: 1_790_000_000, handled_at: 1_790_000_100 } };
        expect(await alarms.processRecord(rec(swept))).toBe('removed');
        expect(tombstones()).toHaveLength(1);
        expect(tombstones()[0].Item).toMatchObject({ keys: [KEY], deleted_at: 1_790_000_000 });
      });

      test('in the follow-up, a record that cannot be written keeps the row and throws, so the stream retries the record', async () => {
        ddb.on(DeleteCommand).resolves({});
        ddb.on(PutCommand, { TableName: 'requests' } as any).rejects(Object.assign(new Error('x'), { name: 'ProvisionedThroughputExceededException' }));
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const swept = { vault_id: VID, user_guid: 'g1', state: 'deleted', app_key: KEY, alarm: { kind: 'vault_deleted', alarm_id: AID, at: 1_790_000_000, handled_at: 1_790_000_100 } };
        await expect(alarms.handler({ Records: [rec(swept)] } as any, {} as any, () => undefined)).rejects.toThrow('x');
        expect(deletes()).toHaveLength(0);
        expect(err.mock.calls).toEqual([['vault tombstone not written', JSON.stringify({ vault_id: VID, error: 'ProvisionedThroughputExceededException' })]]);
        err.mockRestore();
      });

      test('a record that cannot be written keeps the row (still deleted), stamped handled for the follow-up, and logs vault_id only', async () => {
        ddb.on(DeleteCommand).resolves({});
        ddb.on(PutCommand, { TableName: 'requests' } as any).rejects(Object.assign(new Error('x'), { name: 'ProvisionedThroughputExceededException' }));
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(await alarms.processRecord(rec(del({ app_key: KEY })))).toBe('mailed');
        expect(deletes().map((d) => d.Key!.vault_id)).toEqual(['user#g1']);
        expect(updates().filter((u) => u.UpdateExpression === 'SET alarm.handled_at = :now')).toHaveLength(1);
        expect(err.mock.calls).toEqual([['vault tombstone not written', JSON.stringify({ vault_id: VID, error: 'ProvisionedThroughputExceededException' })]]);
        err.mockRestore();
      });
    });

    describe('2.7.1: the row is kept while the attachment sweep is pending (VAULT-HOST-PROTOCOL P15)', () => {
      const swept = (extra: Record<string, unknown> = {}) =>
        ({ vault_id: VID, user_guid: 'g1', state: 'deleted', alarm: { kind: 'vault_deleted', alarm_id: AID, at: 1_790_000_000, handled_at: 1_790_000_100 }, ...extra });

      test('sweep pending: mailed, pointer removed, the row kept and stamped handled (only the alarm map is written)', async () => {
        ddb.on(DeleteCommand, { Key: { vault_id: VID } } as any).rejects(ccf()); // att_sweep_pending is set
        ddb.on(DeleteCommand, { Key: { vault_id: 'user#g1' } } as any).resolves({});
        expect(await alarms.processRecord(rec(del({ att_sweep_pending: true })))).toBe('mailed');
        expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1);
        // 2.11.0: the image shows the sweep pending, so the row's delete (and its record) wait for the follow-up.
        expect(deletes().map((d) => d.Key!.vault_id)).toEqual(['user#g1']);
        const stamp = updates().find((u) => u.UpdateExpression === 'SET alarm.handled_at = :now')!;
        expect(stamp).toMatchObject({ Key: { vault_id: VID }, ConditionExpression: 'alarm.alarm_id = :id', ExpressionAttributeValues: { ':id': AID } });
        expect(typeof stamp.ExpressionAttributeValues![':now']).toBe('number');
        expect(JSON.stringify(stamp)).not.toContain('state');
      });

      test('sweep pending and no member: audited, the row kept and stamped as well', async () => {
        ddb.on(DeleteCommand, { Key: { vault_id: VID } } as any).rejects(ccf());
        ddb.on(DeleteCommand, { Key: { vault_id: 'user#g1' } } as any).resolves({});
        ddb.on(GetCommand, { TableName: 'members' } as any).resolves({});
        expect(await alarms.processRecord(rec(del({ att_sweep_pending: true })))).toBe('not_mailed');
        expect(updates().filter((u) => u.UpdateExpression === 'SET alarm.handled_at = :now')).toHaveLength(1);
      });

      test('a row removed at once (no sweep pending, as before release A) is not stamped', async () => {
        ddb.on(DeleteCommand).resolves({});
        expect(await alarms.processRecord(rec(del()))).toBe('mailed');
        expect(updates().filter((u) => u.UpdateExpression === 'SET alarm.handled_at = :now')).toHaveLength(0);
      });

      test('the follow-up (sweep done, notice handled): the row goes under the same condition; nothing is mailed or claimed', async () => {
        ddb.on(DeleteCommand).resolves({});
        expect(await alarms.processRecord(rec(swept()))).toBe('removed');
        expect(deletes()).toEqual([expect.objectContaining({ Key: { vault_id: VID }, ConditionExpression: '#s = :deleted AND attribute_not_exists(att_sweep_pending)' })]);
        expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
        expect(updates()).toHaveLength(0);
        expect(audits()).toHaveLength(0);
      });

      test('the follow-up does nothing while the sweep is pending, before the notice was handled, or for another state or kind', async () => {
        ddb.on(DeleteCommand).resolves({});
        const r = await Promise.all([
          alarms.processRecord(rec(swept({ att_sweep_pending: true }))),
          alarms.processRecord(rec(swept({ alarm: { kind: 'vault_deleted', alarm_id: AID, at: 1 } }))), // the claim's own record
          alarms.processRecord(rec(swept({ state: 'locked' }))),
          alarms.processRecord(rec(swept({ alarm: { kind: 'credential_clone', alarm_id: AID, at: 1, handled_at: 2 } }))),
          alarms.processRecord(rec(swept({ vault_id: 'user#g1' }))),
        ]);
        expect(r).toEqual(['ignored', 'ignored', 'ignored', 'ignored', 'ignored']);
        expect(deletes()).toHaveLength(0);
      });

      test('the follow-up losing its condition (the sweep pending again, the row gone) is not an error', async () => {
        ddb.on(DeleteCommand).rejects(ccf());
        expect(await alarms.processRecord(rec(swept()))).toBe('ignored');
      });
    });
  });
});

describe('vault service watch (MEMBER-API "Vault service pause")', () => {
  const metricLine = (log: jest.SpyInstance) => JSON.parse(log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('_aws'))!);

  test('on: VaultServicePaused 0 (EMF, namespace VettID/MemberApi, no dimensions)', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await serviceWatch.handler()).toEqual({ paused: false });
    const m = metricLine(log);
    expect(m._aws.CloudWatchMetrics).toEqual([{ Namespace: 'VettID/MemberApi', Dimensions: [[]], Metrics: [{ Name: 'VaultServicePaused', Unit: 'Count' }] }]);
    expect(m.VaultServicePaused).toBe(0);
    log.mockRestore();
  });

  test('paused: 1, and a log line without the reason', async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: PAUSED } });
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await serviceWatch.handler()).toEqual({ paused: true });
    expect(metricLine(log).VaultServicePaused).toBe(1);
    expect(JSON.stringify(warn.mock.calls)).toContain('vault service paused');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('incident');
    log.mockRestore();
    warn.mockRestore();
  });

  test('an unreadable switch fails the run (no metric is guessed)', async () => {
    ssm.on(GetParameterCommand).rejects(Object.assign(new Error('x'), { name: 'AccessDeniedException' }));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(serviceWatch.handler()).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
