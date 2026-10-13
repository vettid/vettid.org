/**
 * Membership requests that are verified and pending but have no withdrawal
 * link (MEMBER-API 2.6.0 "Withdrawing a request"; RUNBOOK "Membership
 * requests"): requests verified before 2.6.0 was deployed, and any whose
 * "We have your request for early access to VettID" email could not be sent.
 *
 *   npx ts-node --transpile-only --prefer-ts-exts scripts/ops/request-mail-backfill.ts [--stage prod|staging] [--profile P]
 *       DRY RUN (the default): counts only. Sends nothing, writes nothing.
 *   ... --send
 *       sends each of them that one email, with their own withdrawal link,
 *       exactly as the members-stream mailer does at verification (same
 *       code, same claim: a request is never mailed twice). THIS EMAILS
 *       REAL PEOPLE: it is the owner's decision, per run.
 *   ... --send --guid <user_guid>
 *       the same for one request only (the id shown on the admin site's
 *       requests page): for a person who asks for their link.
 *
 * Prints counts, never an address, a name or a link. Refuses to run
 * against an account that is not the stage's.
 */
import { execFileSync } from 'node:child_process';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const REGION = 'us-east-1';
const STAGES = {
  prod: { account: '449757308783', profile: 'default', prefix: 'vettid-org', zone: 'vettid.org' },
  staging: { account: '347272280361', profile: 'vault-staging', prefix: 'vettid-org-staging', zone: 'staging.vettid.org' },
} as const;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const stageName = flag('stage') ?? 'prod';
  if (stageName !== 'prod' && stageName !== 'staging') throw new Error('--stage must be prod or staging');
  const stage = STAGES[stageName];
  const profile = flag('profile') ?? stage.profile;
  const send = process.argv.includes('--send');
  const only = flag('guid');
  if (only !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(only)) throw new Error('--guid must be a user_guid');

  const account = execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text', '--profile', profile], { encoding: 'utf8' }).trim();
  if (account !== stage.account) throw new Error(`profile ${profile} is account ${account}, not ${stageName}'s (${stage.account}): refusing`);
  process.env.AWS_PROFILE = profile;
  process.env.AWS_REGION = REGION;
  // What the Lambda's shared code reads (lambda/shared/aws.ts, mail.ts).
  process.env.TABLE_MEMBERS = `${stage.prefix}-members`;
  process.env.SENDER_EMAIL = `no-reply@${stage.zone}`;
  process.env.ACCOUNT_HOST = `account.${stage.zone}`;

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  const rows: { user_guid: string; email: string }[] = [];
  let neverMailed = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: process.env.TABLE_MEMBERS,
        IndexName: 'state-index',
        KeyConditionExpression: '#s = :s',
        FilterExpression: 'email_verified = :t AND account_status = :a AND attribute_not_exists(withdraw_token_hash)',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: { ':s': 'requested', ':t': true, ':a': 'active' },
        ExclusiveStartKey: start,
      }),
    );
    for (const m of r.Items ?? []) {
      rows.push({ user_guid: String(m.user_guid), email: String(m.email) });
      if (!m.request_mail_at) neverMailed++;
    }
    start = r.LastEvaluatedKey;
  } while (start);

  console.log(`${stageName}: verified pending requests without a withdrawal link: ${rows.length}`);
  console.log(`  never mailed (verified before 2.6.0): ${neverMailed}; an earlier send failed: ${rows.length - neverMailed}`);
  if (!send) {
    console.log('dry run: nothing sent, nothing written. Pass --send to email them (the owner decides).');
    return;
  }

  // The Lambda's own claim-then-send (required after the env is set).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sendRequestReceived } = require('../../lambda/jobs/members-stream') as typeof import('../../lambda/jobs/members-stream');
  const counts = { sent: 0, skipped: 0, failed: 0 };
  const chosen = only ? rows.filter((m) => m.user_guid === only) : rows;
  if (only && !chosen.length) console.log('--guid: no verified pending request without a link has that id');
  for (const m of chosen) {
    counts[await sendRequestReceived(m)]++;
    await new Promise((res) => setTimeout(res, 1100)); // SES sandbox: 1 message a second
  }
  console.log(`sent: ${counts.sent}; skipped (changed meanwhile): ${counts.skipped}; failed: ${counts.failed}`);
  if (counts.failed) process.exitCode = 1;
}

main().catch((e: Error) => {
  console.error(`error: ${e.name}: ${e.message}`);
  process.exit(1);
});
