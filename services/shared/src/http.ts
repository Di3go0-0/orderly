/**
 * Mini router para API Gateway HTTP API (payload v2) con JWT authorizer.
 * Un handler de Lambda atiende varias rutas: se elige por `routeKey` ("POST /products").
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { DomainError, ValidationError } from './errors.js';
import type { ErrorCode } from './errors.js';
import { logger, describeError } from './logger.js';
import { principalFromClaims } from './auth.js';
import type { Principal } from './auth.js';

export interface HttpRequest {
  routeKey: string;
  method: string;
  path: string;
  pathParams: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  principal: Principal;
  requestId: string;
}

export interface HttpResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type RouteHandler = (req: HttpRequest) => Promise<HttpResponse>;

export const ok = (body: unknown): HttpResponse => ({ status: 200, body });
export const created = (body: unknown): HttpResponse => ({ status: 201, body });
export const noContent = (): HttpResponse => ({ status: 204 });

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVARIANT_VIOLATION: 422,
  UNAVAILABLE: 503,
};

/** Límite defensivo: la API nunca necesita cuerpos grandes (OWASP: resource consumption). */
const MAX_BODY_BYTES = 64 * 1024;

const SECURITY_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

function toResult(res: HttpResponse): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: res.status,
    headers: { ...SECURITY_HEADERS, ...(res.headers ?? {}) },
    body: res.body === undefined ? '' : JSON.stringify(res.body),
  };
}

function parseBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): unknown {
  if (!event.body) return undefined;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw new ValidationError('Request body too large');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

export function router(routes: Record<string, RouteHandler>) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
    context: Context,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const requestId = context.awsRequestId;
    logger.setContext({ requestId, routeKey: event.routeKey });
    try {
      const handler = routes[event.routeKey];
      if (!handler) {
        return toResult({ status: 404, body: { code: 'NOT_FOUND', message: 'Route not found' } });
      }
      const principal = principalFromClaims(event.requestContext.authorizer?.jwt?.claims);
      const req: HttpRequest = {
        routeKey: event.routeKey,
        method: event.requestContext.http.method,
        path: event.rawPath,
        pathParams: (event.pathParameters ?? {}) as Record<string, string>,
        query: (event.queryStringParameters ?? {}) as Record<string, string>,
        body: parseBody(event),
        principal,
        requestId,
      };
      const res = await handler(req);
      logger.info('request completed', { status: res.status, sub: principal.sub });
      return toResult(res);
    } catch (err) {
      if (err instanceof DomainError) {
        const status = STATUS_BY_CODE[err.code];
        logger.warn('request rejected', { status, code: err.code, message: err.message });
        return toResult({ status, body: { code: err.code, message: err.message, details: err.details } });
      }
      // Nunca filtrar stack traces al cliente.
      logger.error('unhandled error', describeError(err));
      return toResult({ status: 500, body: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } });
    } finally {
      logger.clearContext();
    }
  };
}
