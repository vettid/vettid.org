// Deploy-time settings from /config.json (written by the account site stack,
// lib/stacks/account-site-stack.ts): which stage this is, the public release
// log, where to get the Android app once there is a link, and (staging only)
// the time scale (MEMBER-API 2.8.0 "Staging time scale").
// A missing or unreadable file falls back to what the host name tells us.

let pending = null;

const HTTPS_URL = /^https:\/\/[^\s"<>]+$/;

function fallbackStage() {
  return /(^|\.)staging\./.test(globalThis.location?.hostname ?? '') ? 'staging' : 'prod';
}

export function normalize(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const stage = typeof c.stage === 'string' && /^[a-z][a-z0-9]{0,11}$/.test(c.stage) ? c.stage : fallbackStage();
  const releaseLogUrl = typeof c.release_log_url === 'string' && HTTPS_URL.test(c.release_log_url)
    ? c.release_log_url
    : 'https://vettid.org/security/releases/';
  return {
    stage,
    staging: stage !== 'prod',
    releaseLogUrl,
    /** Google Play (or, in staging, the test build) link; null until one exists. */
    androidAppUrl: typeof c.android_app_url === 'string' && HTTPS_URL.test(c.android_app_url) ? c.android_app_url : null,
    /** 1, or 24 on the staging stage only (config.json's `time_scale`, written only there): 1 day = 1 hour. */
    timeScale: stage === 'staging' && c.time_scale === 24 ? 24 : 1,
  };
}

// ── The staging time scale in texts (STAGING-TIME-SCALE §5.2, §5.3) ─────

export const STAGING_NOTE = 'Staging: 1 day = 1 hour';

/** The durations these pages state, by their production wording, and their real length. */
const SCALED_PHRASES = [
  ['48 hours', 172_800, false],
  ['24 hours', 86_400, false],
  ['24-hour', 86_400, true],
  ['three days', 259_200, false],
];

/** A scaled length in words: whole hours, else minutes (rounded up). */
export function spanWords(seconds, adjective = false) {
  const [n, unit] = seconds % 3600 === 0 ? [seconds / 3600, 'hour'] : [Math.ceil(seconds / 60), 'minute'];
  if (adjective) return `${n}-${unit}`;
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * A text with its scaled durations divided by the time scale ("24 hours" ->
 * "1 hour", "24-hour" -> "1-hour", "48 hours" -> "2 hours", "three days" ->
 * "3 hours" at 24). At scale 1 (production) the text is returned unchanged.
 */
export function scaleText(text, scale) {
  if (scale === 1 || typeof text !== 'string') return text;
  let out = text;
  for (const [phrase, seconds, adjective] of SCALED_PHRASES) {
    out = out.split(phrase).join(spanWords(Math.ceil(seconds / scale), adjective));
  }
  return out.replace(/\b1 (hour|minute) are over/g, '1 $1 is over');
}

/**
 * The site config, or, if /config.json has not answered within `ms`, the
 * defaults (scale 1: the production texts), so that a page never waits on it
 * without a bound.
 */
export function siteConfigWithin(ms = 2500) {
  let timer;
  const fallback = new Promise((resolve) => {
    timer = setTimeout(() => resolve(normalize(null)), ms);
  });
  return Promise.race([siteConfig(), fallback]).finally(() => clearTimeout(timer));
}

export function siteConfig() {
  pending ??= fetch('/config.json', { credentials: 'same-origin', cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(normalize);
  return pending;
}
