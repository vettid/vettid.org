// Deploy-time settings from /config.json (written by the account site stack,
// lib/stacks/account-site-stack.ts): which stage this is, the public release
// log, and where to get the Android app once there is a link.
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
  };
}

export function siteConfig() {
  pending ??= fetch('/config.json', { credentials: 'same-origin', cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(normalize);
  return pending;
}
