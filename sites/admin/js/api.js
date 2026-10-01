// Fetch wrapper for the admin API (docs/ADMIN-API.md).

const UNREACHABLE = 'Admin API not reachable — is the admin exit node on?';

let base = '';
let tokenFn = async () => '';
let onUnauthorized = () => {};

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function configure({ apiBase, getToken, unauthorized }) {
  base = apiBase.replace(/\/+$/, '');
  tokenFn = getToken;
  onUnauthorized = unauthorized;
}

/** Path segment encoder for ids / emails / codes in URLs. */
export const seg = (v) => encodeURIComponent(String(v));

export async function request(method, path, { body, query } = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const headers = { Authorization: `Bearer ${await tokenFn()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    // A resource-policy 403 from API Gateway usually lacks CORS headers, so
    // from off the exit node it surfaces as a network error, not a status.
    throw new ApiError(0, 'unreachable', UNREACHABLE);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (res.ok) return data;

  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, 'unauthorized', 'Session expired — sending you back through sign-in.');
  }
  if (res.status === 403) {
    // App-level 403s use the {error,message} shape; anything else is the gateway.
    if (data?.error) throw new ApiError(403, data.error, data.message || 'Forbidden.');
    throw new ApiError(403, 'forbidden', `${UNREACHABLE} (HTTP 403)`);
  }
  const code = data?.error ?? 'http_' + res.status;
  const message = data?.message ?? `Request failed (HTTP ${res.status}).`;
  throw new ApiError(res.status, code, message);
}

export const get = (path, query) => request('GET', path, { query });
export const post = (path, body) => request('POST', path, { body });
export const del = (path) => request('DELETE', path);

/**
 * Cursor pagination: const p = pager('/admin/members', {state});
 * await p.next() -> items; p.done is true once the server returns cursor null.
 */
export function pager(path, query = {}) {
  let cursor = null;
  let done = false;
  return {
    get done() {
      return done;
    },
    async next() {
      if (done) return [];
      const page = await get(path, cursor ? { ...query, cursor } : query);
      cursor = page?.cursor ?? null;
      done = !cursor;
      return page?.items ?? [];
    },
  };
}
