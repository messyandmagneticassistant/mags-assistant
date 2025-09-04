// worker/worker.ts — finalized unified router (KV-first, CORS, cron-safe)
import { onRequestGet as health, diagConfig } from "./health";

type Env = any;
type Ctx = { env: Env; request: Request; ctx: ExecutionContext };

// ---------------- CORS helpers ----------------
const CORS_BASE: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  "Access-Control-Max-Age": "86400",
};
function cors(extra?: Record<string, string>) {
  return { ...CORS_BASE, ...(extra ?? {}) };
}
function isPreflight(req: Request) {
  return req.method === "OPTIONS";
}

// --------------- Dynamic route loader ---------------
async function tryRoute<T extends Record<string, any>>(
  pathPrefix: string,
  modPath: string,
  handlerName: string | null,
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response | null> {
  const { pathname } = new URL(req.url);

  // Exact prefix (avoid matching /tasksX)
  if (!(pathname === pathPrefix || pathname.startsWith(pathPrefix))) return null;

  try {
    const mod: T = (await import(modPath)) as T;

    // explicit handler if provided
    if (handlerName && typeof (mod as any)[handlerName] === "function") {
      return await (mod as any)[handlerName](req, env, ctx);
    }

    // Cloudflare Pages/Functions style
    if (typeof (mod as any).onRequest === "function") {
      return await (mod as any).onRequest({ request: req, env, ctx });
    }

    // Method-specific handlers
    const methodKey =
      req.method === "GET" ? "onRequestGet" :
      req.method === "POST" ? "onRequestPost" :
      req.method === "PUT" ? "onRequestPut" :
      req.method === "DELETE" ? "onRequestDelete" :
      null;

    if (methodKey && typeof (mod as any)[methodKey] === "function") {
      return await (mod as any)[methodKey]({ request: req, env, ctx });
    }

    // Generic handler(req, env, ctx)
    if (typeof (mod as any).handle === "function") {
      return await (mod as any).handle(req, env, ctx);
    }

    return new Response("Route module loaded but no handler found.", {
      status: 500,
      headers: cors({ "content-type": "text/plain; charset=utf-8" }),
    });
  } catch {
    // Module not present yet (PRs can land in any order)
    return new Response("Not Found", {
      status: 404,
      headers: cors({ "content-type": "text/plain; charset=utf-8" }),
    });
  }
}

export default {
  // ---------------- HTTP entry ----------------
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Preflight
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

    // Orders: Stripe / Tally webhooks (present only if those modules exist)
    if (url.pathname === "/webhooks/stripe") {
      const r = await tryRoute("/webhooks/stripe", "./orders/stripe", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }
    if (url.pathname === "/webhooks/tally") {
      const r = await tryRoute("/webhooks/tally", "./orders/tally", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // Minimal Telegram webhook
    if (url.pathname === "/telegram-webhook") {
      const r = await tryRoute("/telegram-webhook", "./routes/telegram", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // AI endpoints (e.g., /ai/ping, /ai/json, etc.)
    {
      const r = await tryRoute("/ai/", "./routes/ai", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // Legacy Apps Script proxy
    {
      const r = await tryRoute("/api/appscript", "./routes/appscript", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // Admin
    {
      const r = await tryRoute("/admin/", "./routes/admin", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // Planner / Compose / Schedule
    {
      const r = await tryRoute("/planner", "./routes/planner", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }
    {
      const r = await tryRoute("/compose", "./routes/planner", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }
    {
      const r = await tryRoute("/schedule", "./routes/planner", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // TikTok (uploader/engagement/schedule)
    {
      const r = await tryRoute("/tiktok/", "./routes/tiktok", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // Task queue
    {
      const r = await tryRoute("/tasks/", "./routes/tasks", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // Cron routes
    {
      const r = await tryRoute("/cron/", "./routes/cron", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // Browserless session
    {
      const r = await tryRoute("/api/browser", "./routes/browser", null, req, env, ctx);
      if (r && r.status !== 404) return r;
    }

    // Readiness
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
      return new Response("ready route not installed", {
        status: 404,
        headers: cors({ "content-type": "text/plain; charset=utf-8" }),
      });
    }

    // Default success ping
    return new Response("mags ok", {
      status: 200,
      headers: { ...cors(), "content-type": "text/plain; charset=utf-8" },
    });
  },

  // ------------- Cron (Cloudflare scheduled triggers) -------------
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Optional warm ping for Apps Script (kept harmless if not configured)
    try {
      const warmUrl = env?.APPS_SCRIPT_EXEC || env?.APPS_SCRIPT_WEBAPP_URL;
      if (warmUrl) ctx.waitUntil(fetch(warmUrl).then(() => {}));
    } catch {}

    // Let /routes/cron & /routes/tasks hook scheduled if they exist
    try {
      const cron: any = await import("./routes/cron");
      if (typeof cron.runScheduled === "function") ctx.waitUntil(cron.runScheduled(event, env));
      else if (typeof cron.onScheduled === "function") ctx.waitUntil(cron.onScheduled(event, env));
    } catch {}
    try {
      const tasks: any = await import("./routes/tasks");
      if (typeof tasks.onScheduled === "function") ctx.waitUntil(tasks.onScheduled(event, env));
    } catch {}
    try {
      const tiktok: any = await import("./routes/tiktok");
      if (typeof tiktok.onScheduled === "function") ctx.waitUntil(tiktok.onScheduled(event, env));
    } catch {}
    try {
      const planner: any = await import("./routes/planner");
      if (typeof planner.onScheduled === "function") ctx.waitUntil(planner.onScheduled(event, env));
    } catch {}
  },
};
