// worker/worker.ts — PUBLIC worker (KV-blob config via POSTQ["thread-state"])
//
// Public worker stays lean:
//   - GET  /health                     (KV + blob presence)
//   - GET  /diag/config                (non-secret booleans of what’s present in blob)
//   - ANY  /api/appscript*             (proxy to Apps Script web app)
//   - POST /telegram-webhook           (minimal Telegram -> handleTelegramCommand)
//   - GET  /tasks/tiktok/ping?key=...  (Browserless diagnostics)
//   - GET  /tasks/tiktok/post?...      (dry-run/live trigger; gated by WORKER_CRON_KEY)
//   - GET  /ai/ping                    (does an LLM provider exist in blob?)
//   - POST /ai/chat                    ({ user, system?, options? } -> text)
//   - POST /ai/json                    ({ user, system?, options? } -> JSON)
//
// IMPORTANT: All secrets come from a single KV JSON blob with key "thread-state"
// in your POSTQ namespace (binding name must be POSTQ).

import { handleTelegramCommand } from '../src/telegram/handleCommand';
import { handleTikTok } from './routes/tiktok';

export interface Env {
  POSTQ: KVNamespace; // KV binding defined in wrangler.toml
  [key: string]: any;
}

/* ---------------- Apps Script URL (static) ---------------- */

const APPS_SCRIPT_EXEC =
  'https://script.google.com/macros/s/AKfycbx4p2_JKlcnm7qgSohthqWqzEw5-Rtb4i5uf54opLEIbgrA2zCd1pMBT77ijZKpr55o/exec';

/* ---------------- CORS helper ---------------- */

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
  // Core providers
  OPENAI_API_KEY?: string;          // used by /ai/* endpoints
  BROWSERLESS_API_KEY?: string;
  BROWSERLESS_BASE_URL?: string;

  // Optional other stacks
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  NOTION_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;

  // Gate for manual triggers (/tasks/*)
  WORKER_CRON_KEY?: string;

  // TikTok sessions & handles
  TIKTOK_SESSION_MAIN?: string;
  TIKTOK_SESSION_WILLOW?: string;
  TIKTOK_SESSION_MAGGIE?: string;
  TIKTOK_SESSION_MARS?: string;

  TIKTOK_PROFILE_MAIN?: string;
  TIKTOK_PROFILE_WILLOW?: string;
  TIKTOK_PROFILE_MAGGIE?: string;
  TIKTOK_PROFILE_MARS?: string;

  // CapCut hints
  USE_CAPCUT?: string;      // "true"/"false"
  CAPCUT_TEMPLATE?: string; // e.g. "trending"

  // Optional fallback provider (GitHub Models)
  GITHUB_TOKEN?: string;    // only if you want the Worker to call it
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

/* ---------------- Small helpers ---------------- */

function okAuth(url: URL, cfg: MaggieConfig) {
  const key = url.searchParams.get('key');
  return !!key && key === (cfg.WORKER_CRON_KEY || '');
}

async function readJSON<T = any>(req: Request): Promise<T> {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error('Expected application/json');
  return (await req.json()) as T;
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

/* ---------------- AI (OpenAI primary, optional GitHub Models fallback) ---------------- */

async function aiChat(
  cfg: MaggieConfig,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<{ provider: 'openai' | 'github'; content: string }> {
  // Try OpenAI first
  if (cfg.OPENAI_API_KEY) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5',
        temperature: options?.temperature ?? 0.2,
        max_tokens: options?.maxTokens,
        messages,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
    }
    const content = json?.choices?.[0]?.message?.content ?? '';
    return { provider: 'openai', content };
  }

  // Fallback: GitHub Models (optional)
  if (cfg.GITHUB_TOKEN) {
    const res = await fetch('https://models.github.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5',
        temperature: options?.temperature ?? 0.2,
        max_tokens: options?.maxTokens,
        messages,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`GitHub Models error ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
    }
    const content = json?.choices?.[0]?.message?.content ?? '';
    return { provider: 'github', content };
  }

  throw new Error('No AI provider configured (OPENAI_API_KEY or GITHUB_TOKEN) in thread-state blob.');
}

function defaultSystemPromptFrom(cfg: MaggieConfig) {
  const bits: string[] = ['You are Mags, the Messy & Magnetic assistant.'];
  if (cfg.NOTION_API_KEY) bits.push('You can access Notion.');
  if (cfg.STRIPE_SECRET_KEY) bits.push('You can access Stripe.');
  return bits.join(' ');
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

    const tik = await handleTikTok(request, env);
    if (tik) return tik;

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
        GITHUB_TOKEN: mask('GITHUB_TOKEN'),
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

    // --- AI endpoints (fully KV-driven) ---

    if (url.pathname === '/ai/ping') {
      const cfg = await getBlob(env);
      const provider = cfg.OPENAI_API_KEY ? 'openai'
                    : cfg.GITHUB_TOKEN   ? 'github'
                    : 'none';
      return new Response(JSON.stringify({ ok: provider !== 'none', provider }), {
        headers: { 'content-type': 'application/json', ...cors() },
      });
    }

    // POST /ai/chat  { user: string, system?: string, options?: { temperature?: number, maxTokens?: number } }
    if (request.method === 'POST' && url.pathname === '/ai/chat') {
      try {
        const cfg = await getBlob(env);
        const { user, system, options } = await readJSON<{
          user: string;
          system?: string;
          options?: { temperature?: number; maxTokens?: number };
        }>(request);

        const sys = system ?? defaultSystemPromptFrom(cfg);
        const { content, provider } = await aiChat(
          cfg,
          [
            { role: 'system', content: sys },
            { role: 'user', content: String(user ?? '') },
          ],
          options
        );

        return new Response(JSON.stringify({ ok: true, provider, content }), {
          headers: { 'content-type': 'application/json', ...cors() },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
          status: 400, headers: { 'content-type': 'application/json', ...cors() },
        });
      }
    }

    // POST /ai/json  { user: string, system?: string, options?: { temperature?: number, maxTokens?: number } }
    if (request.method === 'POST' && url.pathname === '/ai/json') {
      try {
        const cfg = await getBlob(env);
        const { user, system, options } = await readJSON<{
          user: string;
          system?: string;
          options?: { temperature?: number; maxTokens?: number };
        }>(request);

        const sys = system ?? defaultSystemPromptFrom(cfg) + '\nReturn ONLY valid JSON.';
        const { content, provider } = await aiChat(
          cfg,
          [
            { role: 'system', content: sys },
            { role: 'user', content: String(user ?? '') },
          ],
          { temperature: options?.temperature ?? 0.1, maxTokens: options?.maxTokens }
        );

        let data: any;
        try {
          const cleaned = content.trim()
            .replace(/^```json\s*/i, '')
            .replace(/```$/i, '');
          data = JSON.parse(cleaned);
        } catch (e) {
          return new Response(JSON.stringify({
            ok: false, provider,
            error: 'Model did not return valid JSON', raw: content.slice(0, 2000)
          }), { status: 400, headers: { 'content-type': 'application/json', ...cors() } });
        }

        return new Response(JSON.stringify({ ok: true, provider, data }), {
          headers: { 'content-type': 'application/json', ...cors() },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
          status: 400, headers: { 'content-type': 'application/json', ...cors() },
        });
      }
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
          status: 500, headers: { 'content-type': 'application/json', ...cors() },
        });
      }
    }

    if (url.pathname === '/tasks/tiktok/post') {
      const cfg = await getBlob(env);
      if (!okAuth(url, cfg)) return new Response('unauthorized', { status: 401, headers: cors() });

      const profile = url.searchParams.get('profile') ?? 'maggie'; // main|willow|maggie|mars
      const dryRun  = url.searchParams.get('dry') === '1';

      const sessions: Record<string, string | undefined> = {
        main:   cfg.TIKTOK_SESSION_MAIN,
        willow: cfg.TIKTOK_SESSION_WILLOW,
        maggie: cfg.TIKTOK_SESSION_MAGGIE,
        mars:   cfg.TIKTOK_SESSION_MARS,
      };
      const handles: Record<string, string | undefined> = {
        main:   cfg.TIKTOK_PROFILE_MAIN,
        willow: cfg.TIKTOK_PROFILE_WILLOW,
        maggie: cfg.TIKTOK_PROFILE_MAGGIE,
        mars:   cfg.TIKTOK_PROFILE_MARS,
      };

      const session = sessions[profile];
      const handle  = handles[profile];

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

      // 👉 integrate your real post function here:
      // await postTikTok({ session, handle, dryRun, browserlessKey: cfg.BROWSERLESS_API_KEY!, base });

      return new Response(JSON.stringify({
        ok: true,
        profile, handle, dryRun,
        browserless: ping.ok,
        note: dryRun
          ? 'dry run; integrate your real TikTok routine where indicated'
          : 'trigger accepted; tail logs to follow execution'
      }, null, 2), {
        headers: { 'content-type': 'application/json', ...cors() },
      });
    }

    return new Response('Not found', { status: 404, headers: cors() });
  },
};