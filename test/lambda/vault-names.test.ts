import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';

Object.assign(process.env, {
  TABLE_MEMBERS: 'members', TABLE_AUDIT: 'audit', TABLE_VAULTS: 'vaults', TABLE_SUBSCRIPTIONS: 'subs', TABLE_TERMS: 'terms',
  SENDER_EMAIL: 'no-reply@vettid.org', ACCOUNT_HOST: 'account.vettid.org', ACCOUNT_PUSH_FN: 'vettid-org-member-account-push',
});
/* eslint-disable @typescript-eslint/no-require-imports */
const names = require('../../lambda/jobs/vault-names');
/* eslint-enable */

const ddb = mockClient(DynamoDBDocumentClient);
const ses = mockClient(SESv2Client);
const lambda = mockClient(LambdaClient);

const VID = 'a'.repeat(32);
const VID2 = 'b'.repeat(32);
const NOW_MS = Date.parse('2026-10-07T12:00:00.000Z');
const DAY = 86_400_000;
const ccf = () => Object.assign(new Error('ccf'), { name: 'ConditionalCheckFailedException' });

// ---- a tiny in-memory DynamoDB with the job's conditions --------------------------------

let vaults: Map<string, any>;
let members: Map<string, any>;
let audits: any[];
/** Runs before a member-row update is evaluated (a concurrent writer). */
let beforeMemberUpdate: (() => void) | null;

function install() {
  ddb.on(GetCommand).callsFake((i) => {
    const t = i.TableName === 'vaults' ? vaults : i.TableName === 'members' ? members : new Map();
    const k = i.TableName === 'vaults' ? i.Key.vault_id : i.Key.user_guid;
    return { Item: structuredClone(t.get(k)) };
  });
  ddb.on(PutCommand).callsFake((i) => {
    if (i.TableName === 'audit') audits.push(i.Item);
    return {};
  });
  ddb.on(UpdateCommand).callsFake((i) => {
    const v = i.ExpressionAttributeValues ?? {};
    if (i.TableName === 'members') {
      beforeMemberUpdate?.();
      beforeMemberUpdate = null;
      const m = members.get(i.Key.user_guid);
      if (!m) throw ccf();
      if (i.ConditionExpression.includes('attribute_not_exists(name_changed_at)') ? m.name_changed_at !== undefined : m.name_changed_at !== v[':prev']) throw ccf();
      Object.assign(m, { first_name: v[':f'], last_name: v[':l'], name_changed_at: v[':now'], name_change_applied: v[':a'], updated_at: v[':now'] });
      return {};
    }
    const row = vaults.get(i.Key.vault_id);
    switch (i.UpdateExpression) {
      case 'REMOVE name_change_pending':
        if (row?.name_change_pending !== true || row.name_change?.seq !== v[':seq']) throw ccf();
        delete row.name_change_pending;
        return {};
      case 'SET name_change_pending = :t':
        if (!row || row.name_change?.seq !== v[':seq'] || (row.name_change_result && !(row.name_change_result.seq < v[':seq']))) throw ccf();
        row.name_change_pending = true;
        return {};
      case 'SET name_change_result = :r':
        if (!row || (row.name_change_result && !(row.name_change_result.seq <= v[':seq']))) throw ccf();
        row.name_change_result = structuredClone(v[':r']);
        return {};
    }
    throw new Error(`unexpected update ${i.UpdateExpression}`);
  });
}

const vaultRow = (extra: Record<string, unknown> = {}, nc: Record<string, unknown> = {}) => ({
  vault_id: VID, user_guid: 'g1', state: 'unlocked',
  name_change: { seq: 1, first_name: 'Grace', last_name: 'Hopper', at: NOW_MS / 1000, ...nc },
  name_change_pending: true, ...extra,
});
const store = (row: any) => vaults.set(row.vault_id, structuredClone(row));
/** The stream record for the stored row (its new image). */
const rec = (vaultId = VID, eventName = 'MODIFY') => ({ eventName, dynamodb: { NewImage: marshall(vaults.get(vaultId), { removeUndefinedValues: true }) } });
const mails = () => ses.commandCalls(SendEmailCommand).map((c) => c.args[0].input);
const pushes = () => lambda.commandCalls(InvokeCommand).map((c) => JSON.parse(Buffer.from(c.args[0].input.Payload as Uint8Array).toString()));

beforeEach(() => {
  ddb.reset(); ses.reset(); lambda.reset();
  vaults = new Map();
  members = new Map();
  audits = [];
  beforeMemberUpdate = null;
  install();
  ses.on(SendEmailCommand).resolves({});
  lambda.on(InvokeCommand).resolves({});
  jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  members.set('g1', { user_guid: 'g1', email: 'm@x.org', first_name: 'Ada', last_name: 'Lovelace', state: 'member', account_status: 'active' });
  vaults.set('user#g1', { vault_id: 'user#g1', current_vault_id: VID });
  store(vaultRow());
});
afterEach(() => jest.restoreAllMocks());

describe('normalizeName (the registration rule, U+0020 trim only)', () => {
  test.each([
    ['Grace', 'Grace'],
    ['  Grace ', 'Grace'],
    ["O’Brien-Smith Jr.", "O’Brien-Smith Jr."],
    ['Zoë', 'Zoë'],
    ['李', '李'],
    ['x'.repeat(40), 'x'.repeat(40)],
  ])('%j → %j', (input, out) => expect(names.normalizeName(input)).toBe(out));
  test.each([['x'.repeat(41)], [''], ['   '], ['\tGrace'], ['Grace '], ['-Grace'], ['Gr4ce'], ['a@b'], [7], [null]])('%j is invalid', (input) =>
    expect(names.normalizeName(input)).toBeNull());
  // 2.3.1: the pattern admits no control character (C0, DEL, C1, U+2028, U+2029), anywhere.
  test('refuses every C0, DEL, C1, U+2028 and U+2029 character, inside or at either end', () => {
    const controls = [...Array.from({ length: 0x20 }, (_, i) => i), ...Array.from({ length: 0x21 }, (_, i) => 0x7f + i), 0x2028, 0x2029].map((cp) => String.fromCharCode(cp));
    expect(controls).toHaveLength(32 + 1 + 32 + 2);
    for (const c of controls) {
      for (const bad of [`Gr${c}ace`, `Grace${c}`, `${c}Grace`, `Grace ${c}`]) expect(names.normalizeName(bad)).toBeNull();
    }
  });
  test('40 UTF-16 code units, not code points', () => {
    expect(names.normalizeName('𝒜'.repeat(20))).toBe('𝒜'.repeat(20)); // a letter outside the BMP: 2 units each
    expect(names.normalizeName('𝒜'.repeat(21))).toBeNull();
    expect(names.normalizeName('é'.repeat(40))).toBe('é'.repeat(40));
  });
});

describe('vault-names job (MEMBER-API 2.2.0)', () => {
  test('applies: claim, member row, audit, email, result, push', async () => {
    expect(await names.processRecord(rec())).toBe('applied');
    const calls = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input);
    expect(calls[0]).toMatchObject({ TableName: 'vaults', Key: { vault_id: VID }, UpdateExpression: 'REMOVE name_change_pending', ConditionExpression: 'name_change_pending = :t AND name_change.seq = :seq', ExpressionAttributeValues: { ':t': true, ':seq': 1 } });
    expect(members.get('g1')).toMatchObject({
      first_name: 'Grace', last_name: 'Hopper', name_changed_at: new Date(NOW_MS).toISOString(),
      name_change_applied: { vault_id: VID, seq: 1, first_name: 'Ada', last_name: 'Lovelace' },
    });
    const memberUpdate = calls.find((c) => c.TableName === 'members')!;
    expect(memberUpdate.ConditionExpression).toBe('attribute_exists(user_guid) AND attribute_not_exists(name_changed_at)');
    expect(vaults.get(VID).name_change_result).toEqual({ seq: 1, status: 'applied' });
    expect(vaults.get(VID).name_change_pending).toBeUndefined();
    expect(audits).toEqual([expect.objectContaining({
      actor: 'system', action: 'member.name_change', subject: 'g1',
      detail: { vault_id: VID, seq: 1, from: { first_name: 'Ada', last_name: 'Lovelace' }, to: { first_name: 'Grace', last_name: 'Hopper' } },
    })]);
    const [mail] = mails();
    expect(mail.Destination!.ToAddresses).toEqual(['m@x.org']);
    const text = mail.Content!.Simple!.Body!.Text!.Data!;
    expect(text).toContain('changed from Ada Lovelace to Grace Hopper in your VettID app');
    expect(text).toContain('contact support@vettid.org');
    expect(text).not.toContain(VID);
    expect(pushes()).toEqual([{ user_guid: 'g1' }]);
    expect(lambda.commandCalls(InvokeCommand)[0].args[0].input).toMatchObject({ FunctionName: 'vettid-org-member-account-push', InvocationType: 'Event' });
  });

  test('trims U+0020 before storing the names', async () => {
    store(vaultRow({}, { first_name: '  Grace', last_name: 'Hopper ' }));
    expect(await names.processRecord(rec())).toBe('applied');
    expect(members.get('g1')).toMatchObject({ first_name: 'Grace', last_name: 'Hopper' });
  });

  test.each([
    ['a digit', { first_name: 'Gr4ce' }],
    ['too long', { last_name: 'x'.repeat(41) }],
    ['empty', { first_name: '' }],
    ['not a string', { last_name: 7 }],
    ['both equal the current names', { first_name: 'Ada', last_name: 'Lovelace' }],
  ])('refuses invalid (%s): no member write, no email; audited, result, push', async (_n, nc) => {
    store(vaultRow({}, nc));
    expect(await names.processRecord(rec())).toBe('refused');
    expect(members.get('g1')).toMatchObject({ first_name: 'Ada', last_name: 'Lovelace' });
    expect(members.get('g1').name_changed_at).toBeUndefined();
    expect(vaults.get(VID).name_change_result).toEqual({ seq: 1, status: 'refused', reason: 'invalid' });
    expect(audits).toEqual([expect.objectContaining({ action: 'member.name_change_refused', subject: 'g1', detail: { vault_id: VID, seq: 1, reason: 'invalid' } })]);
    expect(mails()).toHaveLength(0);
    expect(pushes()).toEqual([{ user_guid: 'g1' }]);
  });

  test('changing one name only is a change', async () => {
    store(vaultRow({}, { first_name: 'Ada', last_name: 'King' }));
    expect(await names.processRecord(rec())).toBe('applied');
    expect(members.get('g1')).toMatchObject({ first_name: 'Ada', last_name: 'King' });
  });

  test('too_soon: one applied change per 30 days; registration names and refusals do not count', async () => {
    const at = new Date(NOW_MS - 29 * DAY).toISOString();
    members.set('g1', { ...members.get('g1'), name_changed_at: at });
    expect(await names.processRecord(rec())).toBe('refused');
    expect(vaults.get(VID).name_change_result).toEqual({ seq: 1, status: 'refused', reason: 'too_soon' });
    expect(members.get('g1').first_name).toBe('Ada');
    // 30 days after the last applied change, the next one passes (a new request, seq 2).
    members.set('g1', { ...members.get('g1'), name_changed_at: new Date(NOW_MS - 30 * DAY).toISOString() });
    store(vaultRow({ name_change_result: { seq: 1, status: 'refused', reason: 'too_soon' } }, { seq: 2 }));
    expect(await names.processRecord(rec())).toBe('applied');
    const memberUpdate = ddb.commandCalls(UpdateCommand).map((c) => c.args[0].input).find((c) => c.TableName === 'members')!;
    expect(memberUpdate.ConditionExpression).toBe('attribute_exists(user_guid) AND name_changed_at = :prev');
    expect(vaults.get(VID).name_change_result).toEqual({ seq: 2, status: 'applied' });
  });

  test('a racing change that lands first makes this one too_soon (the member-row condition)', async () => {
    beforeMemberUpdate = () => Object.assign(members.get('g1'), { first_name: 'Other', name_changed_at: new Date(NOW_MS - 1000).toISOString(), name_change_applied: { vault_id: VID2, seq: 9, first_name: 'Ada', last_name: 'Lovelace' } });
    expect(await names.processRecord(rec())).toBe('refused');
    expect(vaults.get(VID).name_change_result).toEqual({ seq: 1, status: 'refused', reason: 'too_soon' });
    expect(members.get('g1').first_name).toBe('Other');
    expect(mails()).toHaveLength(0);
    expect(audits.map((a) => a.action)).toEqual(['member.name_change_refused']);
  });

  test.each([
    ['suspended', { account_status: 'suspended' }],
    ['canceled', { account_status: 'canceled' }],
    ['not registered or member', { state: 'rejected' }],
  ])('refuses account (%s)', async (_n, extra) => {
    members.set('g1', { ...members.get('g1'), ...extra });
    expect(await names.processRecord(rec())).toBe('refused');
    expect(vaults.get(VID).name_change_result).toEqual({ seq: 1, status: 'refused', reason: 'account' });
    expect(members.get('g1').first_name).toBe('Ada');
  });

  test('refuses account when the vault is not the member\'s current vault, or the member is gone', async () => {
    vaults.set('user#g1', { vault_id: 'user#g1', current_vault_id: VID2 });
    expect(await names.processRecord(rec())).toBe('refused');
    expect(vaults.get(VID).name_change_result).toMatchObject({ reason: 'account' });
    members.delete('g1');
    vaults.set('user#g1', { vault_id: 'user#g1', current_vault_id: VID });
    store(vaultRow({}, { seq: 2 }));
    expect(await names.processRecord(rec())).toBe('refused');
    expect(vaults.get(VID).name_change_result).toEqual({ seq: 2, status: 'refused', reason: 'account' });
  });

  test('records without a pending request are ignored', async () => {
    store(vaultRow({ name_change_pending: undefined }));
    const r = [await names.processRecord(rec())];
    store(vaultRow({}, { seq: 0 }));
    r.push(await names.processRecord(rec()));
    store(vaultRow({}, { seq: 'x' }));
    r.push(await names.processRecord(rec()));
    store(vaultRow());
    r.push(await names.processRecord(rec(VID, 'REMOVE')));
    vaults.set('user#g1', { vault_id: 'user#g1', current_vault_id: VID, name_change_pending: true, name_change: { seq: 1 } });
    r.push(await names.processRecord(rec('user#g1')));
    expect(r).toEqual(['ignored', 'ignored', 'ignored', 'ignored', 'ignored']);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  test('a lost claim (already claimed, or a newer request replaced it) does nothing', async () => {
    const old = rec();
    store(vaultRow({}, { seq: 2 })); // the host wrote a newer request
    expect(await names.processRecord(old)).toBe('claimed_elsewhere');
    const newer = rec();
    expect(await names.processRecord(newer)).toBe('applied');
    expect(await names.processRecord(newer)).toBe('claimed_elsewhere'); // the same record again
    expect(audits).toHaveLength(1);
    expect(mails()).toHaveLength(1);
  });

  test('a stored result for a later request is not overwritten', async () => {
    store(vaultRow({ name_change_result: { seq: 5, status: 'applied' } }, { seq: 4, first_name: 'Ada', last_name: 'Lovelace' }));
    expect(await names.processRecord(rec())).toBe('superseded');
    expect(vaults.get(VID).name_change_result).toEqual({ seq: 5, status: 'applied' });
    expect(pushes()).toHaveLength(0);
  });

  test('a failure before the result puts name_change_pending back and rethrows; the retry keeps the applied change', async () => {
    let failResult = true;
    ddb.on(UpdateCommand, { UpdateExpression: 'SET name_change_result = :r' } as any).callsFake((i) => {
      if (failResult) {
        failResult = false;
        throw Object.assign(new Error('boom'), { name: 'ProvisionedThroughputExceededException' });
      }
      vaults.get(i.Key.vault_id).name_change_result = structuredClone(i.ExpressionAttributeValues[':r']);
      return {};
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(names.handler({ Records: [rec()] } as any, {} as any, () => undefined)).rejects.toThrow('boom');
    expect(vaults.get(VID).name_change_pending).toBe(true);
    expect(members.get('g1').first_name).toBe('Grace');
    expect(pushes()).toHaveLength(0);
    // The stream retries: the job recognizes its own change instead of calling it "invalid".
    expect(await names.processRecord(rec())).toBe('applied');
    expect(vaults.get(VID).name_change_result).toEqual({ seq: 1, status: 'applied' });
    expect(audits.at(-1)).toMatchObject({ action: 'member.name_change', detail: { from: { first_name: 'Ada', last_name: 'Lovelace' }, to: { first_name: 'Grace', last_name: 'Hopper' } } });
    expect(mails().at(-1)!.Content!.Simple!.Body!.Text!.Data).toContain('from Ada Lovelace to Grace Hopper');
    expect(pushes()).toEqual([{ user_guid: 'g1' }]);
    err.mockRestore();
  });

  test('a transient email failure is retried with the claim; a permanent rejection (SES sandbox) is not', async () => {
    ses.on(SendEmailCommand).rejectsOnce(Object.assign(new Error('x'), { name: 'Throttling' }));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(names.processRecord(rec())).rejects.toThrow('x');
    expect(vaults.get(VID).name_change_pending).toBe(true);
    expect(vaults.get(VID).name_change_result).toBeUndefined();
    expect(JSON.stringify(err.mock.calls)).not.toContain('m@x.org');
    ses.on(SendEmailCommand).rejects(Object.assign(new Error('x'), { name: 'MessageRejected' }));
    expect(await names.processRecord(rec())).toBe('applied');
    expect(vaults.get(VID).name_change_result).toEqual({ seq: 1, status: 'applied' });
    err.mockRestore();
  });

  test('a failed push never fails the job (the next unlock carries the snapshot)', async () => {
    lambda.on(InvokeCommand).rejects(new Error('nope'));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await names.processRecord(rec())).toBe('applied');
    err.mockRestore();
  });
});
