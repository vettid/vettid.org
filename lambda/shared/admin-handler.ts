import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { requireAdmin } from './admin-auth';
import { HttpError, Router, errorResponse, json, parseBody } from './http';

/** Wrap a Router as an admin REST API Lambda handler. */
export function adminHandler(router: Router) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      if (event.httpMethod === 'OPTIONS') return json(204, {});
      const actor = await requireAdmin(event);
      const m = router.match(event.httpMethod, event.path);
      if (m === null) throw new HttpError(404, 'not_found', 'No such route');
      if (m === 'method') throw new HttpError(404, 'not_found', 'Method not allowed on this route');
      const result = await m.handler({
        method: event.httpMethod,
        path: event.path,
        params: m.params,
        query: (event.queryStringParameters ?? {}) as Record<string, string>,
        body: event.httpMethod === 'GET' || event.httpMethod === 'DELETE' ? {} : parseBody(event),
        actor,
        event,
      });
      return json(200, result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
