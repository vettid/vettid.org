/**
 * Test data for the staging copy (W9), which has no admin site or API
 * (RUNBOOK "Staging"). Writes only to the staging account's tables and
 * terms bucket, and refuses to run against any other account.
 *
 *   npm run staging:seed -- invite [--uses N] [--days D] [--note TEXT]
 *       a registration code: a member who requests membership with it is
 *       registered at once (no admin approval)
 *   npm run staging:seed -- terms --file PATH [--title TEXT]
 *       publish membership terms (text + PDF + the `current` row, the same
 *       shape the admin API writes); members must accept them before they
 *       can use the vault
 *
 * Profile: --profile (default vault-staging). Writes go through the AWS SDK
 * as that profile; nothing is printed but codes, versions and hashes.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { inviteCode, nowIso, tsId } from '../../lambda/shared/ids';
import { checkTermsText, normalizeTermsText, renderTermsPdf, sha256Hex } from '../../lambda/shared/terms-pdf';

const STAGING_ACCOUNT = '347272280361';
const REGION = 'us-east-1';
const table = (t: string) => `vettid-org-staging-${t}`;
const TERMS_BUCKET = `vettid-org-staging-terms-${STAGING_ACCOUNT}`;

function args(argv: string[]): { cmd: string; flags: Record<string, string> } {
  const [cmd = '', ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    flags[a.slice(2)] = v;
    i++;
  }
  return { cmd, flags };
}

function int(flags: Record<string, string>, name: string, def: number, min: number, max: number): number {
  const v = flags[name] === undefined ? def : Number(flags[name]);
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`--${name} must be an integer ${min}..${max}`);
  return v;
}

async function main(): Promise<void> {
  const { cmd, flags } = args(process.argv.slice(2));
  if (cmd !== 'invite' && cmd !== 'terms') {
    throw new Error('usage: seed.ts invite [--uses N] [--days D] [--note TEXT] | terms --file PATH [--title TEXT] [--profile P]');
  }
  const profile = flags.profile ?? 'vault-staging';
  const account = execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text', '--profile', profile], { encoding: 'utf8' }).trim();
  if (account !== STAGING_ACCOUNT) throw new Error(`profile ${profile} is account ${account}, not vettid-vault-staging (${STAGING_ACCOUNT}): refusing`);
  process.env.AWS_PROFILE = profile;
  process.env.AWS_REGION = REGION;

  // Clients are made after AWS_PROFILE is set (the SDK reads it then).
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
  const actor = `seed-script (${profile})`;
  const audit = (action: string, subject: string, detail: Record<string, unknown>) => {
    const ts = nowIso();
    return ddb.send(
      new PutCommand({ TableName: table('audit'), Item: { month: ts.slice(0, 7), ts_id: tsId(ts), ts, actor, action, subject, detail }, ConditionExpression: 'attribute_not_exists(ts_id)' }),
    );
  };

  if (cmd === 'invite') {
    const max_uses = int(flags, 'uses', 1, 1, 1000);
    const days = int(flags, 'days', 14, 1, 365);
    const now = nowIso();
    const item = {
      code: inviteCode(),
      note: flags.note ?? 'staging test (seed script)',
      max_uses,
      uses: 0,
      expired: false,
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      created_at: now,
      created_by: actor,
    };
    await ddb.send(new PutCommand({ TableName: table('invites'), Item: item, ConditionExpression: 'attribute_not_exists(code)' }));
    await audit('invite.create', item.code, { max_uses, expires_at: item.expires_at, note: item.note });
    console.log(`registration code ${item.code} (${max_uses} use(s), until ${item.expires_at})`);
    console.log(`request membership with it at https://account.staging.vettid.org/request/`);
    return;
  }

  // terms
  if (!flags.file) throw new Error('terms needs --file PATH (plain text)');
  const s3 = new S3Client({ region: REGION });
  const title = flags.title ?? 'VettID membership terms (staging test)';
  const text = normalizeTermsText(readFileSync(flags.file, 'utf8'));
  if (!text) throw new Error(`${flags.file} is empty`);
  const bad = await checkTermsText(text + title);
  if (bad.length) throw new Error(`characters the PDF font cannot draw: ${bad.join(' ')}`);
  const now = nowIso();
  const version_id = `${now.slice(0, 19).replace(/:/g, '')}-${randomBytes(2).toString('hex')}`;
  const textSha = sha256Hex(text);
  const pdf = await renderTermsPdf({ title, versionId: version_id, text, textSha256: textSha });
  await s3.send(new PutObjectCommand({ Bucket: TERMS_BUCKET, Key: `terms/${version_id}.txt`, Body: text, ContentType: 'text/plain; charset=utf-8' }));
  await s3.send(new PutObjectCommand({ Bucket: TERMS_BUCKET, Key: `terms/${version_id}.pdf`, Body: pdf, ContentType: 'application/pdf' }));
  // Created and published in one go: the admin API's two steps, as one transaction.
  const current = await ddb.send(
    new QueryCommand({
      TableName: table('terms'),
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :c',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':c': 'current' },
    }),
  );
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        ...(current.Items ?? []).map((c) => ({
          Update: {
            TableName: table('terms'),
            Key: { version_id: c.version_id },
            UpdateExpression: 'SET #s = :sup',
            ConditionExpression: '#s = :c',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':sup': 'superseded', ':c': 'current' },
          },
        })),
        {
          Put: {
            TableName: table('terms'),
            Item: {
              version_id,
              title,
              status: 'current',
              sha256: textSha,
              pdf_sha256: sha256Hex(pdf),
              chars: text.length,
              created_at: now,
              created_by: actor,
              published_at: now,
              published_by: actor,
            },
            ConditionExpression: 'attribute_not_exists(version_id)',
          },
        },
      ],
    }),
  );
  await audit('terms.publish', version_id, { sha256: textSha, superseded: (current.Items ?? []).map((c) => c.version_id) });
  console.log(`terms ${version_id} published (sha256 ${textSha})`);
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
