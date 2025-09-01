// worker/worker.ts — unified router (health + optional feature routes)

import { onRequestGet as health, diagConfig } from "./health";

type Ctx = { env: any; request: Request; ctx: ExecutionContext };

async function tryRoute<T extends Record<string, any>>(
  pathPrefix: string,
  modPath: string,
  handlerName: string | null,
  req: Request,
  env: any,
  ctx: ExecutionContext
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith(pathPrefix)) return null;

  try {
    // Dynamically import so the worker still builds when the route module isn't in this PR yet.
    const mod: T = (await import(modPath)) as T;

    // If a generic handler is exported (e.g., `handle`), use it; otherwise try method-specific.
    if (handlerName && typeof mod[handlerName] === "function") {
      return await mod[handlerName](req, env, ctx);
    }

    // Common conventions supported automatically:
    //  - onRequest (generic)
    //  - onRequestGet / onRequestPost (Cloudflare Pages-style handlers)
    if (typeof (mod as any).onRequest === "function") {
      return await (mod as any).onRequest({ request: req, env, ctx });
    }
    const methodKey =
      req.method === "GET" ? "onRequestGet"
      : req.method === "POST" ? "onRequestPost"
      : req.method === "PUT" ? "onRequestPut"
      : req.method === "DELETE" ? "onRequestDelete"
      : null;

    if (methodKey && typeof (mod as any)[methodKey] === "function") {
      return await (mod as any)[methodKey]({ request: req, env, ctx });
    }

    // Fallback: if module exports `handle(req, env, ctx)`
    if (typeof (mod as any).handle === "function") {
      return await (mod as any).handle(req, env, ctx);
    }

    return new Response("Route module loaded but no handler found.", { status: 500 });
  } catch (_err) {
    // Module not found (or import error) — treat as not handled so other routes can try.
    return new Response("Not Found", { status: 404 });
  }
}

export default {
  async fetch(req: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Health & diagnostics stay always-on
    if (url.pathname === "/health" && req.method === "GET") {
      return health({ env } as any);
    }
    if (url.pathname === "/diag/config" && req.method === "GET") {
      return diagConfig({ env } as any);
    }

    // Optional routes — only respond if the module exists in the current build
    // TikTok API (uploader/engagement/schedule)
    const tik = await tryRoute("/tiktok/", "./routes/tiktok", null, req, env, ctx);
    if (tik && tik.status !== 404) return tik;

    // Task queue endpoints
    const tasks = await tryRoute("/tasks/", "./routes/tasks", null, req, env, ctx);
    if (tasks && tasks.status !== 404) return tasks;

    // Cron tickers
    const cron = await tryRoute("/cron/", "./routes/cron", null, req, env, ctx);
    if (cron && cron.status !== 404) return cron;

    // Readiness introspection (optional)
    if (url.pathname === "/ready") {
      try {
        const r = await import("./routes/ready");
        if (typeof (r as any).onRequestGet === "function") {
          return await (r as any).onRequestGet({ request: req, env, ctx });
        }
        if (typeof (r as any).handle === "function") {
          return await (r as any).handle(req, env, ctx);
        }
      } catch {}
      // soft 404 when /ready module not present
      return new Response("ready route not installed", { status: 404 });
    }

    // Default response
    return new Response("mags ok", { status: 200, headers: { "content-type": "text/plain" } });
  },
};