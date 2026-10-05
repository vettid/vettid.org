/**
 * Staging's test mailbox (VettidOrgStageTestMailStack; RUNBOOK "Staging" →
 * "Test mail"): every address at test.staging.vettid.org is received by SES
 * and stored in S3 for 7 days. Test data only; refuses any account other
 * than vettid-vault-staging.
 *
 *   npm run staging:mail -- new-address [--prefix tester]
 *       a fresh random address, tester-<random>@test.staging.vettid.org
 *       (no AWS call)
 *   npm run staging:mail -- wait --to ADDRESS [--since ISO] [--timeout 120] [--subject REGEX]
 *       waits for a message to ADDRESS that arrived after --since (default:
 *       60 s ago), prints JSON {from, to, subject, date, links, text}
 *   npm run staging:mail -- link --to ADDRESS [--match REGEX] [--since ISO] [--timeout 120] [--subject REGEX]
 *       prints only the first link (in the newest matching message) that
 *       matches --match, e.g. '/auth/#t=' or 'email-verification\.'
 *
 * Profile: --profile (default vault-staging-test-mail: the reader role,
 * source_profile vault-staging). Exit codes: 0 found, 2 timed out, 1 error.
 * Nothing is printed but the mail's fields (or the link).
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { ParsedMail, parseMail } from './mime';

export const STAGING_ACCOUNT = '347272280361';
export const TEST_MAIL_DOMAIN = 'test.staging.vettid.org';
export const TEST_MAIL_BUCKET = `vettid-org-staging-test-mail-${STAGING_ACCOUNT}`;
export const TEST_MAIL_PREFIX = 'inbound/';
const REGION = 'us-east-1';
const POLL_MS = 3000;

function args(argv: string[]): { cmd: string; flags: Record<string, string> } {
  const [cmd = '', ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const v = rest[i + 1];
    if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new Error(`${a} needs a value`);
    flags[a.slice(2)] = v;
    i++;
  }
  return { cmd, flags };
}

export function newAddress(prefix = 'tester'): string {
  if (!/^[a-z0-9][a-z0-9.-]{0,30}$/i.test(prefix)) throw new Error('--prefix: letters, digits, dot and dash, up to 31 characters');
  return `${prefix.toLowerCase()}-${randomBytes(6).toString('hex')}@${TEST_MAIL_DOMAIN}`;
}

export function testAddress(v: string | undefined): string {
  const a = String(v ?? '').trim().toLowerCase();
  if (!a.endsWith(`@${TEST_MAIL_DOMAIN}`) || !/^[a-z0-9._%+=-]+@/.test(a)) throw new Error(`--to must be an address at ${TEST_MAIL_DOMAIN}`);
  return a;
}

function regex(v: string | undefined, name: string): RegExp | undefined {
  if (v === undefined) return undefined;
  try {
    return new RegExp(v, 'i');
  } catch {
    throw new Error(`--${name} is not a valid regular expression`);
  }
}

/** Does the message match the wait criteria? */
export function matches(mail: ParsedMail, to: string, subject?: RegExp): boolean {
  return mail.to.includes(to) && (!subject || subject.test(mail.subject));
}

/** The first link matching `match` (any link without one). */
export function firstLink(mail: ParsedMail, match?: RegExp): string | undefined {
  return mail.links.find((l) => !match || match.test(l));
}

async function main(): Promise<number> {
  const { cmd, flags } = args(process.argv.slice(2));
  if (cmd === 'new-address') {
    process.stdout.write(newAddress(flags.prefix) + '\n');
    return 0;
  }
  if (cmd !== 'wait' && cmd !== 'link') {
    throw new Error('usage: mail.ts new-address [--prefix P] | wait --to ADDRESS [--since ISO] [--timeout S] [--subject RE] | link --to ADDRESS [--match RE] [--since ISO] [--timeout S] [--subject RE] [--profile P]');
  }
  const to = testAddress(flags.to);
  const timeout = flags.timeout === undefined ? 120 : Number(flags.timeout);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 900) throw new Error('--timeout must be an integer 1..900 (seconds)');
  const since = flags.since === undefined ? new Date(Date.now() - 60_000) : new Date(flags.since);
  if (Number.isNaN(since.getTime())) throw new Error('--since must be an ISO date-time');
  const subject = regex(flags.subject, 'subject');
  const match = regex(flags.match, 'match');

  const profile = flags.profile ?? 'vault-staging-test-mail';
  const account = execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text', '--profile', profile], { encoding: 'utf8' }).trim();
  if (account !== STAGING_ACCOUNT) throw new Error(`profile ${profile} is account ${account}, not vettid-vault-staging (${STAGING_ACCOUNT}): refusing`);
  process.env.AWS_PROFILE = profile;
  // Made after AWS_PROFILE is set (the SDK reads it then).
  const s3 = new S3Client({ region: REGION });

  const seen = new Map<string, ParsedMail | null>();
  const deadline = Date.now() + timeout * 1000;
  for (;;) {
    // Everything that arrived since --since, newest first.
    const fresh: { key: string; at: number }[] = [];
    let token: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: TEST_MAIL_BUCKET, Prefix: TEST_MAIL_PREFIX, ContinuationToken: token }));
      for (const o of page.Contents ?? []) {
        if (!o.Key || !o.LastModified || o.LastModified.getTime() < since.getTime()) continue;
        if (o.Key.endsWith('/AMAZON_SES_SETUP_NOTIFICATION')) continue;
        fresh.push({ key: o.Key, at: o.LastModified.getTime() });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    fresh.sort((a, b) => b.at - a.at);

    for (const { key } of fresh) {
      if (!seen.has(key)) {
        const obj = await s3.send(new GetObjectCommand({ Bucket: TEST_MAIL_BUCKET, Key: key }));
        let mail: ParsedMail | null = null;
        try {
          mail = parseMail(await obj.Body!.transformToByteArray());
        } catch {
          mail = null; // unparseable: skip it
        }
        seen.set(key, mail);
      }
      const mail = seen.get(key);
      if (!mail || !matches(mail, to, subject)) continue;
      if (cmd === 'wait') {
        const { from, to: rcpt, subject: subj, date, links, text } = mail;
        process.stdout.write(JSON.stringify({ from, to: rcpt, subject: subj, date, links, text }, null, 2) + '\n');
        return 0;
      }
      const link = firstLink(mail, match);
      if (link) {
        process.stdout.write(link + '\n');
        return 0;
      }
    }

    if (Date.now() >= deadline) {
      process.stderr.write(`timed out after ${timeout}s: no ${cmd === 'link' ? 'matching link in a ' : ''}message to ${to} since ${since.toISOString()}\n`);
      return 2;
    }
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, Math.max(0, deadline - Date.now()))));
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
