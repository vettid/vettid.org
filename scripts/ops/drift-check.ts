/**
 * Production drift check (RUNBOOK "Production drift"; logic in lib/ops/drift.ts).
 *
 * Compares the templates synthesized from this checkout (`cdk.out`) with the
 * ones CloudFormation holds. Read-only: CloudFormation ListStacks and
 * GetTemplate, nothing else. Synthesize first, into the default `cdk.out`:
 *
 *   npx cdk synth --quiet
 *   npm run drift -- check --account 449757308783 --profile default    --out local/drift-main.json
 *   npm run drift -- check --account 369484479783 --profile vault-prod --out local/drift-vault.json
 *   npm run drift -- report local/drift-main.json local/drift-vault.json
 *
 * `report` prints the markdown report and exits 1 when anything needs
 * attention. With `--issue` (CI) it also opens, updates or closes the
 * "Production drift" issue through the `gh` CLI (GH_TOKEN, GITHUB_REPOSITORY);
 * with `--summary <file>` it appends the report there ($GITHUB_STEP_SUMMARY).
 */
import { CloudFormationClient, GetTemplateCommand, ListStacksCommand, StackSummary } from '@aws-sdk/client-cloudformation';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Commit, OUR_STACK, StackResult, Template, compareStack, fingerprint, needsAttention, renderReport } from '../../lib/ops/drift';

const ROOT = join(__dirname, '..', '..');
const ISSUE_TITLE = 'Production drift';

interface Args {
  readonly cmd: string;
  readonly flags: Record<string, string | true>;
  readonly files: string[];
}

function parseArgs(argv: string[]): Args {
  const [cmd = '', ...rest] = argv;
  const flags: Record<string, string | true> = {};
  const files: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) files.push(a);
    else if (a === '--issue') flags.issue = true;
    else flags[a.slice(2)] = rest[++i] ?? '';
  }
  return { cmd, flags, files };
}

interface AssemblyStack {
  readonly stackName: string;
  readonly account: string;
  readonly region: string;
  readonly templateFile: string;
}

/** The app's stacks from a synthesized cloud assembly (manifest.json). */
function assemblyStacks(dir: string): AssemblyStack[] {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const out: AssemblyStack[] = [];
  for (const [id, art] of Object.entries<any>(manifest.artifacts ?? {})) {
    if (art.type !== 'aws:cloudformation:stack') continue;
    const m = /^aws:\/\/(\d{12})\/([a-z0-9-]+)$/.exec(String(art.environment));
    if (!m) throw new Error(`${id}: environment ${art.environment} is not pinned to an account and region`);
    out.push({ stackName: art.properties?.stackName ?? id, account: m[1], region: m[2], templateFile: join(dir, art.properties.templateFile) });
  }
  return out;
}

async function listStacks(cfn: CloudFormationClient): Promise<StackSummary[]> {
  const all: StackSummary[] = [];
  let NextToken: string | undefined;
  do {
    const page = await cfn.send(new ListStacksCommand({ NextToken }));
    all.push(...(page.StackSummaries ?? []).filter((s) => s.StackStatus !== 'DELETE_COMPLETE'));
    NextToken = page.NextToken;
  } while (NextToken);
  return all;
}

async function check(flags: Args['flags']): Promise<number> {
  const account = String(flags.account ?? '');
  const outFile = String(flags.out ?? '');
  if (!/^\d{12}$/.test(account) || !outFile) {
    console.error('usage: check --account <12 digits> --out <file> [--profile <name>] [--assembly cdk.out]');
    return 2;
  }
  const stacks = assemblyStacks(resolve(ROOT, String(flags.assembly ?? 'cdk.out'))).filter((s) => s.account === account);
  if (!stacks.length) {
    console.error(`no stacks for account ${account} in the assembly (synthesize first: npx cdk synth --quiet)`);
    return 2;
  }
  const results: StackResult[] = [];
  for (const region of [...new Set(stacks.map((s) => s.region))]) {
    const cfn = new CloudFormationClient({ region, ...(typeof flags.profile === 'string' ? { profile: flags.profile } : {}) });
    const deployed = await listStacks(cfn);
    // The credentials must be the account's: every stack ARN names it.
    const foreign = deployed.find((s) => !String(s.StackId).includes(`:${account}:stack/`));
    if (foreign || !deployed.length) {
      throw new Error(`credentials are not for account ${account} (${foreign ? `saw ${foreign.StackId}` : 'no stacks at all'})`);
    }
    const byName = new Map(deployed.map((s) => [s.StackName!, s]));
    for (const s of stacks.filter((x) => x.region === region)) {
      const synthesized = JSON.parse(readFileSync(s.templateFile, 'utf8')) as Template;
      const d = byName.get(s.stackName);
      if (!d) {
        results.push(compareStack({ stackName: s.stackName, account, synthesized }));
        continue;
      }
      try {
        const got = await cfn.send(new GetTemplateCommand({ StackName: s.stackName, TemplateStage: 'Original' }));
        results.push(compareStack({
          stackName: s.stackName,
          account,
          synthesized,
          deployed: {
            template: JSON.parse(got.TemplateBody ?? '{}') as Template,
            stackStatus: String(d.StackStatus),
            lastUpdated: (d.LastUpdatedTime ?? d.CreationTime!).toISOString(),
          },
        }));
      } catch (e) {
        results.push({ stackName: s.stackName, account, state: 'error', error: (e as Error).message });
      }
    }
    const inApp = new Set(stacks.map((s) => s.stackName));
    for (const d of deployed) {
      if (OUR_STACK.test(d.StackName!) && !inApp.has(d.StackName!)) {
        results.push({
          stackName: d.StackName!,
          account,
          state: 'not-in-app',
          stackStatus: String(d.StackStatus),
          lastUpdated: (d.LastUpdatedTime ?? d.CreationTime!).toISOString(),
        });
      }
    }
  }
  writeFileSync(outFile, JSON.stringify(results, null, 2) + '\n');
  for (const r of results) console.log(`${r.state.padEnd(12)} ${account} ${r.stackName}`);
  return 0;
}

const git = (args: string[]) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();

/** Master's commits after `since`, newest first (first parent: one per squash merge). */
function commitsSince(since: string): Commit[] {
  const out = git(['log', '--first-parent', `--since=${since}`, '--format=%h%x09%cI%x09%s', 'HEAD']);
  return out.split('\n').filter(Boolean).map((l) => {
    const [sha, date, ...subject] = l.split('\t');
    return { sha, date, subject: subject.join('\t') };
  });
}

const gh = (args: string[]) => execFileSync('gh', args, { encoding: 'utf8' }).trim();

function updateIssue(results: StackResult[], report: string, head: string): void {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('--issue needs GITHUB_REPOSITORY (and GH_TOKEN)');
  const open = (JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--search', `"${ISSUE_TITLE}" in:title`, '--json', 'number,title,body'])) as { number: number; title: string; body: string }[])
    .filter((i) => i.title === ISSUE_TITLE);
  const bodyFile = join(mkdtempSync(join(tmpdir(), 'drift-')), 'body.md');
  writeFileSync(bodyFile, report);
  const bad = needsAttention(results);
  if (!bad.length) {
    for (const i of open) {
      gh(['issue', 'comment', String(i.number), '--repo', repo, '--body', `Production matches master (\`${head}\`) again. Closing.`]);
      gh(['issue', 'close', String(i.number), '--repo', repo]);
    }
    return;
  }
  if (!open.length) {
    gh(['issue', 'create', '--repo', repo, '--title', ISSUE_TITLE, '--body-file', bodyFile]);
    return;
  }
  const [issue] = open;
  gh(['issue', 'edit', String(issue.number), '--repo', repo, '--body-file', bodyFile]);
  // A comment (a notification) only when the set of stacks changes; the body is always current.
  if (!issue.body.includes(fingerprint(results))) {
    const list = bad.map((r) => `${r.stackName} (${r.state})`).join(', ');
    gh(['issue', 'comment', String(issue.number), '--repo', repo, '--body', `Changed: now ${bad.length} stack(s) need attention: ${list}.`]);
  }
}

function report(args: Args): number {
  if (!args.files.length) {
    console.error('usage: report [--issue] [--summary <file>] <result files from check...>');
    return 2;
  }
  const results = args.files.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')) as StackResult[]);
  const commits: Record<string, Commit[]> = {};
  for (const r of needsAttention(results)) {
    if (r.lastUpdated && r.state !== 'not-in-app') commits[`${r.account}/${r.stackName}`] = commitsSince(r.lastUpdated);
  }
  const head = git(['rev-parse', '--short', 'HEAD']);
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
  const md = renderReport({ results, commitsSince: commits, now: new Date(), head, runUrl });
  console.log(md);
  if (typeof args.flags.summary === 'string') appendFileSync(args.flags.summary, `## ${ISSUE_TITLE}\n\n${md}`);
  if (args.flags.issue) updateIssue(results, md, head);
  return needsAttention(results).length ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === 'check') return check(args.flags);
  if (args.cmd === 'report') return report(args);
  console.error('usage: drift-check.ts check|report ... (see the header of scripts/ops/drift-check.ts)');
  return 2;
}

main().then((code) => process.exit(code), (e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
