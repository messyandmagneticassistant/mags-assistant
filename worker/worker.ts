// worker/worker.ts — finalized unified router (KV-first, CORS, cron-safe)
import { handleHealth } from './health';
import { handleDiagConfig } from './diag';
import type { Env } from './lib/env';
import { syncThreadStateFromGitHub } from './lib/threadStateSync';
import { serveStaticSite } from './lib/site';
import { loadState } from './lib/state';
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

  if (!(pathname === pathPrefix || pathname.startsWith(pathPrefix))) return null;

  try {
    const mod: T = (await import(modPath)) as T;

    if (handlerName && typeof (mod as any)[handlerName] === "function") {
      return await (mod as any)[handlerName](req, env, ctx);
    }

    // Cloudflare Functions style
    if (typeof (mod as any).onRequest === "function") {
      return await (mod as any).onRequest({ request: req, env, ctx });
    }

    const methodKey =
      req.method === "GET" ? "onRequestGet" :
      req.method === "POST" ? "onRequestPost" :
      req.method === "PUT" ? "onRequestPut" :
      req.method === "DELETE" ? "onRequestDelete" :
      null;

    if (methodKey && typeof (mod as any)[methodKey] === "function") {
      return await (mod as any)[methodKey]({ request: req, env, ctx });
    }

    if (typeof (mod as any).handle === "function") {
      return await (mod as any).handle(req, env, ctx);
    }

    return new Response("Route module loaded but no handler found.", {
      status: 500,
      headers: cors({ "content-type": "text/plain; charset=utf-8" }),
    });
  } catch {
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
    try {
      const siteResponse = await serveStaticSite(req, env);
      if (siteResponse) {
        return siteResponse;
      }

      if (url.pathname === '/' || url.pathname === '/health') {
        return await handleHealth(env);
      }
      if (url.pathname === '/diag/config') {
        return await handleDiagConfig(env);
      }

      if (url.pathname === '/status') {
        const state = await loadState(env);
        const socialQueue = {
          scheduled: state.scheduledPosts?.length || 0,
          flopsRetry: state.flopRetries?.length || 0,
          nextPost: state.scheduledPosts?.[0] || null,
        };
        const status = {
          time: new Date().toISOString(),
          currentTasks: state.currentTasks || ['idle'],
          lastCheck: state.lastCheck || null,
          website: 'https://messyandmagnetic.com',
          socialQueue,
        };
        return new Response(JSON.stringify(status, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/summary') {
        const state = await loadState(env);
        const topTrends = Array.isArray((state as any).topTrends) ? (state as any).topTrends : [];
        const socialQueue = {
          scheduled: state.scheduledPosts?.length || 0,
          flopsRetry: state.flopRetries?.length || 0,
          nextPost: state.scheduledPosts?.[0] || null,
        };
        const summary = {
          time: new Date().toISOString(),
          currentTasks: state.currentTasks || ['idle'],
          lastCheck: state.lastCheck || null,
          website: 'https://messyandmagnetic.com',
          socialQueue,
          topTrends,
        };
        return new Response(JSON.stringify(summary, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === "/init-blob") {
        if (req.method !== "POST") {
          return new Response("init-blob requires POST", {
            status: 405,
            headers: cors({ "content-type": "text/plain", "Allow": "POST" }),
          });
        }

        const kv = (env as any).PostQ ?? (env as any).BRAIN;
        if (!kv || typeof kv.put !== "function" || typeof kv.get !== "function") {
          return new Response("KV binding missing (need PostQ or BRAIN)", {
            status: 500,
            headers: cors({ "content-type": "text/plain" }),
          });
        }

        const blobKey = "thread-state";
        const existing = await kv.get(blobKey);
        if (existing) {
          return new Response("⚠️ Blob already exists", {
            status: 409,
            headers: cors({ "content-type": "text/plain" }),
          });
        }

        const blob = {
          version: "v1",
          lastUpdated: new Date().toISOString(),
          profile: {
            name: "Maggie",
            role: "Full-stack assistant",
          },
          subdomains: [
            "maggie.messyandmagnetic.com",
            "assistant.messyandmagnetic.com"
          ],
          kvNamespace: "PostQ",
          services: {
            gmail: true,
            stripe: true,
            tally: true,
            notion: true,
            tikTok: true,
            n8n: true,
            googleDrive: true,
          },
          automation: {
            soulReadings: true,
            farmStand: true,
            postScheduler: true,
            readingDelivery: true,
            stripeAudit: true,
            magnetMatch: true,
          },
          notes: "Blob initialized",
          lastSynced: null,
        };

        await kv.put(blobKey, JSON.stringify(blob));

        return new Response("✅ Maggie’s thread-state blob was initialized into PostQ", {
          status: 200,
          headers: cors({ "content-type": "text/plain" }),
        });
      }
      
      // Preflight
      if (isPreflight(req)) {
        return new Response(null, { status: 204, headers: cors() });
      }

      // Diagnostics
      if (url.pathname === "/diag/email" && req.method === "GET") {
      const { getEmailConfig } = await import("../utils/email");
      const { fromEmail, fromName, apiKey } = getEmailConfig(env);
      const domain = fromEmail.split("@")[1] || "";
      let domainVerified: boolean | undefined;
      if (apiKey) {
        try {
          const resp = await fetch("https://api.resend.com/domains", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          const data = await resp.json();
          const match = data?.data?.find((d: any) => d.name === domain);
          domainVerified = match?.status === "verified";
        } catch {}
      }
      return new Response(
        JSON.stringify({ ok: true, from: `${fromName} <${fromEmail}>`, domain, domainVerified }),
        { status: 200, headers: cors({ "content-type": "application/json" }) }
      );
    }

      if (url.pathname === "/diag/email/test" && req.method === "POST") {
        const r = await tryRoute("/diag/email/test", "./routes/email", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }

      // --- Admin special-casing to match admin.ts signatures ---
      if (url.pathname === "/admin/status" && req.method === "GET") {
        try {
          const admin: any = await import("./routes/admin");
          // admin.onRequestGet expects { env }
          return await admin.onRequestGet({ env });
        } catch {}
      }
      if (url.pathname === "/admin/trigger" && req.method === "POST") {
        try {
          const admin: any = await import("./routes/admin");
          // admin.onRequestPost expects (request)
          return await admin.onRequestPost(req);
        } catch {}
      }
      // Fallback for any future /admin/* routes that use the generic pattern
      {
        const r = await tryRoute("/admin/", "./routes/admin", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }

      // Orders: Stripe / Tally webhooks
      if (url.pathname === "/webhooks/stripe") {
        const r = await tryRoute("/webhooks/stripe", "./orders/stripe", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }
      if (url.pathname === "/webhooks/tally") {
        const r = await tryRoute("/webhooks/tally", "./orders/tally", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }

      // Orders links
      {
        const r = await tryRoute("/orders", "./routes/orders", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }

      // Donor endpoints
      {
        const r = await tryRoute("/donors", "./routes/donors", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }

      // Admin config endpoints
      if (url.pathname === "/admin/config") {
        const r = await tryRoute("/admin/config", "./routes/config", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }

      // Offerings (products catalog)
      if (url.pathname === "/api/offerings") {
        const r = await tryRoute("/api/offerings", "./routes/offerings", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }

      // Minimal Telegram webhook
      if (url.pathname === "/telegram-webhook") {
        const r = await tryRoute("/telegram-webhook", "./routes/telegram", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }

      // AI endpoints
      {
        const r = await tryRoute("/ai/", "./routes/ai", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }

      // Legacy Apps Script proxy
      {
        const r = await tryRoute("/api/appscript", "./routes/appscript", null, req, env, ctx);
        if (r && r.status !== 404) return r;
      }

      // Blueprint builder
      {
        const r = await tryRoute("/blueprint", "./routes/blueprint", null, req, env, ctx);
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

      // Default not-found
      return new Response(
        JSON.stringify({ ok: false, error: "not-found", path: url.pathname }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    } catch (err: any) {
      console.error("[worker] top-level crash:", err?.stack || err);
      return new Response(JSON.stringify({ ok: false, error: "unhandled" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  },

  // ------------- Cron (Cloudflare scheduled triggers) -------------
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Optional warm ping (harmless if unset)
    try {
      const warmUrl = env?.APPS_SCRIPT_EXEC || env?.APPS_SCRIPT_WEBAPP_URL;
      if (warmUrl) ctx.waitUntil(fetch(warmUrl).then(() => {}));
    } catch {}

    try {
      ctx.waitUntil(syncThreadStateFromGitHub(env));
    } catch (err) {
      console.error('[worker.cron] failed to enqueue thread-state sync:', err);
    }

    // Let optional modules hook scheduled if present
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