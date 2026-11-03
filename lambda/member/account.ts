/**
 * Member API, account routes: /api/account/*  (docs/MEMBER-API.md)
 * Every route requires a valid session cookie and an active account, except
 * the account deletion's cancel link (MEMBER-API 2.14.0), which needs no
 * session; the members table (not token claims) is the source of truth for
 * state.
 *
 * After a change the vault's account snapshot shows (terms accepted,
 * subscription started or cancelled, account deletion requested or
 * cancelled), the member's running vault is sent the new snapshot
 * (MEMBER-API 2.0.0 "Account snapshot to the vault"; asynchronous, best
 * effort).
 */
import {
  AdminAddUserToGroupCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomBytes, randomInt } from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { audit, memberActor } from '../shared/audit';
import { cognito, ddb, env, s3, table } from '../shared/aws';
import { HttpError, Router, badRequest, bool, conflict, forbidden, notFound, str } from '../shared/http';
import { nowIso } from '../shared/ids';
import { ApiError, MemberRequest, WithStatus, clearSessionCookies, memberHandler, requireSession } from '../shared/member-http';
import { canSignIn, currentTerms, memberByGuid } from '../shared/members';
import { hasVotingRights, MemberItem, SubscriptionItem } from '../shared/model';
import { checkPin, hashPin, pinProblem } from '../shared/pin';
import { sendMail } from '../shared/mail';
import { pushAccountSnapshot } from '../shared/account-snapshot';
import {
  ACCOUNT_DELETION_DELAY_MS,
  ACCOUNT_DELETION_PHRASE,
  AccountDeletion,
  DELETION_CODES_PER_HOUR,
  DELETION_CODE_MAX_ATTEMPTS,
  DELETION_CODE_TTL_S,
  TEXT,
  deletionCancelledMail,
  deletionCodeMail,
  disableUnlessActive,
  hashDeletionCode,
  sameHex,
} from '../shared/account-deletion';
import { requestMemberVaults } from '../shared/member-vaults';
import { hit } from '../shared/ratelimit';
import { parseWithdrawToken } from '../shared/requests';
import { newUlid } from '../shared/vault-routing';

const router = new Router<MemberRequest>();
const poolId = () => env('MEMBER_POOL_ID');

async function subscriptionOf(guid: string): Promise<SubscriptionItem | null> {
  const r = await ddb.send(new GetCommand({ TableName: table.subscriptions(), Key: { user_guid: guid } }));
  return (r.Item as SubscriptionItem | undefined) ?? null;
}

async function loadMember(req: MemberRequest): Promise<MemberItem> {
  const s = await requireSession(req);
  const m = await memberByGuid(s.user_guid);
  if (!canSignIn(m) || m.email !== s.email) throw forbidden('This account is not active');
  return m;
}

async function me(m: MemberItem) {
  const [terms, sub] = await Promise.all([currentTerms(), subscriptionOf(m.user_guid)]);
  return {
    user_guid: m.user_guid,
    email: m.email,
    first_name: m.first_name,
    last_name: m.last_name,
    state: m.state,
    account_status: m.account_status,
    terms: {
      current_version: terms?.version_id ?? null,
      accepted_version: m.terms_version ?? null,
      needs_acceptance: !!terms && terms.version_id !== m.terms_version,
    },
    subscription: sub,
    voting_rights: hasVotingRights(m, sub),
    email_verified: !!m.email_verified,
    pin_enabled: !!m.pin_hash,
    preferences: { email_updates: m.email_updates !== false, pin_prompt_dismissed: !!m.pin_prompt_dismissed },
    created_at: m.created_at,
  };
}

async function setFields(m: MemberItem, set: Record<string, unknown>, remove: string[] = []): Promise<MemberItem> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = Object.entries({ ...set, updated_at: nowIso() }).map(([k, v], i) => {
    names[`#k${i}`] = k;
    values[`:v${i}`] = v;
    return `#k${i} = :v${i}`;
  });
  const rems = remove.map((k, i) => {
    names[`#r${i}`] = k;
    return `#r${i}`;
  });
  const r = await ddb.send(
    new UpdateCommand({
      TableName: table.members(),
      Key: { user_guid: m.user_guid },
      UpdateExpression: `SET ${sets.join(', ')}${rems.length ? ` REMOVE ${rems.join(', ')}` : ''}`,
      ConditionExpression: 'account_status = :active',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: { ...values, ':active': 'active' },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return r.Attributes as MemberItem;
}

/** Security notices for PIN changes and lockouts; never fail the request over them. */
async function pinNotice(m: MemberItem, what: 'set' | 'changed' | 'removed' | 'locked') {
  const body = {
    set: 'A sign-in PIN was just added to your VettID account.',
    changed: 'The sign-in PIN on your VettID account was just changed.',
    removed: 'The sign-in PIN was just removed from your VettID account. Signing in now needs only the email link.',
    locked: 'Too many incorrect PINs were entered for your VettID account, so PIN entry is temporarily locked.',
  }[what];
  try {
    await sendMail(
      m.email,
      what === 'locked' ? 'VettID: PIN entry locked' : 'VettID: your sign-in PIN changed',
      `${body}\n\nIf this wasn't you, contact support@vettid.org right away — an administrator can help secure your account.\n\n— VettID\n`,
    );
  } catch (e) {
    console.error('pin notice failed', (e as Error).name);
  }
}

async function requirePin(m: MemberItem, pin: unknown) {
  if (!m.pin_hash) return;
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) throw badRequest('Enter your current PIN');
  const r = await checkPin(m.user_guid, m.pin_hash, pin);
  if (!r.ok) {
    if (r.justLocked) await pinNotice(m, 'locked');
    throw new HttpError(403, 'forbidden', r.locked ? 'Too many incorrect PINs; PIN entry is locked for now.' : `Incorrect PIN. ${r.attemptsLeft} attempts left.`);
  }
}

// ---- me / terms -------------------------------------------------------------------

router.on('GET', '/api/account/me', async (req) => me(await loadMember(req)));

router.on('GET', '/api/account/terms', async (req) => {
  await loadMember(req);
  const t = await currentTerms();
  if (!t) throw notFound('No membership terms are published yet');
  const bucket = env('TERMS_BUCKET');
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `terms/${t.version_id}.txt` }));
  const text = await obj.Body!.transformToString('utf-8');
  const pdf_url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: `terms/${t.version_id}.pdf`, ResponseContentDisposition: `inline; filename="vettid-terms-${t.version_id}.pdf"` }),
    { expiresIn: 300 },
  );
  return { version_id: t.version_id, title: t.title, sha256: t.sha256, text, pdf_url };
});

router.on('POST', '/api/account/terms/accept', async (req) => {
  const m = await loadMember(req);
  const version = str(req.body, 'version_id', { max: 64 });
  const sha = str(req.body, 'sha256', { max: 64 });
  const t = await currentTerms();
  if (!t || t.version_id !== version || t.sha256 !== sha) throw conflict('These are not the current terms; reload and review them again');
  const updated = await setFields(m, { terms_version: t.version_id, terms_sha256: t.sha256, terms_accepted_at: nowIso(), state: 'member' });
  if (m.state !== 'member') {
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: poolId(), Username: m.email, GroupName: 'member' }));
  }
  await audit(memberActor(m.user_guid), 'member.accept_terms', m.user_guid, { version_id: t.version_id, sha256: t.sha256, from_state: m.state });
  await pushAccountSnapshot(m.user_guid);
  return me(updated);
});

// ---- subscriptions ------------------------------------------------------------------

interface SubscriptionTypeItem {
  type_id: string;
  name: string;
  description: string;
  duration_days: number;
  is_trial: boolean;
  paid: boolean;
  enabled: boolean;
}

async function enabledTypes(): Promise<SubscriptionTypeItem[]> {
  const r = await ddb.send(new ScanCommand({ TableName: table.subscriptionTypes(), Limit: 200 }));
  return ((r.Items ?? []) as SubscriptionTypeItem[]).filter((t) => t.enabled);
}

router.on('GET', '/api/account/subscription-types', async (req) => {
  const m = await loadMember(req);
  const items = (await enabledTypes())
    .filter((t) => !(t.is_trial && m.has_used_trial))
    .map(({ type_id, name, description, duration_days, is_trial, paid }) => ({ type_id, name, description, duration_days, is_trial, paid }));
  return { items };
});

router.on('POST', '/api/account/subscription', async (req) => {
  const m = await loadMember(req);
  if (m.state !== 'member') throw conflict('Accept the membership terms first');
  const typeId = str(req.body, 'type_id', { max: 80 });
  const t = (await enabledTypes()).find((x) => x.type_id === typeId);
  if (!t) throw notFound('No such subscription type');
  if (t.paid) throw conflict('Payments are not available yet');
  if (!t.is_trial) throw conflict('This subscription type cannot be started here');
  if (m.has_used_trial) throw conflict('You have already used your free trial');
  const existing = await subscriptionOf(m.user_guid);
  if (existing && (existing.status === 'trial' || existing.status === 'active') && new Date(existing.expires_at) > new Date()) {
    throw conflict('You already have an active subscription');
  }
  const now = new Date();
  const sub: SubscriptionItem = {
    user_guid: m.user_guid,
    type_id: t.type_id,
    type_name: t.name,
    status: 'trial',
    paid: false,
    started_at: now.toISOString(),
    expires_at: new Date(now.getTime() + t.duration_days * 86_400_000).toISOString(),
  };
  // Mark the trial used first (conditionally) so two tabs can't both start one.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.members(),
        Key: { user_guid: m.user_guid },
        UpdateExpression: 'SET has_used_trial = :t, updated_at = :n',
        ConditionExpression: 'attribute_not_exists(has_used_trial) OR has_used_trial = :f',
        ExpressionAttributeValues: { ':t': true, ':f': false, ':n': nowIso() },
      }),
    );
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw conflict('You have already used your free trial');
    throw e;
  }
  await ddb.send(new PutCommand({ TableName: table.subscriptions(), Item: sub }));
  await audit(memberActor(m.user_guid), 'subscription.start', m.user_guid, { type_id: t.type_id, expires_at: sub.expires_at });
  await pushAccountSnapshot(m.user_guid);
  return me({ ...m, has_used_trial: true });
});

router.on('POST', '/api/account/subscription/cancel', async (req) => {
  const m = await loadMember(req);
  const sub = await subscriptionOf(m.user_guid);
  if (!sub || sub.status === 'canceled' || sub.status === 'expired') throw conflict('No active subscription');
  await ddb.send(new PutCommand({ TableName: table.subscriptions(), Item: { ...sub, status: 'canceled' } }));
  await audit(memberActor(m.user_guid), 'subscription.cancel', m.user_guid, { type_id: sub.type_id });
  await pushAccountSnapshot(m.user_guid);
  return me(m);
});

// ---- PIN ----------------------------------------------------------------------------

router.on('POST', '/api/account/pin', async (req) => {
  const m = await loadMember(req);
  const pin = req.body.pin;
  const problem = pinProblem(pin);
  if (problem) throw badRequest(problem);
  if (m.pin_hash) await requirePin(m, req.body.current_pin);
  const updated = await setFields(m, { pin_hash: await hashPin(m.user_guid, pin as string) });
  await audit(memberActor(m.user_guid), m.pin_hash ? 'member.pin_change' : 'member.pin_enable', m.user_guid);
  await pinNotice(m, m.pin_hash ? 'changed' : 'set');
  return me(updated);
});

router.on('DELETE', '/api/account/pin', async (req) => {
  const m = await loadMember(req);
  if (!m.pin_hash) throw conflict('No PIN is set');
  await requirePin(m, req.body.current_pin);
  const updated = await setFields(m, {}, ['pin_hash']);
  await audit(memberActor(m.user_guid), 'member.pin_disable', m.user_guid);
  await pinNotice(m, 'removed');
  return me(updated);
});

// ---- preferences -------------------------------------------------------------------

router.on('POST', '/api/account/preferences', async (req) => {
  const m = await loadMember(req);
  const set: Record<string, boolean> = {};
  for (const k of ['email_updates', 'pin_prompt_dismissed'] as const) {
    if (req.body[k] === undefined) continue;
    if (typeof req.body[k] !== 'boolean') throw badRequest(`${k} must be true or false`);
    set[k] = req.body[k] as boolean;
  }
  if (!Object.keys(set).length) throw badRequest('Nothing to update');
  const updated = await setFields(m, set);
  return me(updated);
});

// ---- deleting the account (MEMBER-API 2.14.0 "Deleting the account"; ACCOUNT-ADMIN-PLAN §5.4) ----
//
// Replaces POST /api/account/cancel (withdrawn: the router answers 404). The
// account is disabled at once and deleted by the cleanup job at its first
// daily run from 7 days later; the confirmation email (members-stream
// mailer) carries the cancel link. Refused while the member has a vault.

/** Sign-in's per-address and global mail limits (lambda/member/link-mailer.ts), shared by the deletion code. */
const SIGN_IN_MAILS_PER_ADDRESS_HOUR = 5;
const SIGN_IN_MAILS_GLOBAL_HOUR = 100;

async function limit(key: string, max: number, windowS: number, message: string): Promise<void> {
  const r = await hit(key, max, windowS);
  if (!r.allowed) throw new ApiError(429, 'rate_limited', message, { retry_after: r.retryAfter });
}

type Blocking = { vault_id: string; state: string | null };

/**
 * The member's vaults that block the deletion: every vault that is not
 * deleted, except a never-sealed row (§5.4.1). Asked of the member-vaults
 * function (the vault tables are in the vault account); any failure throws,
 * so "no vault" is never taken from an error. An answer without
 * `never_sealed` counts the vault.
 */
async function blockingVaults(m: MemberItem): Promise<Blocking[]> {
  const { vaults } = await requestMemberVaults(m.user_guid, 'account deletion');
  return vaults.filter((v) => v.never_sealed !== true).map(({ vault_id, state }) => ({ vault_id, state }));
}

const vaultExists = (vaults: Blocking[]) =>
  new ApiError(409, 'vault_exists', vaults.every((v) => v.state === 'enrolling') ? TEXT.enrolling : TEXT.vault, { vaults });

/** Whether the address has an entry on the mailing list (the signup stack's table, by its fixed name). */
async function onMailingList(email: string): Promise<boolean> {
  const r = await ddb.send(new GetCommand({ TableName: env('TABLE_MAILING_LIST'), Key: { email } }));
  return !!r.Item;
}

/**
 * Spend one attempt of the email code, then compare (§5.4.2). The attempt
 * is reserved by a conditional update before the compare, so two guesses
 * cannot share one; a correct code, and a wrong last one, are then removed
 * (only that code), so a code is single use. 403 with the page's texts.
 */
async function spendCode(m: MemberItem, code: string): Promise<void> {
  const c = m.deletion_code;
  const nowS = Math.floor(Date.now() / 1000);
  if (!c || typeof c.code_id !== 'string' || typeof c.hash !== 'string' || !(c.expires_at > nowS)) throw forbidden(TEXT.codeExpired);
  let n: number;
  try {
    const r = await ddb.send(
      new UpdateCommand({
        TableName: table.members(),
        Key: { user_guid: m.user_guid },
        UpdateExpression: 'SET deletion_code.attempts = deletion_code.attempts + :one',
        ConditionExpression: 'account_status = :active AND deletion_code.code_id = :id AND deletion_code.attempts < :max AND deletion_code.expires_at > :now',
        ExpressionAttributeValues: { ':one': 1, ':active': 'active', ':id': c.code_id, ':max': DELETION_CODE_MAX_ATTEMPTS, ':now': nowS },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    n = Number((r.Attributes as { deletion_code?: { attempts?: unknown } } | undefined)?.deletion_code?.attempts);
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') throw forbidden(TEXT.codeExpired);
    throw e;
  }
  if (!Number.isInteger(n) || n < 1) throw new Error('deletion code attempt not counted');
  const ok = /^\d{6}$/.test(code) && sameHex(await hashDeletionCode(m.user_guid, c.code_id, code), c.hash);
  if (ok || n >= DELETION_CODE_MAX_ATTEMPTS) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: table.members(),
          Key: { user_guid: m.user_guid },
          UpdateExpression: 'REMOVE deletion_code',
          ConditionExpression: 'deletion_code.code_id = :id',
          ExpressionAttributeValues: { ':id': c.code_id },
        }),
      );
    } catch (e) {
      if ((e as Error).name !== 'ConditionalCheckFailedException') throw e;
      if (ok) throw forbidden(TEXT.codeExpired); // spent by another request meanwhile
    }
  }
  if (!ok) throw forbidden(n >= DELETION_CODE_MAX_ATTEMPTS ? TEXT.codeLast : TEXT.codeWrong(DELETION_CODE_MAX_ATTEMPTS - n));
}

router.on('GET', '/api/account/deletion', async (req) => {
  const m = await loadMember(req);
  const [vaults, listed] = await Promise.all([blockingVaults(m), onMailingList(m.email)]);
  return { blocked_by: vaults.length ? { vaults } : null, pin_required: !!m.pin_hash, mailing_list: listed };
});

router.on('POST', '/api/account/deletion/code', async (req) => {
  const m = await loadMember(req);
  // First, so that no code is sent for a deletion that cannot go ahead.
  const vaults = await blockingVaults(m);
  if (vaults.length) throw vaultExists(vaults);
  await limit(`acctdel-code#${m.user_guid}`, DELETION_CODES_PER_HOUR, 3600, TEXT.codeLimit);
  await limit(`link#email#${m.email}`, SIGN_IN_MAILS_PER_ADDRESS_HOUR, 3600, TEXT.tooMany);
  await limit('link#global', SIGN_IN_MAILS_GLOBAL_HOUR, 3600, TEXT.tooMany);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeId = randomBytes(9).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000) + DELETION_CODE_TTL_S;
  // A new code replaces the old one.
  await setFields(m, { deletion_code: { code_id: codeId, hash: await hashDeletionCode(m.user_guid, codeId, code), expires_at: expiresAt, attempts: 0 } });
  const mail = deletionCodeMail(code);
  try {
    await sendMail(m.email, mail.subject, mail.text);
  } catch (e) {
    console.error('account deletion code mail failed', (e as Error).name); // never the address or the code
    // Never delivered: this code is taken off again.
    await ddb
      .send(
        new UpdateCommand({
          TableName: table.members(),
          Key: { user_guid: m.user_guid },
          UpdateExpression: 'REMOVE deletion_code',
          ConditionExpression: 'deletion_code.code_id = :id',
          ExpressionAttributeValues: { ':id': codeId },
        }),
      )
      .catch((err: Error) => console.error('account deletion code not removed', err.name));
    throw new HttpError(500, 'internal', TEXT.codeNotSent);
  }
  await audit(memberActor(m.user_guid), 'member.deletion_code', m.user_guid);
  return new WithStatus(202, { expires_at: new Date(expiresAt * 1000).toISOString() });
});

router.on('POST', '/api/account/deletion', async (req) => {
  // In this order (§5.4.2): the session and `active`, the phrase, the PIN, the code, the vault.
  const m = await loadMember(req);
  if (req.body.confirm !== ACCOUNT_DELETION_PHRASE) throw badRequest(TEXT.phrase);
  const removeFromList = bool(req.body, 'remove_from_mailing_list');
  const code = str(req.body, 'code', { max: 32 });
  await requirePin(m, req.body.pin);
  await spendCode(m, code);
  const vaults = await blockingVaults(m);
  if (vaults.length) throw vaultExists(vaults);

  const now = Date.now();
  const d: AccountDeletion = {
    deletion_id: newUlid(),
    requested_at: new Date(now).toISOString(),
    deletes_at: new Date(now + ACCOUNT_DELETION_DELAY_MS).toISOString(),
    mailing_list: removeFromList ? 'remove' : 'keep',
  };
  // One conditional write (still `active`): nothing is deleted now.
  await setFields(m, { account_status: 'canceled', delete_after: d.deletes_at, account_deletion: d }, ['deletion_code']);

  // From here the account is canceled. Each step is tried on its own; if
  // any fails the answer is 500 with the account already canceled (the
  // cleanup job disables sign-in and ends the sessions again at each run).
  req.setCookies.push(...clearSessionCookies());
  let failed = false;
  const step = async (name: string, f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      failed = true;
      console.error('account deletion: a step after the request failed', JSON.stringify({ user_guid: m.user_guid, step: name, error: (e as Error).name }));
    }
  };
  await step('audit', () => audit(memberActor(m.user_guid), 'member.deletion_request', m.user_guid, { deletion_id: d.deletion_id, deletes_at: d.deletes_at, mailing_list: d.mailing_list }));
  await step('disable', () => cognito.send(new AdminDisableUserCommand({ UserPoolId: poolId(), Username: m.email })));
  await step('sign_out', () => cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: poolId(), Username: m.email })));
  await pushAccountSnapshot(m.user_guid);
  if (failed) throw new HttpError(500, 'internal', TEXT.deletionFailed);
  return new WithStatus(202, { deletion_id: d.deletion_id, requested_at: d.requested_at, deletes_at: d.deletes_at });
});

/**
 * The confirmation email's link: no session, the token stands in for it
 * (answered without the session check). In reinstate's order: a consistent
 * read; sign-in enabled; the conditional write (still canceled, the same
 * deletion and hash); if that write lost, sign-in disabled again unless the
 * account is active by now. The link is not used up: once the deletion is
 * gone it answers `{cancelled: false}`, and 404 once the account is.
 */
router.on('POST', '/api/account/deletion/cancel-link', async (req) => {
  await limit(`account-deletion-link#${req.ip}`, 20, 15 * 60, TEXT.tooMany);
  const t = parseWithdrawToken(req.body.token);
  if (!t) throw notFound('This link no longer works');
  const r = await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: t.user_guid }, ConsistentRead: true }));
  const m = r.Item as MemberItem | undefined;
  if (!m) throw notFound('This link no longer works');
  const d = m.account_deletion;
  if (m.account_status !== 'canceled' || !d || typeof d.cancel_hash !== 'string' || !sameHex(t.hash, d.cancel_hash)) return { cancelled: false };
  await cognito.send(new AdminEnableUserCommand({ UserPoolId: poolId(), Username: m.email }));
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table.members(),
        Key: { user_guid: m.user_guid },
        UpdateExpression: 'SET account_status = :active, updated_at = :now REMOVE account_deletion, delete_after, deletion_code',
        ConditionExpression: 'account_status = :c AND account_deletion.deletion_id = :id AND account_deletion.cancel_hash = :h',
        ExpressionAttributeValues: { ':active': 'active', ':now': nowIso(), ':c': 'canceled', ':id': d.deletion_id, ':h': d.cancel_hash },
      }),
    );
  } catch (e) {
    // Lost (the job deleted the account, or support cancelled first), or
    // an outcome we cannot know: never leave sign-in enabled on a guess.
    await disableUnlessActive(m.user_guid, m.email);
    if ((e as Error).name === 'ConditionalCheckFailedException') return { cancelled: false };
    throw e;
  }
  await audit(memberActor(m.user_guid), 'member.deletion_cancel', m.user_guid, { deletion_id: d.deletion_id, via: 'link' });
  const mail = deletionCancelledMail('link');
  try {
    await sendMail(m.email, mail.subject, mail.text);
  } catch (e) {
    console.error('account deletion cancel notice failed', (e as Error).name);
  }
  await pushAccountSnapshot(m.user_guid);
  return { cancelled: true };
});

export const handler = memberHandler(router);
