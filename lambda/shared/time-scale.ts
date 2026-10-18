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
 * Scaled here: the start-over deletion's 24 h (S14, lambda/member/vault.ts)
 * and the account site PIN's 24 h lock (S15, lambda/shared/pin.ts). Never
 * the daily jobs, the rate limits or retention (§2.2, N9, N12, N13).
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
