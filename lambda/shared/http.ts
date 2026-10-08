import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** Thrown by handlers to produce a JSON error response ({ error, message }). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'internal',
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, 'bad_request', m);
export const notFound = (m = 'Not found') => new HttpError(404, 'not_found', m);
export const conflict = (m: string) => new HttpError(409, 'conflict', m);
export const forbidden = (m = 'Forbidden') => new HttpError(403, 'forbidden', m);

export interface Request {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
  /** Authenticated caller (email), set by the auth middleware. */
  actor: string;
  event: APIGatewayProxyEvent;
}

export type RouteHandler<R = Request> = (req: R) => Promise<unknown>;

interface Route<R> {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: RouteHandler<R>;
}

/**
 * Minimal router for route-group Lambdas: `'/admin/members/{user_guid}'`
 * style templates, path params URL-decoded. Handlers return a JSON-able value
 * (200) or throw HttpError.
 */
export class Router<R = Request> {
  private readonly routes: Route<R>[] = [];

  on(method: string, template: string, handler: RouteHandler<R>): this {
    const names: string[] = [];
    const pattern = new RegExp(
      '^' +
        template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_m, name: string) => {
          names.push(name);
          return '([^/]+)';
        }) +
        '/?$',
    );
    this.routes.push({ method: method.toUpperCase(), pattern, names, handler });
    return this;
  }

  match(method: string, path: string): { handler: RouteHandler<R>; params: Record<string, string> } | 'method' | null {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method.toUpperCase()) continue;
      const params: Record<string, string> = {};
      try {
        r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
      } catch {
        throw badRequest('Malformed path');
      }
      return { handler: r.handler, params };
    }
    return pathMatched ? 'method' : null;
  }
}

export function corsHeaders(): Record<string, string> {
  const origin = process.env.ALLOWED_ORIGIN;
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        Vary: 'Origin',
      }
    : {};
}

export function json(status: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

export function parseBody(event: APIGatewayProxyEvent): Record<string, unknown> {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  // Largest legitimate body is a membership terms text (≤ 200k chars).
  if (raw.length > 512 * 1024) throw badRequest('Body too large');
  try {
    const v = JSON.parse(raw);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw badRequest('Body must be a JSON object');
  }
}

/** Convert an unexpected error into a 500 without leaking internals. */
export function errorResponse(err: unknown): APIGatewayProxyResult {
  if (err instanceof HttpError) return json(err.status, { error: err.code, message: err.message });
  console.error('unhandled', err);
  return json(500, { error: 'internal', message: 'Internal error' });
}

// ---- input validation helpers -------------------------------------------

export function str(body: Record<string, unknown>, key: string, opts: { max?: number; optional?: boolean } = {}): string {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (opts.optional) return '';
    throw badRequest(`${key} is required`);
  }
  if (typeof v !== 'string') throw badRequest(`${key} must be a string`);
  const t = v.trim();
  if (t.length > (opts.max ?? 500)) throw badRequest(`${key} is too long`);
  return t;
}

export function int(body: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = body[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw badRequest(`${key} must be an integer ${min}–${max}`);
  }
  return v;
}

export function bool(body: Record<string, unknown>, key: string): boolean {
  const v = body[key];
  if (typeof v !== 'boolean') throw badRequest(`${key} must be true or false`);
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * C0 (U+0000–U+001F), DEL (U+007F), C1 (U+0080–U+009F), U+2028 and U+2029:
 * the characters a vault refuses in the account snapshot's `email` and names
 * (MEMBER-API 2.3.1, VAULT-MESSAGING 0.21.0 §11.13).
 */
export const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/**
 * The shared email check (MEMBER-API 2.3.1): trimmed and lower-cased, at most
 * 254 characters, one `@` with a dot in the domain, no white space and no
 * control character (CONTROL_RE). Anything else is `400 Invalid email address`.
 */
export function email(value: string): string {
  const e = value.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e) || CONTROL_RE.test(e)) throw badRequest('Invalid email address');
  return e;
}

// ---- pagination ---------------------------------------------------------

export function encodeCursor(key: Record<string, unknown> | undefined): string | null {
  return key ? Buffer.from(JSON.stringify(key)).toString('base64url') : null;
}

export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    /* fall through */
  }
  throw badRequest('Invalid cursor');
}
