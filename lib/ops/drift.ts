/**
 * Production drift: is what is deployed what master says should be?
 * (RUNBOOK "Production drift"; scripts/ops/drift-check.ts runs it.)
 *
 * For every stack in the synthesized app, the template CloudFormation holds
 * (GetTemplate, stage Original) is compared with the one synthesized from
 * master. Lambda code and site content are part of the template through
 * their asset hashes (S3 keys), which are path-independent
 * (lib/constructs/sourcemap-paths.cjs), so a merged code fix that was never
 * deployed shows up as a changed S3Key.
 *
 * Pure functions only; the AWS and git calls live in the script.
 */

/** A CloudFormation template (JSON). */
export type Template = Record<string, unknown>;

export type StackState =
  /** Deployed template equals the synthesized one. */
  | 'in-sync'
  /** Both exist and differ. */
  | 'drift'
  /** In the app (master), not deployed. */
  | 'not-deployed'
  /** Deployed (named like ours) but not in the app. */
  | 'not-in-app'
  /** Could not be compared (API error, stack mid-update, ...). */
  | 'error';

export interface StackResult {
  readonly stackName: string;
  readonly account: string;
  readonly state: StackState;
  /** CloudFormation StackStatus, when deployed. */
  readonly stackStatus?: string;
  /** ISO time of the last update (or creation), when deployed. */
  readonly lastUpdated?: string;
  /** What differs (template paths, or a short description). */
  readonly differences?: readonly string[];
  readonly error?: string;
}

/** Stacks deployed in a checked account count as ours when named like this. */
export const OUR_STACK = /^Vettid/;

/** Differences listed per stack before "… and N more". */
const MAX_DIFFS = 20;

/**
 * The template with what never matters for "is master deployed" removed:
 *  - the CDKMetadata resource and its condition (CDK version analytics);
 *  - non-ASCII characters, folded to `?`: CloudFormation's GetTemplate
 *    returns each non-ASCII character of a deployed template as `?`
 *    (seen for `·`, `→`, `—`, `§`), so the synthesized side must be folded
 *    the same way. Both sides are folded, so the comparison is the same
 *    whichever way the API behaves.
 */
export function normalizeTemplate(t: Template): Template {
  const fold = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(/[^\x00-\x7f]/gu, '?');
    if (Array.isArray(v)) return v.map(fold);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) out[fold(k) as string] = fold((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  const copy = fold(t) as Record<string, any>;
  if (copy.Resources) delete copy.Resources.CDKMetadata;
  if (copy.Conditions) {
    delete copy.Conditions.CDKMetadataAvailable;
    if (Object.keys(copy.Conditions).length === 0) delete copy.Conditions;
  }
  return copy;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Where two normalized templates differ, as `/`-separated paths
 * (e.g. `Resources/AuthFn/Properties/Code/S3Key`). Empty: no drift.
 * Values are not reported (the issue is public; the paths say enough).
 */
export function templateDifferences(synthesized: Template, deployed: Template): string[] {
  const out: string[] = [];
  const walk = (a: unknown, b: unknown, path: string[]) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (isObject(a) && isObject(b)) {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        if (!(k in b)) out.push([...path, k].join('/') + ' (added in master)');
        else if (!(k in a)) out.push([...path, k].join('/') + ' (only in the deployed stack)');
        else walk(a[k], b[k], [...path, k]);
      }
      return;
    }
    out.push(path.join('/') || '(whole template)');
  };
  walk(normalizeTemplate(synthesized), normalizeTemplate(deployed), []);
  return describeDifferences(out, synthesized);
}

/** Paths, with Lambda code changes spelled out (`… (Lambda code)`). */
function describeDifferences(paths: string[], synthesized: Template): string[] {
  const resources = (synthesized.Resources ?? {}) as Record<string, { Type?: string }>;
  return paths.map((p) => {
    const m = /^Resources\/([^/]+)\/Properties\/Code\/S3Key$/.exec(p);
    if (m && resources[m[1]]?.Type === 'AWS::Lambda::Function') return `${p} (Lambda code)`;
    return p;
  });
}

/** Asset paths in resource metadata repeat the S3Key change; drop them from the list. */
function interesting(diffs: readonly string[]): string[] {
  return diffs.filter((d) => !/\/Metadata\/aws:asset:path$/.test(d));
}

/** The result for one stack of the app. `deployed` undefined: not deployed. */
export function compareStack(args: {
  stackName: string;
  account: string;
  synthesized: Template;
  deployed?: { template: Template; stackStatus: string; lastUpdated: string };
}): StackResult {
  const { stackName, account, synthesized, deployed } = args;
  if (!deployed) return { stackName, account, state: 'not-deployed' };
  const base = { stackName, account, stackStatus: deployed.stackStatus, lastUpdated: deployed.lastUpdated };
  if (deployed.stackStatus.endsWith('_IN_PROGRESS')) {
    return { ...base, state: 'error', error: `stack is ${deployed.stackStatus}; check again when it settles` };
  }
  const diffs = interesting(templateDifferences(synthesized, deployed.template));
  // A failed update (UPDATE_ROLLBACK_COMPLETE) keeps the old template, so
  // the comparison above already shows what did not get deployed.
  return diffs.length ? { ...base, state: 'drift', differences: diffs } : { ...base, state: 'in-sync' };
}

/** Problems that must alert (everything but in-sync). */
export function needsAttention(results: readonly StackResult[]): StackResult[] {
  return results.filter((r) => r.state !== 'in-sync');
}

export interface Commit {
  readonly sha: string;
  /** ISO committer date (a squash merge's merge time). */
  readonly date: string;
  readonly subject: string;
}

/** Marker in the issue body: the sorted list of stacks needing attention. */
export function fingerprint(results: readonly StackResult[]): string {
  const keys = needsAttention(results).map((r) => `${r.account}/${r.stackName}:${r.state}`).sort();
  return `<!-- drift:${keys.join(',')} -->`;
}

const LABEL: Record<StackState, string> = {
  'in-sync': 'in sync',
  drift: 'differs from master',
  'not-deployed': 'in master, not deployed',
  'not-in-app': 'deployed, not in master',
  error: 'not checked',
};

/**
 * Markdown for the job summary and the "Production drift" issue.
 * commitsSince: per stack (`account/name`), master's commits after the
 * stack's last update, newest first.
 */
export function renderReport(args: {
  results: readonly StackResult[];
  commitsSince: Readonly<Record<string, readonly Commit[]>>;
  now: Date;
  head: string;
  runUrl?: string;
}): string {
  const { results, commitsSince, now, head, runUrl } = args;
  const bad = needsAttention(results);
  const lines: string[] = [];
  lines.push(fingerprint(results));
  if (!bad.length) {
    lines.push(`Production matches master (\`${head}\`): ${results.length} stacks compared, no drift.`);
  } else {
    lines.push(
      `**${bad.length} of ${results.length} production stacks** do not match master (\`${head}\`). ` +
        'Something merged is not deployed (or something deployed is not merged). Deploy it, or explain here why not ' +
        '(RUNBOOK "Production drift").',
    );
    for (const r of bad) {
      lines.push('', `### ${r.stackName} (${r.account}): ${LABEL[r.state]}`);
      if (r.lastUpdated) {
        const days = Math.floor((now.getTime() - Date.parse(r.lastUpdated)) / 86_400_000);
        lines.push(`Last deployed ${r.lastUpdated} (${days} day${days === 1 ? '' : 's'} ago), status \`${r.stackStatus}\`.`);
      }
      if (r.error) lines.push(`Error: ${r.error}`);
      if (r.differences?.length) {
        lines.push('', 'Differences (synthesized from master vs deployed):');
        for (const d of r.differences.slice(0, MAX_DIFFS)) lines.push(`- \`${d}\``);
        if (r.differences.length > MAX_DIFFS) lines.push(`- … and ${r.differences.length - MAX_DIFFS} more`);
      }
      const commits = commitsSince[`${r.account}/${r.stackName}`];
      if (commits?.length) {
        const oldest = commits[commits.length - 1];
        const waiting = Math.floor((now.getTime() - Date.parse(oldest.date)) / 86_400_000);
        lines.push('', `Merged to master since that deploy (${commits.length}; oldest ${waiting} day${waiting === 1 ? '' : 's'} ago):`);
        for (const c of commits.slice(0, MAX_DIFFS)) lines.push(`- ${c.sha} ${c.date.slice(0, 10)} ${c.subject}`);
        if (commits.length > MAX_DIFFS) lines.push(`- … and ${commits.length - MAX_DIFFS} more`);
      }
    }
  }
  const ok = results.filter((r) => r.state === 'in-sync').map((r) => r.stackName);
  if (ok.length && bad.length) lines.push('', `In sync: ${ok.join(', ')}.`);
  lines.push('', `Checked ${now.toISOString()}${runUrl ? ` ([run](${runUrl}))` : ''}.`);
  return lines.join('\n') + '\n';
}
