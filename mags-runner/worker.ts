// worker.ts (final)
import { handleTelegramWebhook } from './src/handlers/telegram';
import { runMaggie } from './maggie/index';

// 👇 paste your Apps Script Web App URL here once
const APPS_SCRIPT_EXEC =
  'https://script.google.com/macros/s/AKfycbx4p2_JKlcnm7qgSohthqWqzEw5-Rtb4i5uf54opLEIbgrA2zCd1pMBT77ijZKpr55o/exec';

function cors(headers: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    ...headers,
  };
}

async function proxyAppsScript(request: Request, url: URL) {
  const target = new URL(APPS_SCRIPT_EXEC);
  target.search = url.search;

  const init: RequestInit = { method: request.method, headers: {} };
  const ct = request.headers.get('content-type');
  if (ct) (init.headers as any)['content-type'] = ct;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  const r = await fetch(target.toString(), init);
  const body = await r.arrayBuffer();
  const h = new Headers(r.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return new Response(body, { status: r.status, headers: h });
}

export default {
  // 🔁 Cron (set in Cloudflare → Triggers) e.g. every 10 min
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log('⏰ mags-runner tick at', event.cron);
    // 1) run Maggie loop
    ctx.waitUntil(runMaggie({ force: false }));
    // 2) gently ping Apps Script (keeps sheet sync / donor wave / etc. alive if you wire pulse)
    ctx.waitUntil(fetch(`${APPS_SCRIPT_EXEC}?cmd=pulse`).catch(() => {}));
  },

  // 🌐 HTTP
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: cors() });
    }

    // Health
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'maggie-worker' }), {
        headers: { 'content-type': 'application/json', ...cors() },
      });
    }

    // Forward to Apps Script
    if (url.pathname.startsWith('/api/appscript')) {
      return proxyAppsScript(request, url);
    }

    // Telegram webhook (POST /telegram-webhook)
    if (request.method === 'POST' && url.pathname === '/telegram-webhook') {
      try {
        return await handleTelegramWebhook(request);
      } catch (err) {
        console.error('[worker] Telegram webhook error:', err);
        return new Response('Error handling Telegram webhook', { status: 500 });
      }
    }

    // Default
    return new Response('🧠 Maggie is online and running.', {
      headers: { 'Content-Type': 'text/plain', ...cors() },
    });
  },
};