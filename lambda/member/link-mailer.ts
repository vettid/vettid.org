/**
 * Sends a sign-in link. Invoked asynchronously by POST /api/auth/start (which
 * answers immediately), so response time never reveals whether an address
 * belongs to an account. Silently does nothing for addresses that can't sign
 * in. Limits: per address 5 sent links / hour, and a global cap on links sent
 * per hour (SES sandbox: 200/day).
 */
import { GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'node:crypto';
import { ddb, env, ses } from '../shared/aws';
import { nowIso } from '../shared/ids';
import { sendMail } from '../shared/mail';
import { canSignIn, memberByEmail } from '../shared/members';
import { hit } from '../shared/ratelimit';
import { sha256Hex } from '../shared/terms-pdf';

const LINK_TTL_SECONDS = 15 * 60;
const PER_ADDRESS_PER_HOUR = 5;
const GLOBAL_PER_HOUR = 100;

async function verifiedNow(guid: string, addr: string): Promise<boolean> {
  try {
    const id = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: addr }));
    if (!id.VerifiedForSendingStatus) return false;
  } catch (e) {
    if ((e as Error).name === 'NotFoundException') return false;
    throw e;
  }
  await ddb.send(
    new UpdateCommand({
      TableName: env('TABLE_MEMBERS'),
      Key: { user_guid: guid },
      UpdateExpression: 'SET email_verified = :t, updated_at = :n',
      ConditionExpression: 'attribute_exists(user_guid)',
      ExpressionAttributeValues: { ':t': true, ':n': nowIso() },
    }),
  );
  return true;
}

export const handler = async (event: { email?: string }): Promise<void> => {
  const addr = String(event.email ?? '');
  if (!addr) return;
  const m = await memberByEmail(addr);
  if (!canSignIn(m)) return;
  if (!m.email_verified && !(await verifiedNow(m.user_guid, addr))) return;
  if (!(await hit(`link#email#${addr}`, PER_ADDRESS_PER_HOUR, 3600)).allowed) return;
  if (!(await hit('link#global', GLOBAL_PER_HOUR, 3600)).allowed) {
    console.warn(JSON.stringify({ msg: 'global sign-in link cap reached' }));
    return;
  }
  const token = randomBytes(32).toString('base64url');
  await ddb.send(
    new PutCommand({
      TableName: env('TABLE_MAGIC_LINKS'),
      Item: { token_hash: sha256Hex(token), email: addr, created_at: nowIso(), expires_at: Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS },
    }),
  );
  const link = `https://${env('ACCOUNT_HOST')}/auth/#t=${token}&e=${encodeURIComponent(addr)}`;
  // No member-supplied text (e.g. names) in system email: it could be used to
  // dress up phishing inside a genuine VettID message.
  await sendMail(
    addr,
    'Your VettID sign-in link',
    `Use this link to sign in to your VettID account. It works once and expires in 15 minutes:\n\n${link}\n\n` +
      "If you didn't ask to sign in, ignore this email — nobody can use the link without access to your inbox.\n\n— VettID\n",
  );
};
