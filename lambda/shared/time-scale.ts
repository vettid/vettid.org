/**
 * The staging time scale (MEMBER-API 2.8.0 "Staging time scale";
 * STAGING-TIME-SCALE §3, §4 item 5, §5.3): on staging, 1 day = 1 hour.
 *
 * The staging stack sets `STAGE=staging` and `TIME_SCALE=24` on the
 * functions that own a scaled wait (lib/config.ts, timeScaleEnv); the
 * production stack sets neither. The value is read only when the stage is
 * `staging`, and only 1 or 24 are accepted: anything else, or any other
 * stage, is real time (1).
 *
 * Scaled here: the start-over deletion's 24 h (S14, lambda/member/vault.ts),
 * the account site PIN's 24 h lock (S15, lambda/shared/pin.ts) and the
 * recovery estimates and floors (S5, S6, lambda/member/vault.ts), and the
 * durations the emails about them state (scaledMail). Never the daily jobs,
 * the rate limits or retention (§2.2, N9, N12, N13).
 */
export function timeScale(): 1 | 24 {
  if (process.env.STAGE !== 'staging') return 1;
  return process.env.TIME_SCALE === '24' ? 24 : 1;
}

/**
 * A wait of §2.1 in seconds, divided by the scale when its timer starts and
 * rounded up to a whole second (STAGING-TIME-SCALE §3 rule 1).
 */
export function scaledSeconds(seconds: number): number {
  return Math.ceil(seconds / timeScale());
}

// ── Texts (MEMBER-API 2.8.0: emails take every scaled duration from the
// same number and, on staging, add "Staging: 1 day = 1 hour") ──────────────

export const STAGING_NOTE = 'Staging: 1 day = 1 hour';

/** The durations the emails state, by their production wording, and their real length. */
const SCALED_PHRASES: ReadonlyArray<[string, number]> = [
  ['24 hours', 86_400],
  ['three days', 259_200], // the recovery quiet period (S7), scaled by the vault
];

/** A scaled length in words: whole hours, else minutes (rounded up). */
export function spanWords(seconds: number): string {
  const [n, unit] = seconds % 3600 === 0 ? [seconds / 3600, 'hour'] : [Math.ceil(seconds / 60), 'minute'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * An email text with its scaled durations divided by the scale ("24 hours"
 * -> "1 hour", "three days" -> "3 hours" at 24) and the staging note at the
 * end. At scale 1 (production) the text is returned unchanged.
 */
export function scaledMail(text: string): string {
  const scale = timeScale();
  if (scale === 1) return text;
  let out = text;
  for (const [phrase, seconds] of SCALED_PHRASES) out = out.split(phrase).join(spanWords(Math.ceil(seconds / scale)));
  return `${out}\n\n${STAGING_NOTE}.`;
}
