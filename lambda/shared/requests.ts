/**
 * Membership requests: the withdrawal link, the request emails and the
 * retention periods (MEMBER-API 2.6.0 "Withdrawing a request", "Retention").
 */
import { createHash, randomBytes } from 'node:crypto';

/** A declined request is deleted this long after the decline. */
export const DECLINED_DAYS = 30;
/** A removal that keeps failing is retried this long, then given up on (the row goes; SES and Cognito are left). */
export const REMOVAL_GIVE_UP_DAYS = 7;

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

// <user_guid>.<32 random bytes, base64url>: the id finds the row with one
// conditional write (no index, no pointer row to clean up); the secret is
// what authorizes. Only the secret's hash is stored.
const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export function newWithdrawToken(userGuid: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { token: `${userGuid}.${secret}`, hash: sha256Hex(secret) };
}

/** The row a token names and the hash it must match; null for anything that is not a token. */
export function parseWithdrawToken(token: unknown): { user_guid: string; hash: string } | null {
  if (typeof token !== 'string') return null;
  const m = TOKEN_RE.exec(token);
  return m ? { user_guid: m[1], hash: sha256Hex(m[2]) } : null;
}

/** The page with the one button. The token is in the fragment: no server or log sees it. */
export const withdrawLink = (accountHost: string, token: string): string => `https://${accountHost}/request/withdraw/#w=${token}`;

/**
 * The project's own addresses (and staging's test mailbox): their SES
 * identities are never deleted, and IAM refuses it for sub-domains anyway.
 */
export const ownAddress = (email: string): boolean => /@([a-z0-9-]+\.)*vettid\.org$/.test(email);

/**
 * "We have your request": sent once, when the address has passed SES
 * verification, and the only mail a pending request gets from us. No
 * member-supplied text (names) in system email.
 */
export function requestReceivedMail(link: string): { subject: string; text: string } {
  return {
    subject: 'We have your VettID membership request',
    text:
      'Your email address is confirmed, and we have your request to join VettID. ' +
      "An administrator will review it. If it is approved, we'll email you when your account is ready.\n\n" +
      'If you change your mind, you can withdraw the request here. That deletes it, with your name and email address:\n\n' +
      `${link}\n\n` +
      "The link works for as long as we hold the request. If you didn't ask to join VettID, use it to remove the request.\n\n" +
      '— VettID\n',
  };
}

const ADMIN_SITE = 'https://admin.vettid.org';

/**
 * Notices to the administrative mailbox carry no name and no address (owner
 * decision of 2026-10-12, as for the mailing list): the admin site, reached
 * only from VettID's own network, is where the request is read.
 */
export function adminNotice(kind: 'arrived' | 'arrived_verified' | 'verified' | 'registered'): { subject: string; text: string } {
  switch (kind) {
    case 'registered':
      return {
        subject: 'VettID: someone registered with a registration code',
        text: `Someone registered with a registration code. The account exists; nothing to review.\nadmin: ${ADMIN_SITE}/#members\n`,
      };
    case 'verified':
      return {
        subject: 'VettID: a membership request was verified',
        text: `The email address of a membership request was verified. It can be reviewed now.\nadmin: ${ADMIN_SITE}/#requests\n`,
      };
    case 'arrived_verified':
      return {
        subject: 'VettID: a membership request arrived',
        text: `A membership request arrived. Its email address is already verified: it can be reviewed now.\nadmin: ${ADMIN_SITE}/#requests\n`,
      };
    default:
      return {
        subject: 'VettID: a membership request arrived',
        text:
          'A membership request arrived. Its email address is not verified yet: there is nothing to do until it is ' +
          `(another notice says so).\nadmin: ${ADMIN_SITE}/#requests\n`,
      };
  }
}
