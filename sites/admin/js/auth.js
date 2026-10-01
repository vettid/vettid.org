// The single auth implementation: Cognito hosted UI, authorization code + PKCE (S256).
// Only the PKCE verifier and `state` touch sessionStorage (for the redirect round
// trip); tokens live in this module's memory and nowhere else.

const PENDING_KEY = 'vettid-admin.pkce';
const SCOPE = 'openid email profile';
const REFRESH_LEAD_MS = 2 * 60 * 1000;

let cfg = null;
let tokens = null; // { idToken, refreshToken, exp (ms), email }
let refreshTimer = 0;
let refreshing = null;
let redirecting = false;

export class AuthError extends Error {}

export function configure(config) {
  cfg = config;
}

export function email() {
  return tokens?.email ?? '';
}

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength) {
  return b64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function s256(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

// Claims are read only for expiry/email display; the API verifies the token.
function jwtClaims(jwt) {
  const part = (jwt.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(part + '='.repeat((4 - (part.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

/** Redirect to the hosted UI. The current tab (#route) rides along in `state`. */
export async function login() {
  if (redirecting) return;
  redirecting = true;
  clearSession();
  const verifier = randomString(48);
  const route = location.hash.slice(1);
  const state = randomString(24) + (/^[a-z-]+$/.test(route) ? `.${route}` : '');
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ state, verifier }));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: SCOPE,
    state,
    code_challenge: await s256(verifier),
    code_challenge_method: 'S256',
  });
  location.assign(`${cfg.cognitoDomain}/oauth2/authorize?${q}`);
}

function takePending() {
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Called once at startup. Returns { email } when signed in, or null when a
 * redirect to the hosted UI has started. Throws AuthError on a bad callback.
 */
export async function start() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) {
    await login();
    return null;
  }

  const pending = takePending();
  const state = params.get('state');
  // Strip ?code/&state from the address bar before doing anything else.
  history.replaceState(null, '', location.pathname);

  if (error) {
    throw new AuthError(`Sign-in failed: ${params.get('error_description') || error}`);
  }
  if (!pending || !state || pending.state !== state) {
    throw new AuthError('Sign-in response did not match this browser session (state mismatch). Please sign in again.');
  }

  setTokens(await tokenRequest({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: pending.verifier,
  }));

  const route = state.split('.')[1];
  if (route && /^[a-z-]+$/.test(route)) history.replaceState(null, '', `${location.pathname}#${route}`);
  return { email: tokens.email };
}

async function tokenRequest(fields) {
  let res;
  try {
    res = await fetch(`${cfg.cognitoDomain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new AuthError('Could not reach the sign-in service.');
  }
  if (!res.ok) throw new AuthError(`Token request failed (HTTP ${res.status}).`);
  const body = await res.json();
  if (!body.id_token) throw new AuthError('Token response had no id_token.');
  return body;
}

function setTokens(t) {
  const claims = jwtClaims(t.id_token);
  tokens = {
    idToken: t.id_token,
    // Cognito does not return a new refresh token on refresh; keep the old one.
    refreshToken: t.refresh_token ?? tokens?.refreshToken ?? null,
    exp: Number(claims.exp) * 1000,
    email: claims.email ?? '',
  };
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, Math.max(5000, tokens.exp - Date.now() - REFRESH_LEAD_MS));
}

/** Refresh once (concurrent callers share the attempt). On failure, re-login. */
function refresh() {
  refreshing ??= (async () => {
    try {
      if (!tokens?.refreshToken) throw new AuthError('No refresh token.');
      setTokens(await tokenRequest({
        grant_type: 'refresh_token',
        client_id: cfg.clientId,
        refresh_token: tokens.refreshToken,
      }));
      return true;
    } catch {
      await login();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Bearer token for the API; refreshes first if it is about to expire. */
export async function getIdToken() {
  // Timers are throttled in background tabs, so check expiry on every use.
  if (tokens && tokens.exp - Date.now() < 60 * 1000) await refresh();
  if (!tokens) {
    await login();
    throw new AuthError('Signed out — redirecting to sign-in.');
  }
  return tokens.idToken;
}

function clearSession() {
  clearTimeout(refreshTimer);
  tokens = null;
}

export function signOut() {
  clearSession();
  sessionStorage.removeItem(PENDING_KEY);
  redirecting = true;
  const q = new URLSearchParams({ client_id: cfg.clientId, logout_uri: cfg.redirectUri });
  location.assign(`${cfg.cognitoDomain}/logout?${q}`);
}
