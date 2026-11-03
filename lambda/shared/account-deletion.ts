/**
 * Deleting a VettID account (MEMBER-API 2.14.0 "Deleting the account";
 * ACCOUNT-ADMIN-PLAN §5.4): the record on the member row, the email code,
 * the cancel link, and every text the member is sent or shown (§5.4.6), in
 * one place so that the routes, the mailer, the cleanup job, the admin API
 * and the tests use the same words.
 *
 * Never log what this module makes: a code, a token, a link or an address.
 */
import { AdminDisableUserCommand, AdminEnableUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cognito, ddb, env, table } from './aws';
import type { MemberItem } from './model';
import { secret } from './secrets';

/** The phrase the member types (exact, as `delete my vault` for the start-over). */
export const ACCOUNT_DELETION_PHRASE = 'delete my account';
/** The account is deleted at the first daily run from this long after the request. */
export const ACCOUNT_DELETION_DELAY_MS = 7 * 86_400_000;

/** The email code: 6 digits, 15 minutes, 5 attempts, 3 codes an hour per account. */
export const DELETION_CODE_TTL_S = 15 * 60;
export const DELETION_CODE_MAX_ATTEMPTS = 5;
export const DELETION_CODES_PER_HOUR = 3;

/**
 * On the member row while the deletion is scheduled. Everything that ends
 * the deletion (the cancel link, an admin's reinstate, the cleanup job)
 * removes the map, so the mail fields go with it.
 */
export interface AccountDeletion {
  deletion_id: string;
  requested_at: string;
  deletes_at: string;
  mailing_list: 'remove' | 'keep';
  /** SHA-256 (hex) of the cancel link's secret; written by the mailer with its claim. */
  cancel_hash?: string;
  /** When the mailer claimed the confirmation's send. */
  mail_claimed_at?: string;
  /** When SES accepted the confirmation: the cleanup job deletes nothing without it. */
  mailed_at?: string;
  /** Failed sends of the confirmation; at DELETION_MAIL_MAX_FAILURES the mailer stops trying. */
  mail_failures?: number;
}

/** The email code on the member row: only its HMAC, never the code. */
export interface DeletionCode {
  code_id: string;
  hash: string;
  /** Epoch seconds. */
  expires_at: number;
  /** Attempts spent (each reserved with a conditional update before the compare). */
  attempts: number;
}

/**
 * HMAC-SHA-256 under the PIN pepper over `"acctdel-code" || 0x00 ||
 * user_guid || 0x00 || code_id || 0x00 || code`. The label and the
 * separators mean it can never equal a PIN's HMAC (lambda/shared/pin.ts,
 * `<guid>:<pin>`).
 */
export async function hashDeletionCode(userGuid: string, codeId: string, code: string): Promise<string> {
  const pepper = await secret(env('PIN_PEPPER_SECRET_ARN'));
  return createHmac('sha256', pepper).update(['acctdel-code', userGuid, codeId, code].join('\u0000')).digest('hex');
}

/** Constant-time compare of two hex digests. */
export function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * After a cancel's conditional write lost (the cancel link, an admin's
 * reinstate): sign-in, enabled just before it, is disabled again unless the
 * row is active by now (a consistent read). A user that is gone went with
 * the account. Throws when it cannot be done.
 */
export async function disableUnlessActive(userGuid: string, email: string): Promise<void> {
  const r = await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: userGuid }, ConsistentRead: true }));
  if ((r.Item as MemberItem | undefined)?.account_status === 'active') return;
  try {
    await cognito.send(new AdminDisableUserCommand({ UserPoolId: env('MEMBER_POOL_ID'), Username: email }));
  } catch (e) {
    if ((e as Error).name !== 'UserNotFoundException') throw e;
  }
}

/**
 * The other side of the same race: after something disabled sign-in on a
 * row it read as canceled (the cleanup job's re-disable), sign-in is
 * enabled again if the row is active by now (a consistent read), because a
 * cancel or a reinstate may have enabled it and written `active` in
 * between. A user that is gone went with the account. Throws when it
 * cannot be done.
 */
export async function enableIfActive(userGuid: string, email: string): Promise<void> {
  const r = await ddb.send(new GetCommand({ TableName: table.members(), Key: { user_guid: userGuid }, ConsistentRead: true }));
  if ((r.Item as MemberItem | undefined)?.account_status !== 'active') return;
  try {
    await cognito.send(new AdminEnableUserCommand({ UserPoolId: env('MEMBER_POOL_ID'), Username: email }));
  } catch (e) {
    if ((e as Error).name !== 'UserNotFoundException') throw e;
  }
}

/** The cancel page; the token is in the fragment, so no server or log sees it. */
export const deletionCancelLink = (accountHost: string, token: string): string => `https://${accountHost}/account/delete/cancel/#t=${token}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * When the account is deleted: the first daily run (07:00 UTC) at or after
 * `deletes_at`, written as "10 November 2026, 07:00 UTC".
 */
export function deletionWhen(deletesAtIso: string): string {
  const run = new Date(firstDeletionRun(deletesAtIso));
  return `${run.getUTCDate()} ${MONTHS[run.getUTCMonth()]} ${run.getUTCFullYear()}, 07:00 UTC`;
}

/** The scheduled daily run (07:00 UTC) at or after `deletes_at`, in epoch ms (NaN for no date). */
export function firstDeletionRun(deletesAtIso: string): number {
  const d = new Date(deletesAtIso);
  const run = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 7, 0, 0);
  return run < d.getTime() ? run + 86_400_000 : run;
}

/** The scheduled daily run (07:00 UTC) a run started at `nowMs` belongs to: the last 07:00 UTC at or before it. */
export function scheduledRun(nowMs: number): number {
  const d = new Date(nowMs);
  const run = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 7, 0, 0);
  return run > nowMs ? run - 86_400_000 : run;
}

/** The confirmation is not tried again after this many failed sends (the cleanup job then holds the account, reason `mail`). */
export const DELETION_MAIL_MAX_FAILURES = 3;

// ---- emails (§5.4.6; plain text, no names) ------------------------------------------

export interface Mail {
  subject: string;
  text: string;
}

export const deletionCodeMail = (code: string): Mail => ({
  subject: 'Your VettID account deletion code',
  text:
    `Someone signed in to your VettID account asked to delete it. If it was you, enter this code on the page: ${code}. ` +
    "It works for 15 minutes. If it wasn't you, don't share the code. Your account stays as it is, but someone may be able " +
    'to sign in as you: write to support@vettid.org.\n',
});

/** `list`: what the mailing list does with the address (`none`: the address is not on it). */
export const deletionConfirmationMail = (when: string, list: 'remove' | 'keep' | 'none', link: string): Mail => ({
  subject: 'Your VettID account will be deleted',
  text:
    `Your VettID account is closed, and will be deleted after ${when}. That deletes your membership, your sign-in, ` +
    'your subscription and your email address from VettID' +
    (list === 'remove' ? ', and removes you from the VettID mailing list' : list === 'keep' ? '; your address stays on the mailing list' : '') +
    '. To keep your account, use this link until then:\n\n' +
    `${link}\n\n` +
    "If you didn't ask for this, use the link and write to support@vettid.org.\n",
});

export const deletionHeldMail = (): Mail => ({
  subject: 'Your VettID account was not deleted yet',
  text:
    'Your VettID account is closed and was due to be deleted, but a vault of yours still exists (or its setup was never ' +
    "finished), so nothing has been deleted. While your account is closed your vault can't be opened, so: use the link " +
    'from our earlier email to keep your account, delete your vault in the VettID app (or write to support@vettid.org to ' +
    'end an unfinished setup), then delete your account again. We check every day, and nothing is deleted while a vault is left.\n',
});

export const deletionCancelledMail = (via: 'link' | 'admin'): Mail => ({
  subject: 'Your VettID account was not deleted',
  text:
    via === 'link'
      ? 'You cancelled the deletion of your VettID account. You can sign in again as before.\n'
      : 'VettID support cancelled the deletion of your VettID account, as you asked. You can sign in again as before. ' +
        'If you did not ask for this, write to support@vettid.org.\n',
});

// ---- answers (§5.4.6 error texts) ---------------------------------------------------

export const TEXT = {
  phrase: 'Type delete my account exactly as shown.',
  codeWrong: (n: number) => `That code isn't right. You have ${n} more tries.`,
  codeLast: "That code isn't right, and it can't be used again. Ask for a new code.",
  codeExpired: 'That code has expired or was already used. Ask for a new code.',
  codeLimit: "You've asked for 3 codes in the last hour. Try again later.",
  tooMany: 'Too many tries. Wait a few minutes and try again.',
  codeNotSent: "We couldn't send the code. Nothing has changed. Try again in a few minutes, or write to support@vettid.org.",
  deletionFailed:
    "Something went wrong, and your account may already be closed. Don't try again: check your email for the cancel link. " +
    'If no email comes within an hour, write to support@vettid.org.',
  cancelFailed: "We couldn't cancel the deletion just now. Try the link again in a few minutes; it keeps working until your account is deleted.",
  vault:
    'You still have a vault. Your VettID account can be deleted only after your vault. Delete your vault in the VettID app, ' +
    'or here with Delete my vault and start over, which takes 24 hours. Then come back to this page.',
  enrolling:
    "Your vault setup isn't finished. Your VettID account can be deleted only when no vault is left. Finish setting up your " +
    'vault in the VettID app and then delete it there, or write to support@vettid.org to end the setup.',
} as const;

// ---- metrics (EMF, no PutMetricData right) --------------------------------------------

/** One EMF line in the member API's namespace, as the cleanup job's removal metrics. */
export function deletionEmf(metric: 'AccountDeletionsHeld' | 'AccountDeletionMailFailures', value: number, now: number): string {
  return JSON.stringify({
    _aws: { Timestamp: now, CloudWatchMetrics: [{ Namespace: 'VettID/MemberApi', Dimensions: [[]], Metrics: [{ Name: metric, Unit: 'Count' }] }] },
    [metric]: value,
  });
}
