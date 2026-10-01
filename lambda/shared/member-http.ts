import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { timingSafeEqual } from 'node:crypto';
import { env } from './aws';
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
  ip: string;
  event: APIGatewayProxyEventV2;
  /** Cookies to set on the response (complete Set-Cookie values). */
  setCookies: string[];
};

// ---- cookies ------------------------------------------------------------------

const SESSION_COOKIE_BASE = 'Secure; HttpOnly; SameSite=Strict';

export const cookie = {
  set(name: string, value: string, path: string, maxAgeSeconds: number): string {
    if (!/^[A-Za-z0-9._~+/=-]*$/.test(value)) throw new Error(`Refusing to set cookie ${name} with unsafe characters`);
    return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; ${SESSION_COOKIE_BASE}`;
  },
  clear(name: string, path: string): string {
    return `${name}=; Path=${path}; Max-Age=0; ${SESSION_COOKIE_BASE}`;
  },
};

export const COOKIES = {
  id: { name: 'vid_id', path: '/api' },
  refresh: { name: 'vid_rt', path: '/api/auth' },
  pin: { name: 'vid_pin', path: '/api/auth' },
} as const;

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

// ---- origin verification -------------------------------------------------------

async function verifyOrigin(event: APIGatewayProxyEventV2): Promise<void> {
  const given = event.headers['x-origin-verify'] ?? '';
  const expected = await secret(env('ORIGIN_VERIFY_SECRET_ARN'));
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(403, 'forbidden', 'Forbidden');
}

/** Viewer IP from CloudFront (`CloudFront-Viewer-Address: ip:port`). */
function viewerIp(event: APIGatewayProxyEventV2): string {
  const v = event.headers['cloudfront-viewer-address'];
  if (v) return v.includes('.') ? v.slice(0, v.lastIndexOf(':')) : v.replace(/^\[?([^\]]+)\]?:\d+$/, '$1');
  return event.requestContext.http.sourceIp;
}

// ---- session verification ------------------------------------------------------

let verifier: ReturnType<typeof CognitoJwtVerifier.create<{ userPoolId: string; tokenUse: 'id'; clientId: string }>> | undefined;

export interface Session {
  email: string;
  user_guid: string;
}

/** Verify the `vid_id` cookie (Cognito ID token for the member pool). */
export async function requireSession(req: MemberRequest): Promise<Session> {
  const token = req.cookies[COOKIES.id.name];
  if (!token) throw new HttpError(401, 'unauthorized', 'Not signed in');
  verifier ??= CognitoJwtVerifier.create({ userPoolId: env('MEMBER_POOL_ID'), tokenUse: 'id', clientId: env('MEMBER_CLIENT_ID') });
  try {
    const claims = await verifier.verify(token);
    const guid = String(claims['custom:user_guid'] ?? '');
    const email = String(claims.email ?? '').toLowerCase();
    if (!guid || !email) throw new Error('missing claims');
    return { email, user_guid: guid };
  } catch {
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
        ip: viewerIp(event),
        event,
        setCookies,
      });
      return memberJson(200, result, setCookies);
    } catch (err) {
      if (err instanceof RateLimited) {
        return memberJson(429, { error: 'rate_limited', message: err.message, retry_after: err.retryAfter }, setCookies);
      }
      if (err instanceof HttpError) return memberJson(err.status, { error: err.code, message: err.message }, setCookies);
      console.error('unhandled', err);
      return memberJson(500, { error: 'internal', message: 'Internal error' }, setCookies);
    }
  };
}
