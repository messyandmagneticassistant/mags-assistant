import type { Env } from './lib/env';

type RouteHandler = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response> | Response;

type RouteKey = `${Uppercase<string>}:${string}`;

type Route = {
  method: Uppercase<string>;
  path: string;
  handler: RouteHandler;
};

const routes: Route[] = [];
const routeIndex = new Map<RouteKey, Route>();
let coreRoutesRegistered = false;

function makeKey(method: string, path: string): RouteKey {
  return `${method.toUpperCase() as Uppercase<string>}:${path}`;
}

export function registerRoute(method: string, path: string, handler: RouteHandler): void {
  const key = makeKey(method, path);
  if (routeIndex.has(key)) return;

  const route: Route = {
    method: method.toUpperCase() as Uppercase<string>,
    path,
    handler,
  };

  routes.push(route);
  routeIndex.set(key, route);
}

export function ensureCoreRouterRoutes(): void {
  if (coreRoutesRegistered) return;

  registerRoute('GET', '/', () =>
    new Response('Maggie is online! 🌸 Welcome to Messy & Magnetic.', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }),
  );

  registerRoute('GET', '/test-telegram', () =>
    new Response('Telegram test passed.', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }),
  );

  coreRoutesRegistered = true;
}

export async function handleRouter(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  ensureCoreRouterRoutes();

  const { pathname } = new URL(req.url);
  const method = req.method.toUpperCase();
  const key = makeKey(method, pathname);
  const match = routeIndex.get(key);

  if (!match) return null;

  return await match.handler(req, env, ctx);
}

export function listRouterPaths(): string[] {
  ensureCoreRouterRoutes();
  const seen = new Set<string>();
  for (const route of routes) {
    if (!seen.has(route.path)) seen.add(route.path);
  }
  return Array.from(seen);
}
