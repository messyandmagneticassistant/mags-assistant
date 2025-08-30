// worker/worker.ts — PUBLIC worker (serves your domain, Cloudflare-safe)

/**
 * ⚠️ IMPORTANT
 * - Do not import Node-only code here (no "../maggie/*", no libraries that need Node).
 * - Keep heavy/cron logic in mags-runner/worker.ts (your separate runner Worker).
 */

export interface Env {
  POSTQ: KVNamespace;

  // Optional bindings you already keep in KV/Secrets
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  NOTION_API_KEY?: string;
  NOTION_DB_ID?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  OPENAI_API_KEY?: string;
}

const APPS_SCRIPT_EXEC =
  'https://script.google.com/macros/s/AKfycbx4p2_JKlcnm7qgSohthqWqzEw5-Rtb4i5uf54opLEIbgrA2zCd1pMBT77ijZKpr55o/exec';

function cors(extra: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Stripe-Signature',
    ...extra,
  };
}

/** Proxy any request to your Apps Script Web App, preserving query/body/headers */
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

/** Minimal Telegram webhook handler (kept inline to avoid Node imports) */
async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const update = (await request.json()) as any;

    // If you want to simply ACK webhook (fastest):
    // return new Response('ok', { headers: cors() });

    // Optional: echo basic notifications to your chat
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      const text = formatTelegramUpdate(update);
      const api = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      await fetch(api, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
      }).catch(() => {});
    }

    return new Response('ok', { headers: cors() });
  } catch (err) {
    return new Response('telegram error', { status: 500, headers: cors() });
  }
}

function formatTelegramUpdate(update: any): string {
  try {
    if (update?.message?.text) {
      const from = update.message.from?.username
        ? `@${update.message.from.username}`
        : update.message.from?.first_name || 'user';
      return `📩 ${from}: ${update.message.text}`;
    }
    if (update?.message?.photo) return '🖼️ Received a photo';
    if (update?.message?.document) return `📎 Document: ${update.message.document?.file_name || ''}`;
    return '✅ Telegram webhook received';
  } catch {
    return '✅ Telegram webhook received';
  }
}

export default {
  /** Light cron: ping Apps Script to keep flows warm. Heavy work lives in mags-runner. */
  async scheduled(_e: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(fetch(`${APPS_SCRIPT_EXEC}?cmd=pulse`).catch(() => {}));
  },

  /** HTTP entry */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors() });

    // Root
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response('🧠 Maggie public worker is online — try /health', {
        headers: { 'content-type': 'text/plain', ...cors() },
      });
    }

    // Health (KV probe + binding presence)
    if (url.pathname === '/health') {
      const key = `health:${Date.now()}`;
      let kvWrite = false,
        kvRead = false;
      try {
        await env.POSTQ.put(key, 'ok', { expirationTtl: 60 });
        kvWrite = true;
        kvRead = (await env.POSTQ.get(key)) === 'ok';
      } catch {}
      const payload = {
        ok: kvWrite && kvRead,
        service: 'maggie-public-worker',
        kv: { write: kvWrite, read: kvRead },
        bindings: {
          POSTQ: !!env.POSTQ,
          STRIPE_SECRET_KEY: !!env.STRIPE_SECRET_KEY,
          NOTION_API_KEY: !!env.NOTION_API_KEY,
          TELEGRAM_BOT_TOKEN: !!env.TELEGRAM_BOT_TOKEN,
          TELEGRAM_CHAT_ID: !!env.TELEGRAM_CHAT_ID,
          OPENAI_API_KEY: !!env.OPENAI_API_KEY,
        },
        ts: new Date().toISOString(),
      };
      return new Response(JSON.stringify(payload, null, 2), {
        headers: { 'content-type': 'application/json', ...cors() },
      });
    }

    // Transparent proxy to Apps Script
    if (url.pathname.startsWith('/api/appscript')) {
      return proxyAppsScript(request, url);
    }

    // Telegram webhook (set this URL in BotFather)
    if (request.method === 'POST' && url.pathname === '/telegram-webhook') {
      return handleTelegramWebhook(request, env);
    }

    return new Response('Not found', { status: 404, headers: cors() });
  },
};