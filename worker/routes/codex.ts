import { runWithCodex } from '../../lib/codex';
import { runMaggieTaskWithFallback } from '../../fallback';
import type { WorkerRouter } from '../router/router';
import {
  wrapRouteWithFallback,
  type AuthorizationGuard,
} from '../lib/fallbackRoutes';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  return req
    .json()
    .then((value) => (isRecord(value) ? value : {}))
    .catch(() => ({}));
}

export type CodexAuthGuard = AuthorizationGuard;

export function registerCodexRoutes(
  router: WorkerRouter,
  ensureAuthorized: CodexAuthGuard,
): void {
  router.get(
    '/codex',
    wrapRouteWithFallback(
      async () => ({
        status: 'ready',
        timestamp: new Date().toISOString(),
      }),
      { path: '/codex', ensureAuthorized, fallbackSource: 'codex-status' },
    ),
  );

  router.post(
    '/codex/run',
    wrapRouteWithFallback(
      async (req: Request) => {
        const body = await parseJsonBody(req);
        const taskName = getString(body.task, '');
        if (!taskName) {
          return json({ ok: false, error: 'missing-task' }, 400);
        }

        const payload = isRecord(body.payload) ? (body.payload as Record<string, unknown>) : {};
        const result = await runMaggieTaskWithFallback(taskName, payload);

        return {
          ok: true,
          task: taskName,
          provider: result.provider,
          attempts: result.attempts,
          notes: result.notes ?? null,
          output: result.output,
        };
      },
      { path: '/codex/run', ensureAuthorized, fallbackSource: 'codex-run' },
    ),
  );

  router.post(
    '/codex/prompt',
    wrapRouteWithFallback(
      async (req: Request) => {
        const body = await parseJsonBody(req);
        const prompt = getString(body.prompt, '');
        if (!prompt) {
          return json({ ok: false, error: 'missing-prompt' }, 400);
        }

        const agentName = getString(body.agentName, 'Codex');
        const role = getString(body.role, 'Code + Debug Assistant');
        const context = typeof body.context === 'string' && body.context.trim() ? body.context : undefined;
        const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;

        const response = await runWithCodex({
          task: prompt,
          agentName,
          role,
          context,
          model,
        });

        return {
          ok: true,
          prompt,
          agentName,
          role,
          context: context ?? null,
          model: model ?? null,
          response,
        };
      },
      { path: '/codex/prompt', ensureAuthorized, fallbackSource: 'codex-prompt' },
    ),
  );

  router.get(
    '/codex/test-fallback',
    wrapRouteWithFallback(
      async () => {
        throw new Error('Codex upstream failed');
      },
      { path: '/codex/test-fallback', ensureAuthorized, fallbackSource: 'test-fallback' },
    ),
  );
}
