import type { Env } from '../lib/env';

export type RouteHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext
) => Response | Promise<Response>;

export type RouteStage = 'pre' | 'post';

interface RouteRecord {
  method: string;
  path: string;
  handler: RouteHandler;
  stage: RouteStage;
}

const registeredRoutes: RouteRecord[] = [];
const routePathSet = new Set<string>();

function normalizeMethod(method: string): string {
  return method.toUpperCase();
}

function registerRoute(
  method: string,
  path: string,
  handler: RouteHandler,
  stage: RouteStage
): void {
  registeredRoutes.push({ method: normalizeMethod(method), path, handler, stage });
  routePathSet.add(path);
}

function matchesRoute(record: RouteRecord, request: Request, url: URL): boolean {
  const method = request.method.toUpperCase();

  if (record.method !== 'ALL' && method !== record.method) {
    if (!(record.method === 'GET' && method === 'HEAD')) {
      return false;
    }
  }

  return url.pathname === record.path;
}

async function handleStage(
  stage: RouteStage,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  for (const record of registeredRoutes) {
    if (record.stage !== stage) continue;
    if (!matchesRoute(record, request, url)) continue;

    return await record.handler(request, env, ctx);
  }

  return null;
}

export const router = {
  get(
    path: string,
    handler: RouteHandler,
    options?: { stage?: RouteStage }
  ): void {
    registerRoute('GET', path, handler, options?.stage ?? 'post');
  },
  post(
    path: string,
    handler: RouteHandler,
    options?: { stage?: RouteStage }
  ): void {
    registerRoute('POST', path, handler, options?.stage ?? 'post');
  },
  all(
    path: string,
    handler: RouteHandler,
    options?: { stage?: RouteStage }
  ): void {
    registerRoute('ALL', path, handler, options?.stage ?? 'post');
  },
  async handlePreBootstrap(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response | null> {
    return handleStage('pre', request, env, ctx);
  },
  async handlePostBootstrap(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response | null> {
    return handleStage('post', request, env, ctx);
  },
  getRegisteredPaths(): string[] {
    return Array.from(routePathSet);
  },
};

export type WorkerRouter = typeof router;

export function getRouterRegisteredPaths(): string[] {
  return router.getRegisteredPaths();
}
