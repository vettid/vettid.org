import * as fs from 'fs';
import * as path from 'path';
import { checkPolicy, checkReleaseKey, failedCheck, KeyCheckInput, ManifestRelease, parseStrict } from '../lambda/shared/keypolicy';
import { renderReleaseKeyPolicy } from '../lib/vault/release-key-policy';

/**
 * The TypeScript port of the enclave's §11.10.7 check must agree with the Go
 * original. test/fixtures/keycheck/ is a verbatim copy of vettid-vault
 * internal/keycheck/testdata (commit fb470e9): a staging release-4 key in
 * the test account 111122223333 (window 7 days) whose policy admits
 * release 3, and one variant per failing check. The expected verdicts are
 * those of vettid-vault's TestRecordedFixtures.
 */
const ACCOUNT = '111122223333';
const RETIREMENT = `arn:aws:iam::${ACCOUNT}:role/vettid-org-vault-key-retirement`;
const HOST = `arn:aws:iam::${ACCOUNT}:role/vettid-enclave-host`;
const keyArn = (n: number) => `arn:aws:kms:us-east-1:${ACCOUNT}:key/0000000${n}-0000-4000-8000-00000000000${n}`;
const pcr3 = 'ab'.repeat(48);
const pcr4 = 'cd'.repeat(48);
const releases: ManifestRelease[] = [
  { number: 3, pcr0: pcr3, pcr1: '11'.repeat(48), pcr2: '22'.repeat(48), sealKey: keyArn(3) },
  { number: 4, pcr0: pcr4, pcr1: '33'.repeat(48), pcr2: '44'.repeat(48), sealKey: keyArn(4) },
];

function fixture(dir: string, over: Partial<KeyCheckInput> = {}): KeyCheckInput {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'keycheck', dir, f), 'utf8');
  return {
    keyArn: keyArn(4),
    account: ACCOUNT,
    region: 'us-east-1',
    releases,
    target: 4,
    retirementPrincipal: RETIREMENT,
    retirementWindowDays: 7,
    describeKey: read('describe-key.json'),
    getKeyPolicy: read('get-key-policy.json'),
    listGrants: read('list-grants.json'),
    ...over,
  };
}

describe('keypolicy port: vettid-vault recorded fixtures', () => {
  test.each([
    ['pass', 0],
    ['check2-multiregion', 2],
    ['check3-grant', 3],
    ['check6-admin', 6],
    ['check7-ifexists', 7],
    ['check7-window', 7],
    ['check8-foreign', 8],
  ])('%s → check %i', (dir, want) => {
    expect(failedCheck(() => checkReleaseKey(fixture(dir)))).toBe(want);
  });

  test("the production window (30 days) refuses the staging fixture: the pinned constants are the channel's", () => {
    expect(failedCheck(() => checkReleaseKey(fixture('pass', { retirementWindowDays: 30 })))).toBe(7);
  });

  test('identity: another release, another key, another account', () => {
    expect(failedCheck(() => checkReleaseKey(fixture('pass', { target: 3 })))).toBe(1);
    expect(failedCheck(() => checkReleaseKey(fixture('pass', { keyArn: keyArn(3) })))).toBe(1);
    expect(failedCheck(() => checkReleaseKey(fixture('pass', { account: '444455556666' })))).toBe(1);
    // A retirement principal that is the account root, or in another account.
    expect(failedCheck(() => checkReleaseKey(fixture('pass', { retirementPrincipal: `arn:aws:iam::${ACCOUNT}:root` })))).toBe(1);
    expect(failedCheck(() => checkReleaseKey(fixture('pass', { retirementPrincipal: 'arn:aws:iam::444455556666:role/x' })))).toBe(1);
  });

  test('an image without a pinned retirement principal treats the retirement actions as disqualifying', () => {
    expect(failedCheck(() => checkReleaseKey(fixture('pass', { retirementPrincipal: '', retirementWindowDays: 0 })))).toBe(6);
  });

  test('strict JSON refuses duplicate member names', () => {
    expect(() => parseStrict('{"a":1,"a":2}')).toThrow();
    expect(() => parseStrict('{"a":[1,{"b":"x","b":"y"}]}')).toThrow();
    expect(() => parseStrict('{"a":1} x')).toThrow();
    expect(parseStrict('{"a":"\\u0041","b":[true,null,-1.5e3]}')).toBeTruthy();
  });
});

/**
 * The spec's "variants that MUST fail" (§11.10.7), each applied to the policy
 * this repo renders for release 4 (admitting release 3), window 30.
 */
describe('keypolicy port: §11.10.7 variants on the rendered policy', () => {
  const base = () =>
    renderReleaseKeyPolicy({
      account: ACCOUNT,
      release: 4,
      pcr0: pcr4,
      admittedPcr0s: [pcr3],
      hostRoleArn: HOST,
      retirementRoleArn: RETIREMENT,
      retirementWindowDays: 30,
    }) as { Statement: any[] } & Record<string, unknown>;
  const target = releases[1];
  const check = (doc: string, over: Partial<KeyCheckInput> = {}) =>
    failedCheck(() =>
      checkPolicy(doc, { keyArn: keyArn(4), account: ACCOUNT, releases, retirementPrincipal: RETIREMENT, retirementWindowDays: 30, ...over }, target),
    );
  const variant = (mutate: (p: ReturnType<typeof base>) => void) => {
    const p = base();
    mutate(p);
    return check(JSON.stringify(p));
  };
  const sid = (p: ReturnType<typeof base>, s: string) => p.Statement.find((x) => x.Sid === s || (s === 'Unseal' && /^UnsealOnlyInRelease/.test(x.Sid)));

  test('the rendered policy passes, and equals the spec example in shape', () => {
    expect(check(JSON.stringify(base()))).toBe(0);
    expect(base().Statement.map((s) => s.Sid)).toEqual([
      'UnsealOnlyInRelease4', 'SealFromAdmittedReleases', 'EnclaveVerifiesThisPolicy', 'RetireAfterNotice', 'RescueBeforeDeletion',
    ]);
  });

  test.each<[string, (p: ReturnType<typeof base>) => void, number]>([
    ['the default admin statement (kms:*)', (p) => p.Statement.push({ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCOUNT}:root` }, Action: 'kms:*', Resource: '*' }), 6],
    ['kms:PutKeyPolicy in an Allow', (p) => p.Statement.push({ Effect: 'Allow', Principal: { AWS: HOST }, Action: 'kms:PutKeyPolicy', Resource: '*' }), 6],
    ['kms:CreateGrant in an Allow', (p) => p.Statement.push({ Effect: 'Allow', Principal: { AWS: HOST }, Action: 'kms:CreateGrant', Resource: '*' }), 6],
    ['…IfExists on the Decrypt condition', (p) => { const s = sid(p, 'Unseal'); s.Condition.StringEqualsIgnoreCaseIfExists = s.Condition.StringEqualsIgnoreCase; delete s.Condition.StringEqualsIgnoreCase; }, 7],
    ['Decrypt also lists release 3', (p) => { sid(p, 'Unseal').Condition.StringEqualsIgnoreCase['kms:RecipientAttestation:ImageSha384'] = [pcr3, pcr4]; }, 6],
    ['Decrypt without a condition', (p) => { delete sid(p, 'Unseal').Condition; }, 6],
    ['Decrypt with ReEncryptFrom', (p) => { sid(p, 'Unseal').Action = ['kms:Decrypt', 'kms:ReEncryptFrom']; }, 6],
    ['kms:Encrypt', (p) => { sid(p, 'Unseal').Action = 'kms:Encrypt'; }, 6],
    ['NotAction in an Allow', (p) => p.Statement.push({ Effect: 'Allow', Principal: { AWS: HOST }, NotAction: 'kms:PutKeyPolicy', Resource: '*' }), 4],
    ['StringLike "*" on ImageSha384', (p) => { sid(p, 'Unseal').Condition.StringLike = { 'kms:RecipientAttestation:ImageSha384': '*' }; }, 7],
    ['GenerateDataKey admits an unknown release', (p) => { sid(p, 'SealFromAdmittedReleases').Condition.StringEqualsIgnoreCase['kms:RecipientAttestation:ImageSha384'] = [pcr4, 'ef'.repeat(48)]; }, 6],
    ['a statement member Condition2', (p) => { sid(p, 'Unseal').Condition2 = {}; }, 4],
    ['Principal "*" on Decrypt', (p) => { sid(p, 'Unseal').Principal = '*'; }, 8],
    ['Principal {AWS: "*"} on Decrypt', (p) => { sid(p, 'Unseal').Principal = { AWS: '*' }; }, 8],
    ['another account on GenerateDataKey', (p) => { sid(p, 'SealFromAdmittedReleases').Principal = { AWS: 'arn:aws:iam::444455556666:role/x' }; }, 8],
    ['a Service principal', (p) => { sid(p, 'EnclaveVerifiesThisPolicy').Principal = { Service: 'ec2.amazonaws.com' }; }, 8],
    ['Principal "*" on the read-only statement', (p) => { sid(p, 'EnclaveVerifiesThisPolicy').Principal = '*'; }, 8],
    ['Decrypt without kms:CallerAccount', (p) => { delete sid(p, 'Unseal').Condition.StringEquals; }, 8],
    ['Decrypt with another CallerAccount', (p) => { sid(p, 'Unseal').Condition.StringEquals['kms:CallerAccount'] = '444455556666'; }, 8],
    ['ScheduleKeyDeletion without the window', (p) => { delete sid(p, 'RetireAfterNotice').Condition.NumericEquals; }, 7],
    ['ScheduleKeyDeletion with NumericGreaterThanOrEquals', (p) => { const c = sid(p, 'RetireAfterNotice').Condition; c.NumericGreaterThanOrEquals = c.NumericEquals; delete c.NumericEquals; }, 7],
    ['ScheduleKeyDeletion with NumericEqualsIfExists', (p) => { const c = sid(p, 'RetireAfterNotice').Condition; c.NumericEqualsIfExists = c.NumericEquals; delete c.NumericEquals; }, 7],
    ['ScheduleKeyDeletion with another window', (p) => { sid(p, 'RetireAfterNotice').Condition.NumericEquals['kms:ScheduleKeyDeletionPendingWindowInDays'] = '7'; }, 7],
    ['ScheduleKeyDeletion with an array window', (p) => { sid(p, 'RetireAfterNotice').Condition.NumericEquals['kms:ScheduleKeyDeletionPendingWindowInDays'] = ['30']; }, 7],
    ['ScheduleKeyDeletion for the host role', (p) => { sid(p, 'RetireAfterNotice').Principal = { AWS: HOST }; }, 8],
    ['CancelKeyDeletion for the account root', (p) => { sid(p, 'RescueBeforeDeletion').Principal = { AWS: `arn:aws:iam::${ACCOUNT}:root` }; }, 8],
    ['retirement principal as an array', (p) => { sid(p, 'RescueBeforeDeletion').Principal = { AWS: [RETIREMENT] }; }, 8],
    ['kms:DisableKey for the retirement principal', (p) => { sid(p, 'RescueBeforeDeletion').Action = ['kms:CancelKeyDeletion', 'kms:DisableKey']; }, 6],
    ['kms:EnableKey in the Decrypt statement', (p) => { sid(p, 'Unseal').Action = ['kms:Decrypt', 'kms:EnableKey']; }, 6],
    ['a retirement statement whose principal is not the pinned one', (p) => { sid(p, 'RetireAfterNotice').Principal = { AWS: `arn:aws:iam::${ACCOUNT}:role/other` }; }, 8],
    ['a retirement statement that also lists DescribeKey', (p) => { sid(p, 'RescueBeforeDeletion').Action = ['kms:CancelKeyDeletion', 'kms:EnableKey', 'kms:DescribeKey']; }, 6],
    ['NumericEquals on the window in the Decrypt statement', (p) => { sid(p, 'Unseal').Condition.NumericEquals = { 'kms:ScheduleKeyDeletionPendingWindowInDays': '30' }; }, 7],
    ['a retirement statement without kms:CallerAccount', (p) => { delete sid(p, 'RescueBeforeDeletion').Condition; }, 8],
    ['the retirement principal on Decrypt', (p) => { sid(p, 'Unseal').Principal = { AWS: [HOST, RETIREMENT] }; }, 8],
  ])('%s fails check %i', (_name, mutate, want) => {
    expect(variant(mutate)).toBe(want);
  });

  test('a duplicated Action member fails check 4', () => {
    const doc = JSON.stringify(base()).replace('"Action":"kms:Decrypt"', '"Action":"kms:Decrypt","Action":"kms:Decrypt"');
    expect(check(doc)).toBe(4);
  });

  test('an image without a pinned retirement principal refuses the rendered policy (check 6)', () => {
    expect(check(JSON.stringify(base()), { retirementPrincipal: '', retirementWindowDays: 0 })).toBe(6);
  });

  test('the renderer refuses bad input', () => {
    const ok = { account: ACCOUNT, release: 4, pcr0: pcr4, admittedPcr0s: [pcr3], hostRoleArn: HOST, retirementRoleArn: RETIREMENT, retirementWindowDays: 30 };
    expect(() => renderReleaseKeyPolicy({ ...ok, pcr0: pcr4.toUpperCase() })).toThrow(/lowercase hex/);
    expect(() => renderReleaseKeyPolicy({ ...ok, admittedPcr0s: [pcr4] })).toThrow(/distinct/);
    expect(() => renderReleaseKeyPolicy({ ...ok, retirementWindowDays: 14 })).toThrow(/window/);
    expect(() => renderReleaseKeyPolicy({ ...ok, release: 0 })).toThrow(/release number/);
    expect(() => renderReleaseKeyPolicy({ ...ok, hostRoleArn: 'arn:aws:iam::444455556666:role/h' })).toThrow(/not a role in/);
    expect(() => renderReleaseKeyPolicy({ ...ok, retirementRoleArn: HOST })).toThrow(/differ/);
  });
});
