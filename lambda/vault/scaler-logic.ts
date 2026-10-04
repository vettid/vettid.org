/**
 * The vault release scaler's decisions (VAULT-RELEASES §8.6), kept free of
 * I/O so every rule is unit-tested (test/lambda/vault-scaler.test.ts).
 *
 * Inputs are one snapshot: the `vault-releases` rows, the release instance
 * groups (tagged `vettid:vault-scaler`), and each release's live registry
 * instances. Output is what to change: group desired capacities, the
 * scaler's own markers on release rows, and metrics.
 *
 * Rules:
 *  - START: a release with a FRESH start request (the member API records
 *    one at most every 30 s while apps retry, so live demand keeps it
 *    fresh) that is newer than the last start the scaler issued, no live
 *    instance and desired 0 → desired 1, record `start_issued_at`. Only
 *    when the release is routable (known, `available` not false, and not
 *    `removed` unless `rescue: true`) and its group exists. Never above
 *    the per-release cap (and the group's max) or the total cap.
 *  - STOP: a group above its minimum whose live instances all report
 *    `load` 0, with no activity (start request, issued start, or busy
 *    instance) for `idleMinutes` → desired = minimum. The ASG lifecycle
 *    hook drains an instance that took a vault in the race.
 *  - A `removed` release without `rescue` (or one no longer `available`)
 *    goes to its minimum at once.
 *  - Groups whose release has no row (a candidate before its canary row
 *    exists) are operator-managed: never started or stopped. A `canary`
 *    row (an operator's, VAULT-RELEASES §10.1 step 9; the member API routes
 *    it only for canary members) is managed like any routable release, so
 *    the canary starts on demand and stops when idle.
 */

export const LIVE_HEARTBEAT_S = 90;
/** A start request older than this no longer starts anything (apps retry every 30 s). */
export const START_FRESH_S = 300;
/** `busy_at` is refreshed at most this often while an instance holds vaults. */
export const BUSY_REFRESH_S = 300;
/** A start still unserved this long after it was issued is "unfulfilled" (§8.6 alarm). */
export const START_UNFULFILLED_S = 600;

export const PCR0_RE = /^[0-9a-f]{96}$/;

export interface ReleaseRow {
  release: string; // PCR0
  release_number?: number;
  status?: string;
  available?: boolean;
  rescue?: boolean;
  /** ISO-8601 (member API). */
  start_requested_at?: string;
  /** ISO-8601 (scaler). */
  start_issued_at?: string;
  /** ISO-8601 (scaler): last time a live instance had load > 0, or a manual scale-up was first seen. */
  busy_at?: string;
}

export interface Group {
  name: string;
  /** Tag vettid:vault-pcr0. */
  pcr0: string;
  /** Tag vettid:vault-release. */
  releaseNumber: number;
  min: number;
  max: number;
  desired: number;
}

export interface LiveInstance {
  instance_id: string;
  heartbeat_at: number;
  load?: number;
}

export interface Limits {
  perRelease: number;
  total: number;
  idleMinutes: number;
}

export interface Snapshot {
  now: number; // epoch ms
  releases: ReleaseRow[];
  groups: Group[];
  /** Live instances per release PCR0 (heartbeat within LIVE_HEARTBEAT_S). */
  live: Record<string, LiveInstance[]>;
  limits: Limits;
}

export interface Plan {
  setDesired: { group: string; release: string; from: number; to: number; reason: 'start' | 'idle' | 'not_routable' }[];
  markStartIssued: string[];
  markBusy: string[];
  metrics: {
    StartsIssued: number;
    StopsIssued: number;
    /** Fresh start requests that cannot be served: no group, or a cap. */
    StartsBlocked: number;
    /** Starts issued ≥ 10 min ago, still requested, still no live instance. */
    StartsUnfulfilled: number;
    /** 1 if the newest active release keeps an always-on minimum and has no live instance. */
    ActiveMinimumUnmet: number;
    LiveInstances: number;
    DesiredInstances: number;
  };
  /** Human-readable reasons for the log (no member data exists here). */
  notes: string[];
}

const ms = (iso: string | undefined): number | undefined => {
  if (typeof iso !== 'string') return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
};

export const routable = (r: ReleaseRow): boolean =>
  r.available !== false &&
  (r.status === 'active' || r.status === 'deprecated' || r.status === 'retired' || r.status === 'canary' || (r.status === 'removed' && r.rescue === true));

export function plan(s: Snapshot): Plan {
  const { now, limits } = s;
  const out: Plan = {
    setDesired: [],
    markStartIssued: [],
    markBusy: [],
    metrics: { StartsIssued: 0, StopsIssued: 0, StartsBlocked: 0, StartsUnfulfilled: 0, ActiveMinimumUnmet: 0, LiveInstances: 0, DesiredInstances: 0 },
    notes: [],
  };
  const rows = new Map(s.releases.filter((r) => PCR0_RE.test(r.release)).map((r) => [r.release, r]));
  // A group counts only if its tags are consistent with its release row:
  // the PCR0 tag is the row key and the number tag the row's number.
  const groupFor = new Map<string, Group>();
  for (const g of s.groups) {
    if (!PCR0_RE.test(g.pcr0)) {
      out.notes.push(`${g.name}: no valid PCR0 tag, ignored`);
      continue;
    }
    if (groupFor.has(g.pcr0)) {
      out.notes.push(`${g.name}: a second group for the same PCR0, ignored`);
      continue;
    }
    const row = rows.get(g.pcr0);
    if (row && row.release_number !== undefined && row.release_number !== g.releaseNumber) {
      out.notes.push(`${g.name}: release number tag ${g.releaseNumber} ≠ row ${row.release_number}, ignored`);
      continue;
    }
    groupFor.set(g.pcr0, g);
  }
  let total = s.groups.reduce((n, g) => n + Math.max(0, g.desired), 0);
  const desired = new Map(s.groups.map((g) => [g.name, g.desired]));
  const set = (g: Group, release: string, to: number, reason: Plan['setDesired'][number]['reason']) => {
    const from = desired.get(g.name)!;
    if (from === to) return;
    out.setDesired.push({ group: g.name, release, from, to, reason });
    desired.set(g.name, to);
    total += to - from;
    if (to > from) out.metrics.StartsIssued++;
    else out.metrics.StopsIssued++;
  };

  for (const row of rows.values()) {
    const g = groupFor.get(row.release);
    const live = (s.live[row.release] ?? []).filter((i) => typeof i.heartbeat_at === 'number' && i.heartbeat_at * 1000 >= now - LIVE_HEARTBEAT_S * 1000);
    const requested = ms(row.start_requested_at);
    const issued = ms(row.start_issued_at);
    const busyAt = ms(row.busy_at);
    const fresh = requested !== undefined && now - requested <= START_FRESH_S * 1000;
    const newRequest = fresh && (issued === undefined || requested! > issued);
    const isRoutable = routable(row);

    if (!g) {
      if (newRequest && isRoutable) {
        out.metrics.StartsBlocked++;
        out.notes.push(`release ${row.release_number ?? '?'}: start requested but no instance group exists`);
      }
      continue;
    }
    const cur = desired.get(g.name)!;

    if (!isRoutable) {
      if (cur > g.min) {
        set(g, row.release, g.min, 'not_routable');
        out.notes.push(`${g.name}: release is ${row.status}${row.available === false ? ' (unavailable)' : ''}, stopping to ${g.min}`);
      }
      continue;
    }

    const busy = live.some((i) => (i.load ?? 0) > 0);
    if (busy && (busyAt === undefined || now - busyAt >= BUSY_REFRESH_S * 1000)) out.markBusy.push(row.release);

    // START
    if (newRequest && live.length === 0 && cur < 1) {
      const cap = Math.min(limits.perRelease, g.max);
      if (cap < 1 || total + 1 > limits.total) {
        out.metrics.StartsBlocked++;
        out.notes.push(`${g.name}: start blocked by the ${cap < 1 ? 'per-release' : 'total'} cap`);
      } else {
        set(g, row.release, 1, 'start');
        out.markStartIssued.push(row.release);
      }
      continue;
    }

    // Unfulfilled: issued long enough ago, still demanded, still nothing live.
    if (issued !== undefined && live.length === 0 && fresh && now - issued >= START_UNFULFILLED_S * 1000 && cur >= 1) {
      out.metrics.StartsUnfulfilled++;
      out.notes.push(`${g.name}: start issued ${Math.round((now - issued) / 60000)} min ago, no live instance yet`);
    }

    // STOP (idle)
    if (cur > g.min && !busy) {
      const last = Math.max(requested ?? -Infinity, issued ?? -Infinity, busyAt ?? -Infinity);
      if (last === -Infinity) {
        // Scaled up by hand: start the idle clock now.
        out.markBusy.push(row.release);
        out.notes.push(`${g.name}: above minimum with no activity marker, idle clock started`);
      } else if (now - last >= limits.idleMinutes * 60_000) {
        set(g, row.release, g.min, 'idle');
      }
    }
  }

  // The newest active release with an always-on minimum must have a live instance.
  const newestActive = [...rows.values()]
    .filter((r) => r.status === 'active' && r.available !== false && typeof r.release_number === 'number')
    .sort((a, b) => b.release_number! - a.release_number!)[0];
  if (newestActive) {
    const g = groupFor.get(newestActive.release);
    const live = (s.live[newestActive.release] ?? []).filter((i) => i.heartbeat_at * 1000 >= now - LIVE_HEARTBEAT_S * 1000);
    if (g && g.min >= 1 && live.length === 0) out.metrics.ActiveMinimumUnmet = 1;
  }
  out.metrics.LiveInstances = Object.values(s.live).reduce(
    (n, l) => n + l.filter((i) => i.heartbeat_at * 1000 >= now - LIVE_HEARTBEAT_S * 1000).length,
    0,
  );
  out.metrics.DesiredInstances = [...desired.values()].reduce((n, d) => n + Math.max(0, d), 0);
  out.markBusy = [...new Set(out.markBusy)];
  return out;
}
