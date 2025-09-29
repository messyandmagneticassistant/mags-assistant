// worker/worker.ts — finalized unified router (KV-first, CORS, cron-safe)
import { handleHealth } from './health';
import { handleDiagConfig } from './diag';
import type { Env } from './lib/env';
import { syncThreadStateFromGitHub } from './lib/threadStateSync';
import { serveStaticSite } from './lib/site';
import {
  bootstrapWorker,
  gatherStatus,
  gatherSummary,
  handleScheduled as handleAutomationScheduled,
} from './index';
import * as cronRoutes from './routes/cron';
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

const corsHeaders = cors({ "content-type": "application/json; charset=utf-8" });

const WELL_KNOWN_ROUTES = [
  "/ping",
  "/ping-debug",
  "/hello",
  "/health",
  "/ready",
  "/status",
  "/summary",
];

type BasicPingPayload = {
  ok: true;
  message: string;
  timestamp: string;
  hostname: string;
  colo?: string;
  version: string | null;
  routes: string[];
  telegramConfigured: boolean;
};

type PingDebugPayload = BasicPingPayload & {
  message: string;
  envKeys: string[];
  bindings: Record<string, string>;
};

function describeBinding(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "unset";
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean" || type === "bigint") {
    return type;
  }
  if (type === "function") return "function";
  if (type === "object") {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.get === "function" && typeof candidate.put === "function") {
      return "KVNamespace";
    }
    if (typeof candidate.send === "function") {
      return "Queue";
    }
    if (typeof candidate.idFromName === "function") {
      return "DurableObjectNamespace";
    }
    const ctor = (value as { constructor?: { name?: string } }).constructor;
    if (ctor?.name) return `object:${ctor.name}`;
    return "object";
  }
  return "unknown";
}

function hasTelegramCredentials(env: Env): boolean {
  try {
    getTelegramCredentials(env);
    return true;
  } catch {
    return false;
  }
}

function buildPingPayload(env: Env, url: URL, colo?: string): BasicPingPayload {
  return {
    ok: true,
    message: "Ping successful",
    timestamp: new Date().toISOString(),
    hostname: url.hostname,
    colo,
    version: getWorkerVersion(env),
    routes: WELL_KNOWN_ROUTES,
    telegramConfigured: hasTelegramCredentials(env),
  };
}

function buildPingDebugPayload(env: Env, url: URL, colo?: string): PingDebugPayload {
  const keys = Array.from(new Set(Object.keys(env as Record<string, unknown>)));
  keys.sort();

  const bindings = keys.reduce<Record<string, string>>((acc, key) => {
    try {
      acc[key] = describeBinding((env as Record<string, unknown>)[key]);
    } catch (err) {
      acc[key] = `error:${err instanceof Error ? err.message : String(err)}`;
    }
    return acc;
  }, {});

  return {
    ...buildPingPayload(env, url, colo),
    message: "Ping debug",
    envKeys: keys,
    bindings,
  };
}

type TelegramCredentials = {
  token: string;
  chatId: string;
};

type TelegramSendResult = {
  ok: boolean;
  status: number;
  body: any;
};

function getTelegramCredentials(env: Env): TelegramCredentials {
  const token =
    (env as any).TELEGRAM_TOKEN ||
    env.TELEGRAM_TOKEN ||
    (env as any).TELEGRAM_BOT_TOKEN ||
    env.TELEGRAM_BOT_TOKEN;
  const chatId = (env as any).TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error("Missing Telegram credentials");
  }

  return { token: String(token), chatId: String(chatId) };
}

async function sendTelegramMessage(
  credentials: TelegramCredentials,
  text: string
): Promise<TelegramSendResult> {
  const response = await fetch(`https://api.telegram.org/bot${credentials.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: credentials.chatId,
      text,
    }),
  });

  const body = await response.json().catch(() => ({}));

  return {
    ok: response.ok && !!body?.ok,
    status: response.status,
    body,
  };
}

function getWorkerVersion(env: Env): string | null {
  const candidate =
    (env as any).WORKER_VERSION ||
    (env as any).BUILD_VERSION ||
    (env as any).COMMIT_SHA ||
    (env as any).GIT_SHA ||
    (env as any).VERSION ||
    null;

  return candidate ? String(candidate) : null;
}

type PingResponse = {
  ok: boolean;
  sent: boolean;
  path: string;
  status: string;
  source: string;
  telegram?: {
    status: number;
    body: any;
  };
  error?: string;
};

async function performPing(env: Env, source: string): Promise<{ status: number; payload: PingResponse }> {
  try {
    const credentials = getTelegramCredentials(env);
    const result = await sendTelegramMessage(credentials, "Maggie ping test");

    const payload: PingResponse = {
      ok: result.ok,
      sent: result.ok,
      path: "/ping",
      status: result.ok ? "sent" : "telegram-failed",
      source,
      telegram: {
        status: result.status,
        body: result.body,
      },
    };

    if (!result.ok) {
      const error = result.body?.description || `Telegram returned status ${result.status}`;
      payload.error = error;
      console.error("[worker:/ping] Telegram delivery failed", {
        source,
        status: result.status,
        error,
        body: result.body,
      });
      return { status: 502, payload };
    }

    return { status: 200, payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const payload: PingResponse = {
      ok: false,
      sent: false,
      path: "/ping",
      status: "error",
      source,
      error: message,
    };
    console.error("[worker:/ping] Unexpected failure", { source, error: message });
    return { status: 500, payload };
  }
}

type PingDebugResponse = {
  ok: boolean;
  sent: boolean;
  path: string;
  method: string;
  source: string;
  time: string;
  workerVersion: string | null;
  tokenEnding: string | null;
  status: string;
  telegram?: {
    ok: boolean;
    status: number;
    body: any;
  } | null;
  error?: string;
};

async function performPingDebug(
  env: Env,
  source: string,
  method: string
): Promise<{ status: number; payload: PingDebugResponse }> {
  const time = new Date().toISOString();

  try {
    const credentials = getTelegramCredentials(env);
    const tokenEnding = credentials.token.slice(-5);
    const result = await sendTelegramMessage(credentials, "Ping-debug request received");

    const payload: PingDebugResponse = {
      ok: result.ok,
      sent: result.ok,
      path: "/ping-debug",
      method,
      source,
      time,
      workerVersion: getWorkerVersion(env),
      tokenEnding,
      status: result.ok ? "sent" : "telegram-failed",
      telegram: {
        ok: result.ok,
        status: result.status,
        body: result.body,
      },
    };

    if (result.ok) {
      console.log(`[worker:/ping-debug:${source}]`, JSON.stringify(payload));
      return { status: 200, payload };
    }

    const error = result.body?.description || `Telegram returned status ${result.status}`;
    payload.error = error;
    console.error(`[worker:/ping-debug:${source}] Telegram delivery failed`, payload);
    return { status: 502, payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const payload: PingDebugResponse = {
      ok: false,
      sent: false,
      path: "/ping-debug",
      method,
      source,
      time,
      workerVersion: getWorkerVersion(env),
      tokenEnding: null,
      status: "error",
      telegram: null,
      error: message,
    };
    console.error(`[worker:/ping-debug:${source}] Unexpected failure`, payload);
    return { status: 500, payload };
  }
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
      await bootstrapWorker(env, req, ctx);
      const siteResponse = await serveStaticSite(req, env);
      if (siteResponse) {
        return siteResponse;
      }

      if (req.method === "GET" && url.pathname === "/ping") {
        const colo = typeof (req as any).cf?.colo === "string" ? (req as any).cf.colo : undefined;
        const payload = buildPingPayload(env, url, colo);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: corsHeaders,
        });
      }

      if (req.method === "GET" && url.pathname === "/hello") {
        const colo = typeof (req as any).cf?.colo === "string" ? (req as any).cf.colo : undefined;
        const payload = {
          ...buildPingPayload(env, url, colo),
          message: "Hello from Maggie Worker",
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: corsHeaders,
        });
      }

      if (url.pathname === '/' || url.pathname === '/health') {
        return await handleHealth(env);
      }
      if (url.pathname === '/diag/config') {
        return await handleDiagConfig(env);
      }

      if (url.pathname === '/status') {
        const { snapshot, state, time } = await gatherStatus(env);
        const autonomy = (typeof state.autonomy === 'object' && state.autonomy !== null
          ? state.autonomy
          : {}) as Record<string, any>;
        const actions = Array.isArray(autonomy.lastActions) ? autonomy.lastActions : [];
        const errors = Array.isArray(autonomy.lastErrors) ? autonomy.lastErrors : [];
        const warnings = Array.isArray(autonomy.lastWarnings) ? autonomy.lastWarnings : [];
        const history = Array.isArray(autonomy.history) ? autonomy.history.slice(0, 50) : [];
        const socialQueue = {
          scheduled: snapshot.scheduledPosts,
          flopsRetry: snapshot.retryQueue,
          nextPost: Array.isArray(state.scheduledPosts) ? state.scheduledPosts[0] : null,
        };
        const nextRun = snapshot.runtime.lastTick
          ? new Date(new Date(snapshot.runtime.lastTick).getTime() + 10 * 60 * 1000).toISOString()
          : null;
        const status = {
          time,
          currentTasks: snapshot.currentTasks,
          lastCheck: state.lastCheck || null,
          website: state.website || 'https://messyandmagnetic.com',
          socialQueue,
          lastRun: autonomy.lastRunAt ?? null,
          nextRun,
          actions,
          errors,
          warnings,
          autonomy: {
            ...autonomy,
            history,
          },
          topTrends: snapshot.topTrends,
          paused: snapshot.paused,
          scheduler: snapshot.runtime,
        };
        return new Response(JSON.stringify(status, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/summary') {
        const { snapshot, state, time } = await gatherSummary(env);
        const socialQueue = {
          scheduled: snapshot.scheduledPosts,
          flopsRetry: snapshot.retryQueue,
          nextPost: Array.isArray(state.scheduledPosts) ? state.scheduledPosts[0] : null,
        };
        const summary = {
          time,
          currentTasks: snapshot.currentTasks,
          lastCheck: state.lastCheck || null,
          website: state.website || 'https://messyandmagnetic.com',
          socialQueue,
          topTrends: snapshot.topTrends,
          paused: snapshot.paused,
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

      // Telegram webhook (legacy + canonical)
      if (url.pathname === "/telegram" || url.pathname === "/telegram-webhook") {
        const prefix = url.pathname === "/telegram" ? "/telegram" : "/telegram-webhook";
        const r = await tryRoute(prefix, "./routes/telegram", null, req, env, ctx);
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
        const r = await tryRoute("/cricut", "./routes/cricut", null, req, env, ctx);
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

      if (url.pathname === "/ping-debug" && req.method === "GET") {
        const colo = typeof (req as any).cf?.colo === "string" ? (req as any).cf.colo : undefined;
        const payload = buildPingDebugPayload(env, url, colo);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: corsHeaders,
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
      ctx.waitUntil(handleAutomationScheduled(event, env, ctx).then(() => {}));
    } catch (err) {
      console.error('[worker.cron] automation tick failed:', err);
    }

    if (event.cron === '0 7 * * *') {
      ctx.waitUntil(
        (async () => {
          const pingResult = await performPing(env, 'cron');
          if (!pingResult.payload.ok) {
            console.error('[worker.cron] nightly /ping failed', pingResult.payload);
          }

          const debugResult = await performPingDebug(env, 'cron', 'CRON');
          if (!debugResult.payload.ok) {
            console.error('[worker.cron] nightly /ping-debug failed', debugResult.payload);
          }
        })().catch((err) => console.error('[worker.cron] ping routine crashed', err))
      );
    }

    try {
      ctx.waitUntil(syncThreadStateFromGitHub(env));
    } catch (err) {
      console.error('[worker.cron] failed to enqueue thread-state sync:', err);
    }

    // Let optional modules hook scheduled if present
    try {
      if (typeof (cronRoutes as any).runScheduled === 'function') {
        ctx.waitUntil((cronRoutes as any).runScheduled(event, env));
      } else if (typeof (cronRoutes as any).onScheduled === 'function') {
        ctx.waitUntil((cronRoutes as any).onScheduled(event, env));
      }
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