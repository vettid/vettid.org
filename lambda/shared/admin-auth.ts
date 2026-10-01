import type { APIGatewayProxyEvent } from 'aws-lambda';
import { HttpError } from './http';

/**
 * The REST API's Cognito authorizer has already verified the admin-pool ID
 * token; here we require membership of the `admin` group and return the
 * caller's email as the audit actor.
 *
 * `cognito:groups` arrives as a string: "admin", "a,b" or "[a b]".
 */
export function requireAdmin(event: APIGatewayProxyEvent): string {
  const claims = (event.requestContext.authorizer?.claims ?? {}) as Record<string, string>;
  const groups = String(claims['cognito:groups'] ?? '')
    .split(/[\s,[\]]+/)
    .filter(Boolean);
  const email = String(claims.email ?? '').toLowerCase();
  if (!email) throw new HttpError(401, 'unauthorized', 'Not signed in');
  if (!groups.includes('admin')) throw new HttpError(403, 'forbidden', 'Admin group required');
  return email;
}
