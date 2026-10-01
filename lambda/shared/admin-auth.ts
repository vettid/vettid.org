import { AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { cognito, env } from './aws';
import { HttpError } from './http';

/**
 * The REST API's Cognito authorizer has already verified the admin-pool ID
 * token; here we require membership of the `admin` group and return the
 * caller's email as the audit actor.
 *
 * `cognito:groups` arrives as a string: "admin", "a,b" or "[a b]".
 */
export function requireAdminClaims(event: APIGatewayProxyEvent): string {
  const claims = (event.requestContext.authorizer?.claims ?? {}) as Record<string, string>;
  const groups = String(claims['cognito:groups'] ?? '')
    .split(/[\s,[\]]+/)
    .filter(Boolean);
  const email = String(claims.email ?? '').toLowerCase();
  if (!email) throw new HttpError(401, 'unauthorized', 'Not signed in');
  if (!groups.includes('admin')) throw new HttpError(403, 'forbidden', 'Admin group required');
  return email;
}

const enabledCache = new Map<string, { ok: boolean; at: number }>();
const ENABLED_TTL_MS = 60_000;

/**
 * Claims check plus a live "is this admin still enabled?" lookup (cached
 * 60 s). ID tokens stay valid until they expire (≤ 30 min) even after an
 * admin is disabled or removed; this closes that window to about a minute.
 */
export async function requireAdmin(event: APIGatewayProxyEvent): Promise<string> {
  const email = requireAdminClaims(event);
  const hit = enabledCache.get(email);
  let ok = hit && Date.now() - hit.at < ENABLED_TTL_MS ? hit.ok : undefined;
  if (ok === undefined) {
    try {
      const u = await cognito.send(new AdminGetUserCommand({ UserPoolId: env('ADMIN_POOL_ID'), Username: email }));
      ok = !!u.Enabled;
    } catch (e) {
      if ((e as Error).name !== 'UserNotFoundException') throw e;
      ok = false;
    }
    enabledCache.set(email, { ok, at: Date.now() });
  }
  if (!ok) throw new HttpError(403, 'forbidden', 'This admin account is disabled');
  return email;
}
