/**
 * Vault releases that have a host group (VAULT-RELEASES §7, §8.2, §8.3).
 *
 * One `VettidOrgVaultRelease<N>Stack` per spec: the AMI (EC2 Image Builder,
 * with the release's EIF and parent from its GitHub release, verified), the
 * launch template and the instance group. The specs come from the `host`
 * member of each entry in `vault/releases/<channel>.json`
 * (lib/vault/release-list.ts, W7); this module keeps their shape, checks
 * and the scaler's constants.
 *
 * Adding a release (RUNBOOK "Vault", "Adding a release"): give its entry a
 * `host`, `npx cdk diff VettidOrgVaultRelease<N>Stack`, deploy it. Removing
 * `host` is how a removed release's stack is deleted (§10.3 step 2):
 * `cdk destroy` that stack first, then drop `host`.
 */
export interface VaultReleaseSpec {
  /** The release number N (the channel's own sequence). */
  readonly release: number;
  readonly channel: 'prod' | 'staging';
  /** The signed vettid-vault tag: `release/<channel>/<N>`. */
  readonly tag: string;
  /** The tag's commit (40 hex): measurements.json's `source_commit`; the host files come from it. */
  readonly sourceCommit: string;
  /** PCR0 (96 lowercase hex): checked against measurements.json and `nitro-cli describe-eif`. */
  readonly pcr0: string;
  /** SHA-256 of the release's `measurements.json` asset (which pins the EIF and parent hashes). */
  readonly measurementsSha256: string;
  /** SHA-256 of `deploy/host/SHA256SUMS` at `sourceCommit` (which pins the units and scripts). */
  readonly hostFilesSha256: string;
  /** aws-nitro-enclaves-cli package version installed on the host (the build's is in measurements.json). */
  readonly nitroCliVersion: string;
  /**
   * The Amazon Linux 2023 arm64 base AMI (pinned; a host OS patch is a new
   * base AMI for this release only, never a fleet change, C4).
   */
  readonly baseAmi: string;
  /** Bump to rebuild the AMI with otherwise identical inputs. */
  readonly amiRevision: number;
  /** Group minimum: 1 keeps one instance always on (owner decision O7); 0 is on demand. */
  readonly minInstances: 0 | 1;
  /** Group maximum (≤ the scaler's per-release cap of 2). */
  readonly maxInstances: 1 | 2;
}

/** The scaler's caps (§8.6): at most this many instances per release and in total. */
export const VAULT_SCALER_LIMITS = { perRelease: 2, total: 6, idleMinutes: 30 } as const;

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`);

/** Refuses a malformed entry at synth time (a typo must not reach Image Builder). */
export function validateReleaseSpec(spec: VaultReleaseSpec, channel: 'prod' | 'staging'): void {
  const bad = (what: string) => {
    throw new Error(`vault release ${spec.release} (${spec.channel}): ${what}`);
  };
  if (!Number.isSafeInteger(spec.release) || spec.release < 1 || spec.release > 9999) bad('release must be 1..9999');
  if (spec.channel !== channel) bad(`channel must be ${channel} for this stage`);
  if (spec.tag !== `release/${spec.channel}/${spec.release}`) bad(`tag must be release/${spec.channel}/${spec.release}`);
  if (!HEX(40).test(spec.sourceCommit)) bad('sourceCommit must be 40 lowercase hex');
  if (!HEX(96).test(spec.pcr0) || /^0+$/.test(spec.pcr0)) bad('pcr0 must be 96 lowercase hex, not a debug PCR');
  if (!HEX(64).test(spec.measurementsSha256)) bad('measurementsSha256 must be 64 lowercase hex');
  if (!HEX(64).test(spec.hostFilesSha256)) bad('hostFilesSha256 must be 64 lowercase hex');
  if (!/^\d+\.\d+\.\d+$/.test(spec.nitroCliVersion)) bad('nitroCliVersion must be x.y.z');
  if (!/^ami-[0-9a-f]{8,17}$/.test(spec.baseAmi)) bad('baseAmi must be an AMI id');
  if (!Number.isSafeInteger(spec.amiRevision) || spec.amiRevision < 0 || spec.amiRevision > 999) bad('amiRevision must be 0..999');
  if (![0, 1].includes(spec.minInstances)) bad('minInstances must be 0 or 1');
  if (![1, 2].includes(spec.maxInstances) || spec.maxInstances > VAULT_SCALER_LIMITS.perRelease) bad('maxInstances must be 1 or 2');
  if (spec.minInstances > spec.maxInstances) bad('minInstances > maxInstances');
}

export function validateReleaseList(list: readonly VaultReleaseSpec[], channel: 'prod' | 'staging'): void {
  const seen = new Set<number>();
  const pcrs = new Set<string>();
  for (const r of list) {
    validateReleaseSpec(r, channel);
    if (seen.has(r.release)) throw new Error(`vault release ${r.release} listed twice`);
    if (pcrs.has(r.pcr0)) throw new Error(`vault release ${r.release}: PCR0 already used by another release`);
    seen.add(r.release);
    pcrs.add(r.pcr0);
  }
  const always = list.filter((r) => r.minInstances > 0).reduce((n, r) => n + r.minInstances, 0);
  if (always > VAULT_SCALER_LIMITS.total) throw new Error('always-on minimums exceed the total instance cap');
}

/** The release's instance group name (the host role's lifecycle grant covers `vettid-org-vault-r*`). */
export const releaseGroupThing = (release: number) => `vault-r${release}`;

/** The lifecycle hook the parent's host drains on (vettid-vault deploy/host). */
export const VAULT_DRAIN_HOOK = 'vault-drain';

/** Tags the scaler matches groups by. */
export const SCALER_TAGS = {
  managed: 'vettid:vault-scaler',
  release: 'vettid:vault-release',
  pcr0: 'vettid:vault-pcr0',
} as const;
