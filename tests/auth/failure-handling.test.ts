import { beforeEach, describe, expect, it } from 'vitest';

import type { RouteHandler } from '../../worker/router/router';
import { registerCodexRoutes } from '../../worker/routes/codex';
import type { CodexAuthGuard } from '../../worker/routes/codex';
import {
  FALLBACK_READY,
  FALLBACK_STATUS_HEADER,
  FALLBACK_TRIGGERED,
  FALLBACK_SOURCE_HEADER,
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

function buildGuard(secret: string): CodexAuthGuard {
  return (req) => {
    const header = req.headers.get('authorization');
    if (header === `Bearer ${secret}`) return null;
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }, null, 2), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  };
}

describe('codex auth handling', () => {
  beforeEach(() => {
    __resetFallbackRegistryForTests();
  });

  it('blocks codex execution when authorization is missing', async () => {
    const { routes, router } = createRouter();
    const guard = buildGuard('secret');
    registerCodexRoutes(router, guard);

    const runRoute = routes.find((route) => route.path === '/codex/run');
    expect(runRoute).toBeDefined();

    const response = await runRoute!.handler(
      new Request('https://example.com/codex/run', { method: 'POST' }),
      {} as any,
      {} as any,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get(FALLBACK_STATUS_HEADER)).toBe(FALLBACK_READY);
  });

  it('returns fallback-wrapped success payload when authorized', async () => {
    const { routes, router } = createRouter();
    const guard = buildGuard('secret');
    registerCodexRoutes(router, guard);

    const runRoute = routes.find((route) => route.path === '/codex/run');
    expect(runRoute).toBeDefined();

    const body = JSON.stringify({ task: 'schedule', payload: {} });
    const response = await runRoute!.handler(
      new Request('https://example.com/codex/run', {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
        body,
      }),
      {} as any,
      {} as any,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get(FALLBACK_STATUS_HEADER)).toBe(FALLBACK_READY);
    expect(response.headers.get(FALLBACK_SOURCE_HEADER)).toBe('codex-run');

    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.task).toBe('schedule');
    expect(payload.fallback).toMatchObject({ route: '/codex/run', triggered: false });
  });

  it('surfaces fallback when upstream prompt execution fails', async () => {
    const { routes, router } = createRouter();
    const guard = buildGuard('secret');
    registerCodexRoutes(router, guard);

    const promptRoute = routes.find((route) => route.path === '/codex/prompt');
    expect(promptRoute).toBeDefined();

    const response = await promptRoute!.handler(
      new Request('https://example.com/codex/prompt', {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prompt: 'Diagnose failing queue worker' }),
      }),
      {} as any,
      {} as any,
    );

    expect(response.status).toBe(502);
    expect(response.headers.get(FALLBACK_STATUS_HEADER)).toBe(FALLBACK_TRIGGERED);
    expect(response.headers.get(FALLBACK_SOURCE_HEADER)).toBe('codex-prompt');

    const payload = await response.json();
    expect(payload.ok).toBe(false);
    expect(payload.fallback).toMatchObject({ route: '/codex/prompt', triggered: true });
  });
});
