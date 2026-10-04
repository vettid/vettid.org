/**
 * A TypeScript port of the enclave's release-key check (VAULT-MESSAGING
 * 0.10.0 §11.10.7; vettid-vault `enclave/keypolicy`, ported from commit
 * fb470e9). Used twice in this repo:
 *  - the release-key custom resource refuses to create a key whose policy
 *    the enclave would refuse (lambda/vault/release-key.ts);
 *  - CDK tests run every synthesized release-key policy through it, and run
 *    vettid-vault's recorded keycheck fixtures through it so the port
 *    cannot drift from the Go original (test/vault-keypolicy.test.ts).
 *
 * It is a pure function over the raw KMS DescribeKey, GetKeyPolicy and
 * ListGrants responses and fails closed exactly where the Go code does.
 * The enclave's own check remains the authority; this is a pre-flight.
 */

export class KeyCheckError extends Error {
  constructor(readonly check: 1 | 2 | 3 | 4 | 6 | 7 | 8) {
    super(`keypolicy: check ${check} failed`);
  }
}

export interface ManifestRelease {
  readonly number: number;
  /** 96 lowercase hex. */
  readonly pcr0: string;
  readonly pcr1?: string;
  readonly pcr2?: string;
  readonly sealKey: string;
}

export interface KeyCheckInput {
  readonly keyArn: string;
  /** Pinned in the release image. */
  readonly account: string;
  readonly region: string;
  /** The verified manifest's releases, and the target release's number. */
  readonly releases: readonly ManifestRelease[];
  readonly target: number;
  /** Pinned retirement constants; '' and 0 for an image without them. */
  readonly retirementPrincipal: string;
  readonly retirementWindowDays: number;
  /** Raw KMS response bodies (JSON). */
  readonly describeKey: string;
  readonly getKeyPolicy: string;
  readonly listGrants: string;
}

const MAX_RESPONSE = 64 * 1024;
const ACT_DECRYPT = 'kms:Decrypt';
const ACT_GDK = 'kms:GenerateDataKey';
const ACT_SCHEDULE = 'kms:ScheduleKeyDeletion';
const RETIREMENT = new Set([ACT_SCHEDULE, 'kms:CancelKeyDeletion', 'kms:EnableKey']);
const READ_ONLY = new Set([
  'kms:DescribeKey', 'kms:GetKeyPolicy', 'kms:ListGrants', 'kms:ListKeyPolicies', 'kms:GetKeyRotationStatus', 'kms:ListResourceTags',
]);
const KEY_WINDOW = 'kms:ScheduleKeyDeletionPendingWindowInDays';
const OP_NUM_EQ = 'NumericEquals';
const KEY_IMAGE = 'kms:RecipientAttestation:ImageSha384';
const KEY_PCR0 = 'kms:RecipientAttestation:PCR0';
const KEY_PCR_PFX = 'kms:RecipientAttestation:PCR';
const KEY_CALLER = 'kms:CallerAccount';
const KEY_EC_PFX = 'kms:EncryptionContext:';
const KEY_PRIN_ARN = 'aws:PrincipalArn';

// ---- strict JSON: values keep their raw form; duplicate member names fail ----

type JVal =
  | { t: 'obj'; m: Map<string, JVal> }
  | { t: 'arr'; a: JVal[] }
  | { t: 'str'; s: string }
  | { t: 'num'; raw: string }
  | { t: 'bool'; b: boolean }
  | { t: 'null' };

class StrictJsonError extends Error {}

/** Parses RFC 8259 JSON, refusing duplicate member names (§5.3). */
export function parseStrict(text: string): JVal {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const fail = (): never => {
    throw new StrictJsonError();
  };
  const str = (): string => {
    if (text[i] !== '"') fail();
    const start = i++;
    while (i < text.length && text[i] !== '"') {
      if (text.charCodeAt(i) < 0x20) fail();
      if (text[i] === '\\') i++;
      i++;
    }
    if (i >= text.length) fail();
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (depth: number): JVal => {
    if (depth > 64) fail();
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const m = new Map<string, JVal>();
      ws();
      if (text[i] === '}') {
        i++;
        return { t: 'obj', m };
      }
      for (;;) {
        ws();
        const k = str();
        if (m.has(k)) fail();
        ws();
        if (text[i++] !== ':') fail();
        m.set(k, value(depth + 1));
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i++] !== '}') fail();
        return { t: 'obj', m };
      }
    }
    if (c === '[') {
      i++;
      const a: JVal[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return { t: 'arr', a };
      }
      for (;;) {
        a.push(value(depth + 1));
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i++] !== ']') fail();
        return { t: 'arr', a };
      }
    }
    if (c === '"') return { t: 'str', s: str() };
    const lit = /^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!lit) fail();
    i += lit![0].length;
    if (lit![0] === 'true' || lit![0] === 'false') return { t: 'bool', b: lit![0] === 'true' };
    if (lit![0] === 'null') return { t: 'null' };
    return { t: 'num', raw: lit![0] };
  };
  try {
    const v = value(0);
    ws();
    if (i !== text.length) fail();
    return v;
  } catch {
    throw new StrictJsonError();
  }
}

const obj = (v: JVal | undefined) => (v && v.t === 'obj' ? v.m : undefined);
const strOf = (v: JVal | undefined) => (v && v.t === 'str' ? v.s : undefined);
const onlyMembers = (m: Map<string, JVal>, ...names: string[]) => [...m.keys()].every((k) => names.includes(k));

/** A JSON string or a non-empty array of strings. */
function stringOrArray(v: JVal | undefined): string[] | undefined {
  if (!v) return undefined;
  if (v.t === 'str') return [v.s];
  if (v.t === 'arr' && v.a.length > 0 && v.a.every((e) => e.t === 'str')) return v.a.map((e) => (e as { s: string }).s);
  return undefined;
}

// ---- helpers ----

const validAccount = (a: string) => /^[0-9]{12}$/.test(a);
const validRegion = (r: string) => r.length > 0 && r.length <= 32 && /^[a-z0-9-]+$/.test(r);
const isHex = (s: string, n: number, lowerOnly: boolean) => s.length === n && (lowerOnly ? /^[0-9a-f]*$/ : /^[0-9a-fA-F]*$/).test(s);

function keyArnOk(arn: string, region: string, account: string): boolean {
  const prefix = `arn:aws:kms:${region}:${account}:key/`;
  if (!arn.startsWith(prefix)) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(arn.slice(prefix.length));
}

/** arn:aws:iam::<account>:root or arn:aws:iam::<account>:role/<path/name> → the account. */
export function iamArnAccount(s: string): string | undefined {
  const pfx = 'arn:aws:iam::';
  if (!s.startsWith(pfx) || s.length < pfx.length + 13) return undefined;
  const acct = s.slice(pfx.length, pfx.length + 12);
  let rest = s.slice(pfx.length + 12);
  if (!validAccount(acct) || rest === '' || rest[0] !== ':') return undefined;
  rest = rest.slice(1);
  if (rest === 'root') return acct;
  if (!rest.startsWith('role/')) return undefined;
  const name = rest.slice('role/'.length);
  if (name === '' || name.length > 512 || name.endsWith('/') || name.startsWith('/') || name.includes('//')) return undefined;
  return /^[A-Za-z0-9+=,.@_\-/]+$/.test(name) ? acct : undefined;
}

function validRetirement(input: KeyCheckInput): boolean {
  if (input.retirementPrincipal === '') return input.retirementWindowDays === 0;
  const acct = iamArnAccount(input.retirementPrincipal);
  return (
    acct === input.account &&
    !input.retirementPrincipal.endsWith(':root') &&
    input.retirementWindowDays >= 7 &&
    input.retirementWindowDays <= 30
  );
}

function parseResponse(raw: string, check: KeyCheckError['check']): Map<string, JVal> {
  if (raw.length === 0 || Buffer.byteLength(raw) > MAX_RESPONSE) throw new KeyCheckError(check);
  try {
    const m = obj(parseStrict(raw));
    if (!m) throw new KeyCheckError(check);
    return m;
  } catch {
    throw new KeyCheckError(check);
  }
}

// ---- the check ----

/** Runs §11.10.7 in order; throws KeyCheckError naming the failed check. Returns the policy text. */
export function checkReleaseKey(input: KeyCheckInput): string {
  if (!validAccount(input.account) || !validRegion(input.region) || !validRetirement(input)) throw new KeyCheckError(1);
  const target = input.releases.find((r) => r.number === input.target);
  if (!target) throw new KeyCheckError(1);
  // 1. Key identity.
  if (input.keyArn !== target.sealKey || !keyArnOk(input.keyArn, input.region, input.account)) throw new KeyCheckError(1);
  // 2. Key metadata.
  checkMetadata(input);
  // 3. No grants.
  checkGrants(input.listGrants);
  // 4-8. The policy.
  const resp = parseResponse(input.getKeyPolicy, 4);
  if (!onlyMembers(resp, 'Policy', 'PolicyName')) throw new KeyCheckError(4);
  if (resp.has('PolicyName') && strOf(resp.get('PolicyName')) !== 'default') throw new KeyCheckError(4);
  const doc = strOf(resp.get('Policy'));
  if (doc === undefined) throw new KeyCheckError(4);
  checkPolicy(doc, input, target);
  return doc;
}

function checkMetadata(input: KeyCheckInput): void {
  const o = parseResponse(input.describeKey, 2);
  const md = obj(o.get('KeyMetadata'));
  if (!md) throw new KeyCheckError(2);
  const want: Record<string, string> = {
    Arn: input.keyArn, AWSAccountId: input.account, KeyState: 'Enabled', Origin: 'AWS_KMS',
    KeySpec: 'SYMMETRIC_DEFAULT', KeyUsage: 'ENCRYPT_DECRYPT', KeyManager: 'CUSTOMER',
  };
  for (const [k, v] of Object.entries(want)) if (strOf(md.get(k)) !== v) throw new KeyCheckError(2);
  const mr = md.get('MultiRegion');
  if (!mr || mr.t !== 'bool' || mr.b) throw new KeyCheckError(2);
  if (md.has('CustomKeyStoreId') || md.has('CloudHsmClusterId') || md.has('XksKeyConfiguration')) throw new KeyCheckError(2);
}

function checkGrants(raw: string): void {
  const o = parseResponse(raw, 3);
  const g = o.get('Grants');
  if (!g || g.t !== 'arr' || g.a.length !== 0) throw new KeyCheckError(3);
  const tr = o.get('Truncated');
  if (!tr || tr.t !== 'bool' || tr.b) throw new KeyCheckError(3);
  if (o.has('NextMarker')) throw new KeyCheckError(3);
}

interface Statement {
  effect: string;
  principal: JVal | undefined;
  actions: string[];
  condition: Map<string, JVal> | undefined;
}

/** Checks 4-8 on a policy document alone (the part a synthesized key can be tested on). */
export function checkPolicy(doc: string, input: Pick<KeyCheckInput, 'keyArn' | 'account' | 'releases' | 'retirementPrincipal' | 'retirementWindowDays'>, target: ManifestRelease): void {
  let p: Map<string, JVal> | undefined;
  try {
    p = obj(parseStrict(doc));
  } catch {
    throw new KeyCheckError(4);
  }
  // 4. Policy shape.
  if (!p || !onlyMembers(p, 'Version', 'Id', 'Statement')) throw new KeyCheckError(4);
  if (strOf(p.get('Version')) !== '2012-10-17') throw new KeyCheckError(4);
  if (p.has('Id') && strOf(p.get('Id')) === undefined) throw new KeyCheckError(4);
  const raw = p.get('Statement');
  let rawStmts: JVal[];
  if (raw?.t === 'obj') rawStmts = [raw];
  else if (raw?.t === 'arr') rawStmts = raw.a;
  else throw new KeyCheckError(4);
  const stmts = rawStmts.map((r) => parseStatement(r, input.keyArn));
  // 5. Deny statements only remove access: ignored from here on.
  for (const s of stmts) if (s.effect === 'Allow') checkAllow(s, input, target);
}

function parseStatement(raw: JVal, keyArn: string): Statement {
  const o = obj(raw);
  if (!o || !onlyMembers(o, 'Sid', 'Effect', 'Principal', 'Action', 'Resource', 'Condition')) throw new KeyCheckError(4);
  if (o.has('Sid') && strOf(o.get('Sid')) === undefined) throw new KeyCheckError(4);
  const effect = strOf(o.get('Effect'));
  if (effect !== 'Allow' && effect !== 'Deny') throw new KeyCheckError(4);
  const actions = stringOrArray(o.get('Action'));
  if (!actions) throw new KeyCheckError(4);
  const res = strOf(o.get('Resource'));
  if (res === undefined || (res !== '*' && res !== keyArn)) throw new KeyCheckError(4);
  let condition: Map<string, JVal> | undefined;
  if (o.has('Condition')) {
    condition = obj(o.get('Condition'));
    if (!condition) throw new KeyCheckError(4);
  }
  return { effect, principal: o.get('Principal'), actions, condition };
}

interface Cond {
  op: string;
  key: string;
  values: string[];
}

function parseConditions(c: Map<string, JVal> | undefined): Cond[] {
  const out: Cond[] = [];
  if (!c) return out;
  for (const [op, raw] of c) {
    if (op === OP_NUM_EQ) {
      const inner = obj(raw);
      if (!inner || inner.size !== 1) throw new KeyCheckError(7);
      const v = windowValue(inner.get(KEY_WINDOW));
      if (v === undefined) throw new KeyCheckError(7);
      out.push({ op, key: KEY_WINDOW, values: [v] });
      continue;
    }
    if (op !== 'StringEquals' && op !== 'StringEqualsIgnoreCase' && op !== 'ArnEquals') throw new KeyCheckError(7);
    const inner = obj(raw);
    if (!inner || inner.size === 0) throw new KeyCheckError(7);
    for (const [key, v] of inner) {
      const vals = stringOrArray(v);
      if (!vals) throw new KeyCheckError(7);
      allowedEntry(op, key, vals);
      out.push({ op, key, values: vals });
    }
  }
  return out;
}

/** One JSON string or number in canonical decimal (no sign, fraction, exponent or leading zero). */
function windowValue(v: JVal | undefined): string | undefined {
  if (!v) return undefined;
  let s: string;
  if (v.t === 'str') s = v.s;
  else if (v.t === 'num') s = v.raw;
  else return undefined;
  return /^[1-9][0-9]{0,2}$/.test(s) ? s : undefined;
}

function allowedEntry(op: string, key: string, vals: string[]): void {
  const str = op === 'StringEquals' || op === 'StringEqualsIgnoreCase';
  if (key === KEY_IMAGE || key === KEY_PCR0) {
    if (!str || !vals.every((v) => isHex(v, 96, false))) throw new KeyCheckError(7);
  } else if (key.startsWith(KEY_PCR_PFX)) {
    const n = key.slice(KEY_PCR_PFX.length);
    if (!str || !/^[1-8]$/.test(n) || !vals.every((v) => isHex(v, 96, false))) throw new KeyCheckError(7);
  } else if (key.startsWith(KEY_EC_PFX)) {
    if (!str || key.length === KEY_EC_PFX.length) throw new KeyCheckError(7);
  } else if (key === KEY_CALLER) {
    if (op !== 'StringEquals' || !vals.every(validAccount)) throw new KeyCheckError(7);
  } else if (key === KEY_PRIN_ARN) {
    if (op !== 'ArnEquals' || !vals.every((v) => iamArnAccount(v) !== undefined)) throw new KeyCheckError(7);
  } else {
    throw new KeyCheckError(7);
  }
}

function checkAllow(s: Statement, input: Parameters<typeof checkPolicy>[1], target: ManifestRelease): void {
  // 7. Conditions: operators and keys from the allow-list only.
  const conds = parseConditions(s.condition);
  // 6. Actions.
  const gated = new Set<string>();
  const retire = new Set<string>();
  let readOnlyN = 0;
  for (const a of s.actions) {
    if (/[*?]/.test(a)) throw new KeyCheckError(6);
    if (a === ACT_DECRYPT || a === ACT_GDK) gated.add(a);
    else if (READ_ONLY.has(a)) readOnlyN++;
    else if (RETIREMENT.has(a) && input.retirementPrincipal !== '') retire.add(a);
    else throw new KeyCheckError(6);
  }
  if (retire.size > 0 && (gated.size > 0 || readOnlyN > 0)) throw new KeyCheckError(6);
  for (const a of gated) checkAttestation(conds, admittedFor(a, input.releases, target));
  // 7. The deletion window: NumericEquals only where ScheduleKeyDeletion is, required there.
  const window = conds.find((c) => c.op === OP_NUM_EQ)?.values[0] ?? '';
  if (window !== '' && !retire.has(ACT_SCHEDULE)) throw new KeyCheckError(7);
  if (retire.has(ACT_SCHEDULE) && window !== String(input.retirementWindowDays)) throw new KeyCheckError(7);
  // 8. Principals.
  checkPrincipal(s.principal, input.account);
  if (retire.size > 0 && !exactPrincipal(s.principal, input.retirementPrincipal)) throw new KeyCheckError(8);
  if (gated.size > 0 && input.retirementPrincipal !== '' && namesPrincipal(s.principal, input.retirementPrincipal)) throw new KeyCheckError(8);
  let callerOk = false;
  for (const c of conds) {
    if (c.key === KEY_CALLER) {
      if (!c.values.every((v) => v === input.account)) throw new KeyCheckError(8);
      callerOk = true;
    } else if (c.key === KEY_PRIN_ARN) {
      if (!c.values.every((v) => iamArnAccount(v) === input.account)) throw new KeyCheckError(8);
    }
  }
  if ((gated.size > 0 || retire.size > 0) && !callerOk) throw new KeyCheckError(8);
}

function exactPrincipal(raw: JVal | undefined, arn: string): boolean {
  const o = obj(raw);
  return !!o && o.size === 1 && strOf(o.get('AWS')) === arn;
}

function namesPrincipal(raw: JVal | undefined, arn: string): boolean {
  const o = obj(raw);
  return !!o && (stringOrArray(o.get('AWS')) ?? []).includes(arn);
}

function admittedFor(action: string, releases: readonly ManifestRelease[], target: ManifestRelease): ManifestRelease[] {
  if (action === ACT_DECRYPT) return [target];
  return releases.filter((r) => r.number <= target.number);
}

function checkAttestation(conds: Cond[], admitted: ManifestRelease[]): void {
  let found = false;
  for (const c of conds) {
    let field: ((r: ManifestRelease) => string | undefined) | undefined;
    if (c.key === KEY_IMAGE || c.key === KEY_PCR0) {
      field = (r) => r.pcr0;
      found = true;
    } else if (c.key === `${KEY_PCR_PFX}1`) field = (r) => r.pcr1;
    else if (c.key === `${KEY_PCR_PFX}2`) field = (r) => r.pcr2;
    else continue;
    for (const v of c.values) {
      const lv = v.toLowerCase();
      if (!admitted.some((r) => field!(r) === lv)) throw new KeyCheckError(6);
    }
  }
  if (!found) throw new KeyCheckError(6); // Decrypt or GenerateDataKey without an attestation condition
}

function checkPrincipal(raw: JVal | undefined, account: string): void {
  const o = obj(raw);
  if (!o || o.size !== 1) throw new KeyCheckError(8); // "*" and anything that is not {"AWS": ...}
  const arns = stringOrArray(o.get('AWS'));
  if (!arns) throw new KeyCheckError(8);
  for (const a of arns) if (iamArnAccount(a) !== account) throw new KeyCheckError(8);
}

/** The failed check's number, 0 for none (a test convenience, like the Go FailedCheck). */
export function failedCheck(fn: () => unknown): number {
  try {
    fn();
    return 0;
  } catch (e) {
    if (e instanceof KeyCheckError) return e.check;
    throw e;
  }
}
