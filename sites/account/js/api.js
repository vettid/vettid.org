// Fetch wrapper for the member API (docs/MEMBER-API.md).
//
// Same-origin only. The session lives in httpOnly cookies this code never
// sees; we learn whether someone is signed in only from GET /api/account/me.
// Every POST/DELETE carries X-VettID-CSRF: 1. On a 401 from an authenticated
// call we POST /api/auth/refresh once (shared by every call in flight) and
// retry; if that fails too, the visitor is sent to /signin/.

export class ApiError extends Error {
  constructor(status, code, message, retryAfter = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retry_after = retryAfter;
  }
}

const NETWORK_MESSAGE = 'We could not reach VettID. Check your connection and try again.';

async function send(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET' && method !== 'HEAD') headers['X-VettID-CSRF'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', NETWORK_MESSAGE);
  }

  const text = await res.text().catch(() => '');
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (res.ok) return data ?? {};

  let retryAfter = Number(data?.retry_after);
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
    const header = Number(res.headers.get('Retry-After'));
    retryAfter = Number.isFinite(header) && header > 0 ? header : null;
  }
  const code = typeof data?.error === 'string' ? data.error : `http_${res.status}`;
  const message = typeof data?.message === 'string' && data.message ? data.message : defaultMessage(res.status, code);
  throw new ApiError(res.status, code, message, retryAfter);
}

function defaultMessage(status, code) {
  if (code === 'rate_limited' || status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (status === 401) return 'You are not signed in.';
  if (status === 403) return 'That action is not allowed.';
  if (status === 404) return 'We could not find that.';
  if (status >= 500) return 'Something went wrong on our side. Please try again in a few minutes.';
  return 'Something went wrong. Please try again.';
}

// Single-flight refresh: concurrent 401s share one POST /api/auth/refresh.
let refreshing = null;

export function refresh() {
  refreshing ??= send('POST', '/api/auth/refresh')
    .then(() => true, () => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export function goSignIn(reason = 'expired') {
  location.replace(reason ? `/signin/?${encodeURIComponent(reason)}=1` : '/signin/');
}

/**
 * request(method, path, { body, auth, redirect })
 * - auth (default true): on 401, refresh once and retry.
 * - redirect (default true): if still 401 after refresh, go to /signin/.
 *   Pass false to just get the ApiError (e.g. the welcome page probing /me).
 * Public and /api/auth/* calls use auth: false — their 401s mean something
 * specific (bad link, wrong PIN) and must not trigger a refresh.
 */
export async function request(method, path, { body, auth = true, redirect = true } = {}) {
  try {
    return await send(method, path, body);
  } catch (err) {
    if (!auth || !(err instanceof ApiError) || err.status !== 401) throw err;
  }
  if (await refresh()) {
    try {
      return await send(method, path, body);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
    }
  }
  if (redirect) {
    goSignIn('expired');
    // Keep callers from rendering anything while the browser navigates away.
    return new Promise(() => {});
  }
  throw new ApiError(401, 'unauthorized', 'You are not signed in.');
}

export const get = (path, opts) => request('GET', path, opts);
export const post = (path, body, opts) => request('POST', path, { ...opts, body });
export const del = (path, body, opts) => request('DELETE', path, { ...opts, body });

/** Unauthenticated calls (public + /api/auth/*): no refresh, no redirect. */
export const publicPost = (path, body) => request('POST', path, { body, auth: false });

/**
 * True if the non-secret presence cookie (vid_s=1) says a session probably
 * exists. Pages use it to skip the "am I signed in?" probe for visitors who
 * clearly aren't; the API still decides for real.
 */
export function hasSessionHint() {
  try {
    return /(?:^|;\s*)vid_s=1(?:;|$)/.test(document.cookie);
  } catch {
    return false;
  }
}
