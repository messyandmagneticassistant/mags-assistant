import { beforeEach, describe, expect, it } from 'vitest';

import type { RouteHandler } from '../../worker/router/router';
import { registerCodexRoutes } from '../../worker/routes/codex';
import {
  FALLBACK_STATUS_HEADER,
  FALLBACK_SOURCE_HEADER,
  FALLBACK_TRIGGERED,
  DEFAULT_RECOVERY_TIPS,
  getFallbackRoutes,
  __resetFallbackRegistryForTests,
} from '../../worker/lib/fallbackRoutes';

type RegisteredRoute = { method: string; path: string; handler: RouteHandler };
function createRouter() {
  const routes: RegisteredRoute[] = [];
  const router = {
    get(path: string, handler: RouteHandler) {
      routes.push({ method: 'GET', path, handler });
    },
    post(path: string, handler: RouteHandler) {
      routes.push({ method: 'POST', path, handler });
    },
    all(path: string, handler: RouteHandler) {
      routes.push({ method: 'ALL', path, handler });
    },
  } as any;

  return { routes, router };
}

const allowAll = () => null;

describe('codex fallback router registration', () => {
  beforeEach(() => {
    __resetFallbackRegistryForTests();
  });

  it('registers fallback-aware codex routes', () => {
    const { routes, router } = createRouter();

    registerCodexRoutes(router, allowAll);

    const registeredPaths = routes.map((route) => route.path);
    expect(registeredPaths).toEqual(
      expect.arrayContaining(['/codex', '/codex/run', '/codex/prompt', '/codex/test-fallback']),
    );

    const fallbackAware = getFallbackRoutes();
    expect(fallbackAware).toEqual(
      expect.arrayContaining(['/codex', '/codex/run', '/codex/prompt', '/codex/test-fallback']),
    );
  });

  it('forces fallback on the diagnostic route', async () => {
    const { routes, router } = createRouter();

    registerCodexRoutes(router, allowAll);

    const fallbackRoute = routes.find((route) => route.path === '/codex/test-fallback');
    expect(fallbackRoute).toBeDefined();

    const response = await fallbackRoute!.handler(
      new Request('https://example.com/codex/test-fallback'),
      {} as any,
      {} as any,
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(FALLBACK_STATUS_HEADER)).toBe(FALLBACK_TRIGGERED);
    expect(response.headers.get(FALLBACK_SOURCE_HEADER)).toBe('test-fallback');

    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      error: 'Codex upstream failed',
      source: 'test-fallback',
      recoveryTips: DEFAULT_RECOVERY_TIPS,
      fallback: { route: '/codex/test-fallback', triggered: true },
    });
  });
});
