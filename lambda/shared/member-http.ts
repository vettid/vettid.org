import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { timingSafeEqual } from 'node:crypto';
import { cognito, env } from './aws';
import { HttpError, Router, badRequest } from './http';
import { secret } from './secrets';

/**
 * Member API plumbing (HTTP API, payload v2), served same-origin behind
 * account.vettid.org's CloudFront:
 *  - only requests carrying CloudFront's origin-verify header are served
 *    (the execute-api URL is public; this makes it useless to call directly)
 *  - POST/DELETE require `X-VettID-CSRF: 1`
 *  - the session is httpOnly cookies; tokens never reach JavaScript
 */

export type MemberRequest = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  cookies: Record<string, string>;
  /** Rate-limit key for the viewer: IPv4 address, or the IPv6 /64. */
  ip: string;
  event: APIGatewayProxyEventV2;
  /** Cookies to set on the response (complete Set-Cookie values). */
  setCookies: string[];
};

// ---- cookies ------------------------------------------------------------------

const SESSION_COOKIE_BASE = 'Secure; HttpOnly; SameSite=Strict';

export const cookie = {
  set(name: string, value: string, path: string, maxAgeSeconds: number, opts: { scriptReadable?: boolean } = {}): string {
    if (!/^[A-Za-z0-9._~+/=-]*$/.test(value)) throw new Error(`Refusing to set cookie ${name} with unsafe characters`);
    const base = opts.scriptReadable ? 'Secure; SameSite=Strict' : SESSION_COOKIE_BASE;
    return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; ${base}`;
  },
  clear(name: string, path: string): string {
    return `${name}=; Path=${path}; Max-Age=0; ${SESSION_COOKIE_BASE}`;
  },
};

export const COOKIES = {
  id: { name: 'vid_id', path: '/api' },
  // Scoped to /api (not just /api/auth) so any authenticated call can renew
  // an expired ID token in-request — see requireSession.
  refresh: { name: 'vid_rt', path: '/api' },
  pin: { name: 'vid_pin', path: '/api/auth' },
  // Not a credential (value is just "1"): tells the site's CloudFront function
  // — and the pages' scripts — that someone is probably signed in, so
  // signed-out visitors are redirected at the edge and pages skip the
  // "am I signed in?" API probe. The real session cookies are httpOnly and
  // scoped to /api.
  present: { name: 'vid_s', path: '/' },
} as const;

/** Where vid_rt lived before 2026-10-01; cleared alongside the current path. */
export const LEGACY_REFRESH_PATH = '/api/auth';

/** Set-Cookie values that end a session (all paths, incl. legacy). */
export function clearSessionCookies(): string[] {
  return [
    cookie.clear(COOKIES.id.name, COOKIES.id.path),
    cookie.clear(COOKIES.refresh.name, COOKIES.refresh.path),
    cookie.clear(COOKIES.refresh.name, LEGACY_REFRESH_PATH),
    cookie.clear(COOKIES.pin.name, COOKIES.pin.path),
    cookie.clear(COOKIES.present.name, COOKIES.present.path),
  ];
}

function parseCookies(event: APIGatewayProxyEventV2): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of event.cookies ?? []) {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  }
  return out;
}

// ---- responses ----------------------------------------------------------------

export function memberJson(status: number, body: unknown, setCookies: string[] = []): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    cookies: setCookies.length ? setCookies : undefined,
    body: JSON.stringify(body),
  };
}

export class RateLimited extends HttpError {
  constructor(readonly retryAfter: number) {
    super(429, 'bad_request', 'Too many requests. Please wait and try again.');
  }
}

/**
 * An error with a code outside the generic set (e.g. the vault's
 * `instance_moved`, `release_starting`) and extra body fields such as
 * `retry_after`. The body is `{error, message, ...extra}`.
 */
export class ApiError extends HttpError {
  constructor(status: number, code: string, message: string, readonly extra: Record<string, unknown> = {}) {
    super(status, code as HttpError['code'], message);
  }
}

/** Return from a route handler to answer with a status other than 200 (e.g. 202). */
export class WithStatus {
  constructor(readonly status: number, readonly body: unknown) {}
}

// ---- origin verification -------------------------------------------------------

async function verifyOrigin(event: APIGatewayProxyEventV2): Promise<void> {
  const given = event.headers['x-origin-verify'] ?? '';
  const expected = await secret(env('ORIGIN_VERIFY_SECRET_ARN'));
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(403, 'forbidden', 'Forbidden');
}

/** Expand an IPv6 address to 8 full hextets (handles "::" and embedded IPv4). */
export function expandIPv6(addr: string): string[] | null {
  let a = addr.toLowerCase().replace(/%.*$/, '');
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (v4) {
    const o = v4[1].split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    a = a.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const parts = [...head, ...Array(fill).fill('0'), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => p.padStart(4, '0'));
}

/**
 * Rate-limit identity of the viewer, from CloudFront-Viewer-Address
 * ("ip:port"). IPv4 is used as-is; IPv6 is reduced to its /64 — a single
 * host commonly owns a whole /64, so per-address limits would be
 * meaningless.
 */
export function rateKeyFromViewer(viewerAddress: string | undefined, fallback: string): string {
  // Always "address:port" (IPv6 unbracketed, e.g. 2001:db8::1:443).
  const v = viewerAddress ?? '';
  const ip = v.includes(':') ? v.slice(0, v.lastIndexOf(':')).replace(/^\[|\]$/g, '') : fallback;
  if (!ip.includes(':')) return ip;
  const h = expandIPv6(ip);
  return h ? `${h.slice(0, 4).join(':')}::/64` : ip;
}

// ---- session verification ------------------------------------------------------

let verifier: ReturnType<typeof CognitoJwtVerifier.create<{ userPoolId: string; tokenUse: 'id'; clientId: string }>> | undefined;

export interface Session {
  email: string;
  user_guid: string;
}

async function verifyIdToken(token: string): Promise<Session> {
  verifier ??= CognitoJwtVerifier.create({ userPoolId: env('MEMBER_POOL_ID'), tokenUse: 'id', clientId: env('MEMBER_CLIENT_ID') });
  const claims = await verifier.verify(token);
  const guid = String(claims['custom:user_guid'] ?? '');
  const email = String(claims.email ?? '').toLowerCase();
  if (!guid || !email) throw new Error('missing claims');
  return { email, user_guid: guid };
}

/**
 * Verify the `vid_id` cookie (Cognito ID token, member pool). If it is
 * missing or expired but the refresh cookie is valid, renew it in this same
 * request and set the new cookie on the response — the client never sees a
 * 401 just because the hour rolled over.
 */
export async function requireSession(req: MemberRequest): Promise<Session> {
  const token = req.cookies[COOKIES.id.name];
  // Self-healing presence cookie (sessions from before it existed, or after
  // it expired): any authenticated call re-sets it.
  const ensurePresent = (sess: Session) => {
    if (!req.cookies[COOKIES.present.name]) req.setCookies.push(cookie.set(COOKIES.present.name, '1', COOKIES.present.path, 30 * 86400, { scriptReadable: true }));
    return sess;
  };
  if (token) {
    try {
      return ensurePresent(await verifyIdToken(token));
    } catch {
      /* expired or invalid: try the refresh token below */
    }
  }
  const rt = req.cookies[COOKIES.refresh.name];
  if (!rt) throw new HttpError(401, 'unauthorized', token ? 'Session expired' : 'Not signed in');
  try {
    const out = await cognito.send(
      new InitiateAuthCommand({ ClientId: env('MEMBER_CLIENT_ID'), AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: rt } }),
    );
    const idToken = out.AuthenticationResult?.IdToken;
    if (!idToken) throw new Error('no id token');
    const session = await verifyIdToken(idToken);
    req.setCookies.push(cookie.set(COOKIES.id.name, idToken, COOKIES.id.path, out.AuthenticationResult?.ExpiresIn ?? 3600));
    return ensurePresent(session);
  } catch {
    req.setCookies.push(...clearSessionCookies());
    throw new HttpError(401, 'unauthorized', 'Session expired');
  }
}

// ---- handler wrapper ------------------------------------------------------------

export function memberHandler(router: Router<MemberRequest>) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const setCookies: string[] = [];
    try {
      await verifyOrigin(event);
      const method = event.requestContext.http.method.toUpperCase();
      if ((method === 'POST' || method === 'DELETE') && event.headers['x-vettid-csrf'] !== '1') {
        return memberJson(403, { error: 'csrf', message: 'Missing CSRF header' });
      }
      const m = router.match(method, event.rawPath);
      if (m === null || m === 'method') throw new HttpError(404, 'not_found', 'No such route');

      let body: Record<string, unknown> = {};
      if (event.body && (method === 'POST' || method === 'DELETE')) {
        const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
        if (raw.length > 64 * 1024) throw badRequest('Body too large');
        try {
          const v = JSON.parse(raw);
          if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
          body = v;
        } catch {
          throw badRequest('Body must be a JSON object');
        }
      }

      const result = await m.handler({
        method,
        path: event.rawPath,
        params: m.params,
        query: (event.queryStringParameters ?? {}) as Record<string, string>,
        body,
        cookies: parseCookies(event),
        ip: rateKeyFromViewer(event.headers['cloudfront-viewer-address'], event.requestContext.http.sourceIp),
        event,
        setCookies,
      });
      if (result instanceof WithStatus) return memberJson(result.status, result.body, setCookies);
      return memberJson(200, result, setCookies);
    } catch (err) {
      if (err instanceof RateLimited) {
        return memberJson(429, { error: 'rate_limited', message: err.message, retry_after: err.retryAfter }, setCookies);
      }
      if (err instanceof ApiError) return memberJson(err.status, { error: err.code, message: err.message, ...err.extra }, setCookies);
      if (err instanceof HttpError) return memberJson(err.status, { error: err.code, message: err.message }, setCookies);
      console.error('unhandled', err);
      return memberJson(500, { error: 'internal', message: 'Internal error' }, setCookies);
    }
  };
}
