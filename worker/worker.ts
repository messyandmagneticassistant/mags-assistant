// worker/worker.ts — PUBLIC worker (KV-blob config via POSTQ["thread-state"])
//
// Keeps public worker lean: health, Apps Script proxy, Telegram webhook,
// + TikTok/Browserless ping + trigger. All config comes from a single KV JSON blob.
//
// IMPORTANT: The KV namespace binding is POSTQ. The key inside the namespace is "thread-state".

import { handleTelegramCommand } from '../src/telegram/handleCommand';

export interface Env {
  POSTQ: KVNamespace;
}

const APPS_SCRIPT_EXEC =
  'https://script.google.com/macros/s/AKfycbx4p2_JKlcnm7qgSohthqWqzEw5-Rtb4i5uf54opLEIbgrA2zCd1pMBT77ijZKpr55o/exec';

function cors(extra: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,Stripe-Signature,X-Requested-With',
    ...extra,
  };
}

/* ---------------- KV blob loader with short cache ---------------- */

type MaggieConfig = {
  OPENAI_API_KEY?: string;
  BROWSERLESS_API_KEY?: string;
  BROWSERLESS_BASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  NOTION_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;

  WORKER_CRON_KEY?: string;

  TIKTOK_SESSION_MAIN?: string;
  TIKTOK_SESSION_WILLOW?: string;
  TIKTOK_SESSION_MAGGIE?: string;
  TIKTOK_SESSION_MARS?: string;

  TIKTOK_PROFILE_MAIN?: string;
  TIKTOK_PROFILE_WILLOW?: string;
  TIKTOK_PROFILE_MAGGIE?: string;
  TIKTOK_PROFILE_MARS?: string;

  USE_CAPCUT?: string;      // "true"/"false"
  CAPCUT_TEMPLATE?: string; // e.g. "trending"
};

const BLOB_KEY = 'thread-state'; // <— your KV blob key
let _cachedBlob: MaggieConfig | null = null;
let _cachedAt = 0;
const CACHE_MS = 60_000; // 60s

async function getBlob(env: Env): Promise<MaggieConfig> {
  const now = Date.now();
  if (_cachedBlob && now - _cachedAt < CACHE_MS) return _cachedBlob;
  const json = await env.POSTQ.get(BLOB_KEY, 'json').catch(() => null);
  _cachedBlob = (json as MaggieConfig) || {};
  _cachedAt = now;
  return _cachedBlob!;
}

/* ---------------- Helpers ---------------- */

function okAuth(url: URL, cfg: MaggieConfig) {
  const key = url.searchParams.get('key');
  return !!key && key === (cfg.WORKER_CRON_KEY || '');
}

/** Transparent proxy to your Apps Script Web App */
async function proxyAppsScript(request: Request, url: URL) {
  const target = new URL(APPS_SCRIPT_EXEC);
  target.search = url.search;

  const init: RequestInit = { method: request.method, headers: {} };
  const ct = request.headers.get('content-type');
  if (ct) (init.headers as any)['content-type'] = ct;

  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  const r = await fetch(target.toString(), init);
  const body = await r.arrayBuffer();
  const h = new Headers(r.headers);
  Object.entries(cors()).forEach(([k, v]) => h.set(k, v));
  return new Response(body, { status: r.status, headers: h });
}

/** Minimal Telegram webhook: adapts your src/telegram/handleCommand(text) */
async function handleTelegramWebhook(request: Request): Promise<Response> {
  try {
    let text: string | undefined;
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const update = (await request.json()) as any;
      const msg = update?.message ?? update?.edited_message;
      text = msg?.text?.trim();
    } else {
      text = (await request.text()).trim();
    }
    if (!text) return new Response('ok', { headers: cors() });
    await handleTelegramCommand(text);
    return new Response('ok', { headers: cors() });
  } catch (e) {
    console.error('[worker] Telegram webhook error:', e);
    return new Response('Telegram error', { status: 500, headers: cors() });
  }
}

/* ---------------- Worker entry ---------------- */

export default {
  // optional warm ping
  async scheduled(_e: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(fetch(`${APPS_SCRIPT_EXEC}?cmd=pulse`).catch(() => {}));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors() });

    // Root
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response('🧠 Maggie is online — try /health', {
        headers: { 'content-type': 'text/plain', ...cors() },
      });
    }

    // Health (KV read/write + blob presence only)
    if (url.pathname === '/health') {
      const key = `health:${Date.now()}`;
      let write = false, read = false, blobOk = false;
      try {
        await env.POSTQ.put(key, 'ok', { expirationTtl: 60 });
        write = true;
        read = (await env.POSTQ.get(key)) === 'ok';
      } catch {}
      try {
        const blob = await getBlob(env);
        blobOk = !!blob && typeof blob === 'object';
      } catch {}
      const payload = {
        ok: write && read && blobOk,
        service: 'maggie-public-worker',
        kv: { write, read, thread_state_present: blobOk },
        ts: new Date().toISOString(),
      };
      return new Response(JSON.stringify(payload, null, 2), {
        headers: { 'content-type': 'application/json', ...cors() },
      });
    }

    // Non-secret diag (booleans only)
    if (url.pathname === '/diag/config') {
      const cfg = await getBlob(env);
      const mask = (k: keyof MaggieConfig) => !!(cfg[k] && String(cfg[k]).trim().length);
      const present = {
        OPENAI_API_KEY: mask('OPENAI_API_KEY'),
        BROWSERLESS_API_KEY: mask('BROWSERLESS_API_KEY'),
        BROWSERLESS_BASE_URL: mask('BROWSERLESS_BASE_URL'),
        STRIPE_SECRET_KEY: mask('STRIPE_SECRET_KEY'),
        STRIPE_WEBHOOK_SECRET: mask('STRIPE_WEBHOOK_SECRET'),
        NOTION_API_KEY: mask('NOTION_API_KEY'),
        TELEGRAM_BOT_TOKEN: mask('TELEGRAM_BOT_TOKEN'),
        TELEGRAM_CHAT_ID: mask('TELEGRAM_CHAT_ID'),
        WORKER_CRON_KEY: mask('WORKER_CRON_KEY'),
        TIKTOK_SESSION_MAIN: mask('TIKTOK_SESSION_MAIN'),
        TIKTOK_SESSION_WILLOW: mask('TIKTOK_SESSION_WILLOW'),
        TIKTOK_SESSION_MAGGIE: mask('TIKTOK_SESSION_MAGGIE'),
        TIKTOK_SESSION_MARS: mask('TIKTOK_SESSION_MARS'),
        TIKTOK_PROFILE_MAIN: mask('TIKTOK_PROFILE_MAIN'),
        TIKTOK_PROFILE_WILLOW: mask('TIKTOK_PROFILE_WILLOW'),
        TIKTOK_PROFILE_MAGGIE: mask('TIKTOK_PROFILE_MAGGIE'),
        TIKTOK_PROFILE_MARS: mask('TIKTOK_PROFILE_MARS'),
        USE_CAPCUT: mask('USE_CAPCUT'),
        CAPCUT_TEMPLATE: mask('CAPCUT_TEMPLATE'),
      };
      return new Response(JSON.stringify({ ok: true, present }, null, 2), {
        headers: { 'content-type': 'application/json', ...cors() },
      });
    }

    // Apps Script proxy
    if (url.pathname.startsWith('/api/appscript')) {
      return proxyAppsScript(request, url);
    }

    // Telegram webhook
    if (request.method === 'POST' && url.pathname === '/telegram-webhook') {
      return handleTelegramWebhook(request);
    }

    // -------- TikTok / Browserless: ping & post from KV blob --------

    // 1) Browserless connectivity ping
    if (url.pathname === '/tasks/tiktok/ping') {
      const cfg = await getBlob(env);
      if (!okAuth(url, cfg)) return new Response('unauthorized', { status: 401, headers: cors() });

      const base = cfg.BROWSERLESS_BASE_URL || 'https://chrome.browserless.io';
      try {
        const r = await fetch(`${base}/sessions`, {
          headers: { 'x-api-key': String(cfg.BROWSERLESS_API_KEY || '') },
        });
        return new Response(JSON.stringify({ ok: r.ok, status: r.status, base }), {
          headers: { 'content-type': 'application/json', ...cors() },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), {
          status: 500,
          headers: { 'content-type': 'application/json', ...cors() },
        });
      }
    }

    // 2) Trigger a TikTok post (dry or live)
    if (url.pathname === '/tasks/tiktok/post') {
      const cfg = await getBlob(env);
      if (!okAuth(url, cfg)) return new Response('unauthorized', { status: 401, headers: cors() });

      const profile = url.searchParams.get('profile') ?? 'maggie'; // main | willow | maggie | mars
      const dryRun = url.searchParams.get('dry') === '1';

      const sessions: Record<string, string | undefined> = {
        main: cfg.TIKTOK_SESSION_MAIN,
        willow: cfg.TIKTOK_SESSION_WILLOW,
        maggie: cfg.TIKTOK_SESSION_MAGGIE,
        mars: cfg.TIKTOK_SESSION_MARS,
      };
      const handles: Record<string, string | undefined> = {
        main: cfg.TIKTOK_PROFILE_MAIN,
        willow: cfg.TIKTOK_PROFILE_WILLOW,
        maggie: cfg.TIKTOK_PROFILE_MAGGIE,
        mars: cfg.TIKTOK_PROFILE_MARS,
      };

      const session = sessions[profile];
      const handle = handles[profile];

      if (!session) {
        return new Response(
          JSON.stringify({ ok: false, error: `missing session for ${profile}` }),
          { status: 400, headers: { 'content-type': 'application/json', ...cors() } }
        );
      }

      // optional Browserless sanity check
      const base = cfg.BROWSERLESS_BASE_URL || 'https://chrome.browserless.io';
      const ping = await fetch(`${base}/sessions`, {
        headers: { 'x-api-key': String(cfg.BROWSERLESS_API_KEY || '') },
      });

      // 👉 put your real post function here when ready:
      // await postTikTok({ session, handle, dryRun, browserlessKey: cfg.BROWSERLESS_API_KEY!, base });

      return new Response(
        JSON.stringify(
          {
            ok: true,
            profile,
            handle,
            dryRun,
            browserless: ping.ok,
            note: dryRun
              ? 'dry run; integrate your real TikTok routine where indicated'
              : 'trigger accepted; tail logs to follow execution',
          },
          null,
          2
        ),
        { headers: { 'content-type': 'application/json', ...cors() } }
      );
    }

    return new Response('Not found', { status: 404, headers: cors() });
  },
};