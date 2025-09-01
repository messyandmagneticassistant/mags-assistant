// worker/worker.ts — unified public worker router (final)
// - Diagnostics:     /health  /diag/config
// - AppScript proxy: /api/appscript*
// - Telegram:        /telegram-webhook
// - AI:              /ai/*
// - TikTok:          /tiktok/*
// - Tasks:           /tasks/*
// - Cron:            /cron/*
// - Orders:          /webhooks/stripe  /webhooks/tally
// - Readiness:       /ready
// - Scheduled:       warm pings + optional maintenance jobs
import { onRequestGet as health, diagConfig } from "./health";

// Keep types loose so this compiles even if some modules are absent
type Env = any;
type Ctx = { env: Env; request: Request; ctx: ExecutionContext };

// ---------- small helpers ----------
function cors(extra?: Record<string, string>) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    ...(extra ?? {}),
  };
}

function isPreflight(req: Request) {
  return req.method === "OPTIONS";
}

// Generic dynamic loader. If a module/handler doesn't exist, we return 404
async function tryRoute<T extends Record<string, any>>(
  pathPrefix: string,
  modPath: string,
  handlerName: string | null,
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith(pathPrefix)) return null;

  try {
    const mod: T = (await import(modPath)) as T;

    // Explicit function name provided
    if (handlerName && typeof (mod as any)[handlerName] === "function") {
      return await (mod as any)[handlerName](req, env, ctx);
    }

    // CF/Workers route conventions
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

    if (typeof (mod as any).handle === "function") {
      return await (mod as any).handle(req, env, ctx);
    }

    return new Response("Route module loaded but no handler found.", { status: 500, headers: cors() });
  } catch {
    // Module not present in this build — treat as 404 so we can land PRs independently
    return new Response("Not Found", { status: 404, headers: cors() });
  }
}

export default {
  // ---------- HTTP entry ----------
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight
    if (isPreflight(req)) {
      return new Response(null, { status: 204, headers: cors() });
    }

    // Diagnostics
    if (url.pathname === "/health" && req.method === "GET") {
      return (health as any)({ env });
    }
    if (url.pathname === "/diag/config" && req.method === "GET") {
      return (diagConfig as any)({ env });
    }

    // ----- Orders webhooks (Stripe / Tally)
    if (url.pathname === "/webhooks/stripe") {
      const r = await tryRoute("/webhooks/stripe", "./orders/stripe", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }
    if (url.pathname === "/webhooks/tally") {
      const r = await tryRoute("/webhooks/tally", "./orders/tally", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // ----- Telegram webhook
    if (url.pathname === "/telegram-webhook") {
      const r = await tryRoute("/telegram-webhook", "./routes/telegram", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // ----- AI endpoints
    {
      const r = await tryRoute("/ai/", "./routes/ai", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // ----- Legacy Apps Script proxy
    {
      const r = await tryRoute("/api/appscript", "./routes/appscript", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // ----- TikTok (uploader / engagement / schedule)
    {
      const r = await tryRoute("/tiktok/", "./routes/tiktok", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // ----- Task queue
    {
      const r = await tryRoute("/tasks/", "./routes/tasks", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // ----- Cron tickers
    {
      const r = await tryRoute("/cron/", "./routes/cron", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // ----- Readiness (optional)
    if (url.pathname === "/ready") {
      try {
        const r: any = await import("./routes/ready");
        if (typeof r.onRequestGet === "function") {
          return await r.onRequestGet({ request: req, env, ctx });
        }
        if (typeof r.handle === "function") {
          return await r.handle(req, env, ctx);
        }
      } catch {}
      return new Response("ready route not installed", { status: 404, headers: cors() });
    }

    // Default
    return new Response("mags ok", { status: 200, headers: { ...cors(), "content-type": "text/plain" } });
  },

  // ---------- Cron-like scheduled entry (Cloudflare Workers) ----------
  // Use wrangler.toml: `triggers = { crons = ["*/15 * * * *"] }` for 15-min, etc.
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // 1) Optional warm ping(s) to keep external integrations alive
    try {
      const appsScriptUrl = env?.APPS_SCRIPT_EXEC ?? env?.APPS_SCRIPT_URL;
      if (appsScriptUrl) {
        ctx.waitUntil(fetch(appsScriptUrl).then(() => {}));
      }
    } catch {}

    // 2) If your cron route module exists, let it do maintenance (daily digest, queue drains, etc.)
    try {
      const mod: any = await import("./routes/cron");
      // Prefer an exported maintenance function if present
      if (typeof mod.runScheduled === "function") {
        ctx.waitUntil(mod.runScheduled(event, env));
      } else if (typeof mod.onScheduled === "function") {
        // Some codebases export `onScheduled`
        ctx.waitUntil(mod.onScheduled(event, env));
      }
    } catch {
      // no cron module; fine
    }

    // 3) If you keep tasks in KV and want a periodic drain, let tasks module hook in
    try {
      const tasks: any = await import("./routes/tasks");
      if (typeof tasks.onScheduled === "function") {
        ctx.waitUntil(tasks.onScheduled(event, env));
      }
    } catch {
      // no tasks module; fine
    }
  },
};