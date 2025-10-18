import type { Env } from '../lib/env';
import { router as defaultRouter, type WorkerRouter } from '../router/router';
import { codexRouter } from './router';

type AuthorizationGuard = (request: Request, env: Env) => Response | null;

type RegisterOptions = {
  router?: WorkerRouter;
  authorize?: AuthorizationGuard;
};

export function registerCodexRoutes(options: RegisterOptions = {}): void {
  const workerRouter = options.router ?? defaultRouter;
  const authorize = options.authorize;

  const handle = (req: Request, env: Env, ctx: ExecutionContext) => {
    if (authorize) {
      const unauthorized = authorize(req, env);
      if (unauthorized) {
        return unauthorized;
      }
    }

    return codexRouter(req, env as any, ctx);
  };

  workerRouter.all('/codex', handle, { stage: 'pre' });
  workerRouter.all('/codex/run', handle, { stage: 'pre' });
  workerRouter.all('/codex/prompt', handle, { stage: 'pre' });
}

export { codexRouter } from './router';

export default {
  fetch: codexRouter,
};
