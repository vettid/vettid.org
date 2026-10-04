/**
 * Signing and publishing the release manifest (VAULT-RELEASES §6.1, §7,
 * §10.1 steps 9–10; RUNBOOK "Vault", "Publishing a manifest"). The owner
 * runs it; it wraps vettid-vault's `vaultctl manifest` (render, check,
 * sign with KMS key A) and the AWS CLI, and checks every result again with
 * this repository's own code (render, signature under the keys pinned in
 * lib/config.ts).
 *
 *   npx ts-node --transpile-only scripts/vault/manifest.ts status  --channel prod
 *   npx ts-node --transpile-only scripts/vault/manifest.ts sign    --channel prod [--issued-at 2027-01-15T12:00:00Z]
 *   npx ts-node --transpile-only scripts/vault/manifest.ts upload  --channel prod --in local/vault/prod/served-<serial>.json
 *   npx ts-node --transpile-only scripts/vault/manifest.ts publish --channel prod --in local/vault/prod/served-<serial>.json [--no-commit]
 *
 * - `sign` renders the manifest from vault/releases/<channel>.json with the
 *   next serial (above both the served one and `signed_serial`), raises
 *   `signed_serial` in that file first (a serial is never reused, even for
 *   a canary manifest that is never published), signs with key A as the
 *   manifest-signer role, and writes the served document under local/
 *   (gitignored). Nothing is uploaded or served.
 * - `upload` writes the served document to the vault data bucket as
 *   `manifests/<manifest_sha256>.json` (If-None-Match: objects there are
 *   never modified). Only the signer role may write there. A canary
 *   (§10.1 step 9) stops here: the host can hand the manifest to the
 *   enclave, but no app sees it unless it is given the file.
 * - `publish` checks the document again (signature, exact render of the
 *   release file as it is now, successor of the served one), uploads it
 *   (idempotent), confirms the bucket copy exists, and only then writes
 *   the served file and, for production, the release log, and commits
 *   those paths. The site deploy (`npm run deploy:site`) then serves it:
 *   the bucket copy always exists before any app can reference it (M1).
 *
 * Environment:
 *   VAULTCTL                  vaultctl binary (default: vaultctl on PATH;
 *                             build it at a vettid-vault release tag:
 *                             go build -o ~/bin/vaultctl ./cmd/vaultctl)
 *   VAULT_SIGNER_PROFILE      AWS profile for the manifest-signer role
 *                             (default vault-<channel>-manifest-signer)
 *   VAULT_ADMIN_PROFILE       AWS profile of the vault account (default
 *                             vault-<channel>), for reading the bucket copy
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AppConfig, channelVault, resourceName } from '../../lib/config';
import { checkChannel, servedManifest } from '../../lib/vault/manifest-check';
import {
  CHANNELS,
  Channel,
  RELEASE_LOG_DIR,
  SERVED_PATHS,
  consistencyProblems,
  manifestEntries,
  readReleaseFile,
  releaseFilePath,
  renderManifest,
  sha256Hex,
  successorProblems,
} from '../../lib/vault/release-list';
import { ManifestError, verifyServed } from '../../lambda/shared/manifest';
import { writeReleaseLog } from './release-log';

const ROOT = join(__dirname, '..', '..');
const REGION = 'us-east-1';

class UsageError extends Error {}

function args(argv: string[]): { cmd: string; flags: Record<string, string | true> } {
  const [cmd, ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument ${a}`);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[a.slice(2)] = next;
      i++;
    } else flags[a.slice(2)] = true;
  }
  return { cmd: cmd ?? '', flags };
}

interface Ctx {
  channel: Channel;
  stage: string;
  account: string;
  pinned: readonly string[];
  bucket: string;
  keyAlias: string;
  syncFunction: string;
  signerProfile: string;
  adminProfile: string;
  vaultctl: string;
  work: string;
}

function context(flags: Record<string, string | true>): Ctx {
  const channel = flags.channel as Channel;
  if (!CHANNELS.includes(channel)) throw new UsageError('--channel prod|staging is required');
  const { stage, vault } = channelVault(channel);
  if (!vault.manifestKeys.length) throw new Error(`no manifest key is pinned for ${channel} in lib/config.ts`);
  const cfg = { stage } as AppConfig;
  const work = join(ROOT, 'local', 'vault', channel);
  mkdirSync(work, { recursive: true });
  return {
    channel,
    stage,
    account: vault.account,
    pinned: vault.manifestKeys,
    bucket: `${resourceName(cfg, 'vault-data')}-${vault.account}`,
    keyAlias: `alias/${resourceName(cfg, 'vault-manifest')}`,
    syncFunction: resourceName(cfg, 'vault-manifest-sync'),
    signerProfile: process.env.VAULT_SIGNER_PROFILE ?? `vault-${channel}-manifest-signer`,
    adminProfile: process.env.VAULT_ADMIN_PROFILE ?? `vault-${channel}`,
    vaultctl: process.env.VAULTCTL ?? 'vaultctl',
    work,
  };
}

const run = (cmd: string, argv: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, argv, { cwd: ROOT, env: { ...process.env, AWS_REGION: REGION, ...env }, stdio: ['ignore', 'pipe', 'inherit'] }).toString('utf8');

const servedPath = (c: Ctx) => join(ROOT, SERVED_PATHS[c.channel]);
const currentServed = (c: Ctx) => (existsSync(servedPath(c)) ? readFileSync(servedPath(c)) : null);
const nowSeconds = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** -pin files for vaultctl: the keys pinned in lib/config.ts (base64 SPKI). */
function pinArgs(c: Ctx): string[] {
  return c.pinned.flatMap((k, i) => {
    const p = join(c.work, `pin-${i}.b64`);
    writeFileSync(p, `${k}\n`);
    return ['-pin', p];
  });
}

function status(c: Ctx): void {
  const file = readReleaseFile(ROOT, c.channel, c.account);
  const served = currentServed(c);
  const m = served ? servedManifest(served) : null;
  console.log(JSON.stringify({
    channel: c.channel,
    served: m ? { serial: m.serial, issued_at: m.issued_at, releases: m.releases.map((r) => `${r.release} ${r.status}`) } : null,
    signed_serial: file.signed_serial,
    next_serial: Math.max(m?.serial ?? 0, file.signed_serial) + 1,
    release_file: file.releases.map((r) => `${r.release} ${r.status}`),
    bucket: c.bucket,
    key: c.keyAlias,
  }, null, 2));
}

function sign(c: Ctx, flags: Record<string, string | true>): void {
  const file = readReleaseFile(ROOT, c.channel, c.account);
  const entries = manifestEntries(file);
  if (!entries.length) throw new Error(`vault/releases/${c.channel}.json lists no release for a manifest (candidates are left out)`);
  const served = currentServed(c);
  const prev = served ? servedManifest(served) : null;
  const serial = Math.max(prev?.serial ?? 0, file.signed_serial) + 1;
  const issuedAt = typeof flags['issued-at'] === 'string' ? flags['issued-at'] : nowSeconds();
  const ours = renderManifest(serial, issuedAt, entries);
  const problems = [...consistencyProblems(entries, issuedAt), ...(prev ? successorProblems(prev, { serial, releases: entries }) : [])];
  if (problems.length) throw new Error(`refusing to sign:\n  ${problems.join('\n  ')}`);

  // vaultctl renders and checks too; both renders must agree byte for byte.
  const bytesPath = join(c.work, `manifest-${serial}.bin`);
  run(c.vaultctl, ['manifest', 'render', '-releases', releaseFilePath(ROOT, c.channel), '-serial', String(serial), '-issued-at', issuedAt, '-out', bytesPath]);
  if (!readFileSync(bytesPath).equals(ours)) throw new Error('vaultctl and lib/vault/release-list.ts render different manifest bytes; stop and investigate');
  const prevPath = join(c.work, 'previous.json');
  if (served) writeFileSync(prevPath, served);
  run(c.vaultctl, ['manifest', 'check', '-in', bytesPath, ...(served ? ['-previous', prevPath] : [])]);

  // Raise signed_serial before signing (§7: a serial is never reused).
  const listPath = releaseFilePath(ROOT, c.channel);
  const text = readFileSync(listPath, 'utf8');
  const raised = text.replace(/"signed_serial":\s*\d+/, `"signed_serial": ${serial}`);
  if (raised === text && file.signed_serial !== serial) throw new Error('could not raise signed_serial');
  writeFileSync(listPath, raised);

  const out = join(c.work, `served-${serial}.json`);
  run(c.vaultctl, ['manifest', 'sign', '-in', bytesPath, '-kms-key', c.keyAlias, ...pinArgs(c), '-out', out], { AWS_PROFILE: c.signerProfile });
  const m = verifyServed(readFileSync(out), c.pinned);
  if (m.serial !== serial || !Buffer.from(JSON.parse(readFileSync(out, 'utf8')).manifest, 'base64').equals(ours)) throw new Error('the signed document is not the rendered manifest');
  console.log(`signed ${c.channel} manifest serial ${serial} (manifest_sha256 ${m.sha256}): ${relative(ROOT, out)}`);
  console.log(`raised signed_serial to ${serial} in ${relative(ROOT, listPath)}: commit it even if this manifest is never published.`);
  console.log('next: upload (canary) or publish (release).');
}

function readSigned(c: Ctx, flags: Record<string, string | true>) {
  if (typeof flags.in !== 'string') throw new UsageError('--in <served document> is required');
  const bytes = readFileSync(flags.in);
  let m;
  try {
    m = verifyServed(bytes, c.pinned);
  } catch (e) {
    if (e instanceof ManifestError) throw new Error(`${flags.in} does not verify under the pinned ${c.channel} keys: ${e.message}`);
    throw e;
  }
  return { path: flags.in, bytes, m };
}

function upload(c: Ctx, doc: { path: string; m: { sha256: string } }): void {
  const key = `manifests/${doc.m.sha256}.json`;
  try {
    run('aws', ['s3api', 'put-object', '--bucket', c.bucket, '--key', key, '--body', doc.path, '--content-type', 'application/json',
      '--if-none-match', '*', '--profile', c.signerProfile]);
    console.log(`uploaded s3://${c.bucket}/${key}`);
  } catch (e) {
    // 412: the object exists. Objects are named by the manifest bytes' hash,
    // so any copy carries this manifest (a signature by a pinned key).
    if (!/PreconditionFailed|412/.test(String((e as { stderr?: Buffer }).stderr ?? (e as Error).message))) throw e;
    console.log(`s3://${c.bucket}/${key} already exists`);
  }
  run('aws', ['s3api', 'head-object', '--bucket', c.bucket, '--key', key, '--profile', c.adminProfile]);
}

function publish(c: Ctx, flags: Record<string, string | true>): void {
  const doc = readSigned(c, flags);
  const file = readReleaseFile(ROOT, c.channel, c.account);
  const expected = renderManifest(doc.m.serial, doc.m.issued_at, manifestEntries(file));
  if (!expected.equals(Buffer.from(JSON.parse(doc.bytes.toString('utf8')).manifest, 'base64'))) {
    throw new Error(`${doc.path} is not a render of vault/releases/${c.channel}.json as it is now (sign again after editing it)`);
  }
  const served = currentServed(c);
  const problems = checkChannel({ channel: c.channel, file, served: doc.bytes, pinnedKeys: c.pinned, history: served ? [{ commit: 'served', served }] : [] });
  if (problems.length) throw new Error(`refusing to publish:\n  ${problems.join('\n  ')}`);

  upload(c, doc); // the bucket copy first (M1)
  writeFileSync(servedPath(c), doc.bytes);
  const paths = [SERVED_PATHS[c.channel], relative(ROOT, releaseFilePath(ROOT, c.channel))];
  if (c.channel === 'prod') {
    writeReleaseLog(ROOT, servedManifest(doc.bytes), file);
    paths.push(RELEASE_LOG_DIR);
  }
  console.log(`${c.channel} manifest serial ${doc.m.serial} written to ${SERVED_PATHS[c.channel]}`);
  if (flags['no-commit'] !== true) {
    run('git', ['add', '--', ...paths]);
    run('git', ['commit', '-m', `Vault manifest (${c.channel}): serial ${doc.m.serial}`, '--', ...paths]);
    console.log(`committed ${paths.join(', ')}`);
  }
  console.log([
    'next:',
    '  push and merge the commit (CI runs check:manifest),',
    c.channel === 'prod'
      ? '  npm run deploy:site   (serves https://vettid.org/.well-known/vettid/pcr-manifest.json and the release log),'
      : '  npx cdk deploy VettidOrgStageSiteStack -c stage=staging --profile vault-staging   (serves https://staging.vettid.org/.well-known/vettid/pcr-manifest.json),',
    `  aws lambda invoke --function-name ${c.syncFunction} --profile ${c.adminProfile} --region ${REGION} /dev/stdout   (routing rows now, not in 5 minutes).`,
  ].join('\n'));
}

function main(): void {
  const { cmd, flags } = args(process.argv.slice(2));
  const c = context(flags);
  switch (cmd) {
    case 'status':
      return status(c);
    case 'sign':
      return sign(c, flags);
    case 'upload':
      return upload(c, readSigned(c, flags));
    case 'publish':
      return publish(c, flags);
    default:
      throw new UsageError('usage: manifest.ts status|sign|upload|publish --channel prod|staging [--in FILE] [--issued-at T] [--no-commit]');
  }
}

try {
  main();
} catch (e) {
  console.error(e instanceof UsageError ? e.message : `error: ${(e as Error).message}`);
  process.exitCode = e instanceof UsageError ? 2 : 1;
}
