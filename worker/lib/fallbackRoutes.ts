import type { Env } from './env';
import type { RouteHandler } from '../router/router';

export type AuthorizationGuard = (req: Request, env: Env) => Response | null;

export const FALLBACK_STATUS_HEADER = 'x-maggie-fallback';
export const FALLBACK_ROUTE_HEADER = 'x-maggie-fallback-route';
export const FALLBACK_SOURCE_HEADER = 'x-maggie-fallback-source';
export const FALLBACK_READY = 'ready';
export const FALLBACK_TRIGGERED = 'triggered';
export const DEFAULT_RECOVERY_TIPS =
  'Check logs, ensure API is reachable, fallback was triggered correctly';

export interface FallbackRouteOptions {
  path: string;
  ensureAuthorized?: AuthorizationGuard;
  fallbackSource?: string;
  successStatus?: number;
}

export type FallbackRouteHandlerResult =
  | Response
  | Record<string, unknown>
  | string
  | number
  | boolean
  | null
  | undefined;

export type FallbackRouteHandler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
) => Promise<FallbackRouteHandlerResult> | FallbackRouteHandlerResult;

const fallbackRoutes = new Set<string>();

function toPlainObject(value: FallbackRouteHandlerResult): Record<string, unknown> {
  if (value instanceof Response) {
    throw new TypeError('Response instances must be handled separately');
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }

  return { result: value ?? null };
}

function buildJsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function markResponse(
  response: Response,
  path: string,
  triggered: boolean,
  source: string,
): Response {
  response.headers.set(FALLBACK_STATUS_HEADER, triggered ? FALLBACK_TRIGGERED : FALLBACK_READY);
  response.headers.set(FALLBACK_ROUTE_HEADER, path);
  response.headers.set(FALLBACK_SOURCE_HEADER, source);
  return response;
}

function describeError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    return error.message || 'Unknown error';
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

export function wrapRouteWithFallback(
  handler: FallbackRouteHandler,
  options: FallbackRouteOptions,
): RouteHandler {
  const path = options.path;
  const source = options.fallbackSource ?? path;
  fallbackRoutes.add(path);

  return async (req, env, ctx) => {
    if (options.ensureAuthorized) {
      const unauthorized = options.ensureAuthorized(req, env);
      if (unauthorized) {
        return markResponse(unauthorized, path, false, source);
      }
    }

    try {
      const result = await handler(req, env, ctx);
      if (result instanceof Response) {
        return markResponse(result, path, false, source);
      }

      const body = toPlainObject(result);
      if (!Object.prototype.hasOwnProperty.call(body, 'ok')) {
        body.ok = true;
      }
      if (!Object.prototype.hasOwnProperty.call(body, 'fallback')) {
        body.fallback = { route: path, triggered: false, source };
      }

      const status = options.successStatus ?? 200;
      return markResponse(buildJsonResponse(body, status), path, false, source);
    } catch (error) {
      const message = describeError(error);
      const payload: Record<string, unknown> = {
        ok: false,
        error: message,
        source,
        recoveryTips: DEFAULT_RECOVERY_TIPS,
        fallback: { route: path, triggered: true, source },
      };
      const response = buildJsonResponse(payload, 502);
      return markResponse(response, path, true, source);
    }
  };
}

export function getFallbackRoutes(): string[] {
  return Array.from(fallbackRoutes);
}

export function isFallbackRoute(path: string): boolean {
  return fallbackRoutes.has(path);
}

export function __resetFallbackRegistryForTests(): void {
  fallbackRoutes.clear();
}
