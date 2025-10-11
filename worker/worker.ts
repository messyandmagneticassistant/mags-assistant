// worker/worker.ts — finalized unified router (KV-first, CORS, cron-safe)
import Stripe from 'stripe';
import { handleHealth } from './health';
import { handleDiagConfig } from './diag';
import {
  DEFAULT_GEMINI_API_BASE,
  DEFAULT_GEMINI_MODEL,
  getBrainStateSnapshot,
  recordBrainUpdate,
  setGeminiSyncState,
  storeCodexTags,
  type GeminiSyncState,
} from './brain';
import type { Env } from './lib/env';
import { syncThreadStateFromGitHub, syncBrainDocFromGitHub } from './lib/threadStateSync';
import { serveStaticSite } from './lib/site';
import {
  bootstrapWorker,
  gatherStatus,
  gatherSummary,
  handleScheduled as handleAutomationScheduled,
} from './index';
import * as cronRoutes from './routes/cron';
import {
  buildDailyMessage,
  gatherDailyMetrics,
  getAdminSecret,
  getWorkerRoutes,
  getWorkerVersion,
  listAllKvKeys,
  type DailyMetrics,
} from './lib/reporting';
import { getSendTelegram, type SendTelegramResult as TelegramHelperResult } from './lib/telegramBridge';
import { router } from './router/router';
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
    routes: getWorkerRoutes(),
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

const AUTH_SCHEME = "Bearer";
const LOCAL_IPS = new Set(["127.0.0.1", "::1", "localhost"]);

type DailyReportResult = {
  metrics: DailyMetrics;
  message: string;
  telegram: TelegramHelperResult;
};

async function sendSharedTelegram(message: string, env: Env): Promise<TelegramHelperResult> {
  const sendTelegram = await getSendTelegram();
  return sendTelegram(message, { env });
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers ?? {});
  headers.set('content-type', 'application/json; charset=utf-8');
  for (const [key, value] of Object.entries(CORS_BASE)) {
    if (!headers.has(key)) headers.set(key, value);
  }

  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers,
  });
}

function firstNonEmptyString(
  ...candidates: (string | undefined | null)[]
): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function getCodexSyncUrl(env: Env): string | null {
  return (
    firstNonEmptyString(
      env.CODEX_SYNC_URL,
      env.CODEX_LEARN_URL,
      env.LEARN_URL,
      env.CODEX_ENDPOINT,
      ((env as Record<string, unknown>).CODEX_BASE_URL as string | undefined | null)
    ) ?? null
  );
}

function getCodexAuthToken(env: Env): string | null {
  return (
    firstNonEmptyString(
      env.CODEX_AUTH_TOKEN,
      env.CODEX_TOKEN,
      env.CODEX_API_KEY,
      env.CODEX_SYNC_KEY,
      env.CODEX_SYNC_TOKEN,
      env.CODEX_LEARN_KEY,
      env.SYNC_KEY
    ) ?? null
  );
}

const SENSITIVE_KEY_PATTERN = /token|secret|password|key|credential|cookie|bearer|session|auth/i;

function shouldRedactValue(key: string, value: unknown): boolean {
  const loweredKey = key.toLowerCase();
  if (SENSITIVE_KEY_PATTERN.test(loweredKey)) {
    return true;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (SENSITIVE_KEY_PATTERN.test(trimmed)) return true;
    if (/^sk[_-]/i.test(trimmed)) return true;
    if (trimmed.startsWith('-----BEGIN') || trimmed.length > 120) return true;
  }

  return false;
}

function summarizeDebugValue(key: string, value: unknown): unknown {
  if (shouldRedactValue(key, value)) {
    return '[redacted]';
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }

  if (Array.isArray(value)) {
    return { type: 'array', length: value.length };
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return { type: 'object', keys: keys.slice(0, 10) };
  }

  return String(value);
}

function coerceTagList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : typeof item === 'number' ? String(item) : null))
      .filter((item): item is string => !!item)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function buildUnauthorizedResponse(status: number, error: string): Response {
  const response = jsonResponse({ ok: false, error }, { status });
  response.headers.set('WWW-Authenticate', AUTH_SCHEME);
  return response;
}

type SecretCheckResult =
  | { authorized: true; clientIp: string | null }
  | { authorized: false; reason: string; clientIp: string | null };

function getClientIp(req: Request): string | null {
  const cf = (req as any).cf;
  if (cf && typeof cf === 'object' && typeof cf.connecting_ip === 'string' && cf.connecting_ip) {
    return cf.connecting_ip;
  }

  const connecting =
    req.headers.get('CF-Connecting-IP') ??
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for') ??
    req.headers.get('X-Forwarded-For');

  if (!connecting) return null;

  const ip = connecting.split(',')[0]?.trim();
  return ip || null;
}

function isLocalIp(ip: string | null): boolean {
  if (!ip) return false;
  if (LOCAL_IPS.has(ip)) return true;

  // Handle IPv6 localhost variations (e.g., ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice('::ffff:'.length);
    if (LOCAL_IPS.has(mapped)) {
      return true;
    }
  }

  return false;
}

function extractSecretToken(req: Request): string | null {
  const headerSecret = req.headers.get('x-admin-secret')?.trim();
  if (headerSecret) return headerSecret;

  const authHeader = req.headers.get('authorization') || '';
  const [scheme, token] = authHeader.split(/\s+/);
  if (scheme && scheme.toLowerCase() === AUTH_SCHEME.toLowerCase() && token) {
    return token;
  }

  return null;
}

const publicDebugRoutes = ['/health'];

function checkSecret(req: Request, env: Env): SecretCheckResult {
  const method = req.method.toUpperCase();
  const clientIp = getClientIp(req);
  const nodeEnv = (env as Record<string, unknown>).NODE_ENV;
  const pathname = new URL(req.url).pathname;

  if (
    publicDebugRoutes.includes(pathname) &&
    (method === 'GET' || method === 'HEAD')
  ) {
    return { authorized: true, clientIp };
  }

  if (typeof nodeEnv === 'string' && nodeEnv.toLowerCase() === 'development') {
    return { authorized: true, clientIp };
  }

  if (isLocalIp(clientIp)) {
    return { authorized: true, clientIp };
  }

  const expected = getAdminSecret(env);
  if (!expected) {
    return { authorized: false, reason: 'missing-secret', clientIp };
  }

  const token = extractSecretToken(req);
  if (!token) {
    return { authorized: false, reason: 'secret-not-provided', clientIp };
  }

  if (token !== expected) {
    return { authorized: false, reason: 'secret-mismatch', clientIp };
  }

  return { authorized: true, clientIp };
}

function requireAdminAuthorization(req: Request, env: Env): Response | null {
  const result = checkSecret(req, env);
  if (result.authorized) {
    return null;
  }

  const { reason, clientIp } = result;

  const url = new URL(req.url);
  const nodeEnv = (env as Record<string, unknown>).NODE_ENV ?? 'unknown';
  const logPayload = {
    method: req.method,
    path: url.pathname,
    ip: clientIp ?? 'unknown',
    nodeEnv,
    reason,
  };

  if (reason === 'missing-secret') {
    console.warn('[worker:auth] ADMIN_SECRET not configured', logPayload);
  } else {
    console.warn('[worker:auth] Unauthorized request blocked', logPayload);
  }

  return buildUnauthorizedResponse(401, 'admin-secret-invalid');
}

async function runDailyReport(env: Env, host: string | null): Promise<DailyReportResult> {
  const metrics = await gatherDailyMetrics(env, { host: host ?? undefined });
  const message = buildDailyMessage(metrics);
  const telegram = await sendSharedTelegram(message, env);
  return { metrics, message, telegram };
}

type TelegramCredentials = {
  token: string;
  chatId: string;
};

type PingTelegramSendResult = {
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
): Promise<PingTelegramSendResult> {
  const response = await fetch(`https://api.telegram.org/bot${credentials.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: credentials.chatId,
      text,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, any>;

  return {
    ok: response.ok && !!body?.ok,
    status: response.status,
    body,
  };
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

async function performPing(
  env: Env,
  source: string,
  options?: { path?: string; message?: string }
): Promise<{ status: number; payload: PingResponse }> {
  try {
    const credentials = getTelegramCredentials(env);
    const result = await sendTelegramMessage(
      credentials,
      options?.message ?? "Maggie ping test"
    );

    const payload: PingResponse = {
      ok: result.ok,
      sent: result.ok,
      path: options?.path ?? "/ping",
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

router.get(
  '/',
  async () =>
    new Response('Maggie is online! 🌸 Welcome to Messy & Magnetic.', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }),
  { stage: 'pre' }
);

router.get('/test-telegram', async (req, env) => {
  const unauthorized = requireAdminAuthorization(req, env);
  if (unauthorized) {
    console.error('[worker:/test-telegram] unauthorized access attempt');
    return unauthorized;
  }

  const { status, payload } = await performPing(env, 'route:/test-telegram', {
    path: '/test-telegram',
    message: 'Manual Telegram test triggered via /test-telegram',
  });

  return jsonResponse(payload, { status });
});

const POST_TIKTOK_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

router.post('/post-tiktok', async (req, env, ctx) => {
  try {
    const mod: any = await import('./routes/post-tiktok');

    if (typeof mod.handle === 'function') {
      return await mod.handle(req, env, ctx);
    }

    if (typeof mod.onRequestPost === 'function') {
      return await mod.onRequestPost({ request: req, env, ctx });
    }

    if (mod?.default && typeof mod.default.handler === 'function') {
      return await mod.default.handler(req, env, ctx);
    }

    console.error('[worker:/post-tiktok] module loaded without handler');
    return jsonResponse({ ok: false, error: 'post-tiktok-handler-missing' }, { status: 500 });
  } catch (err) {
    console.error('[worker:/post-tiktok] failed to load handler', err);
    return jsonResponse({ ok: false, error: 'post-tiktok-load-failed' }, { status: 500 });
  }
});

router.all('/post-tiktok', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: POST_TIKTOK_CORS_HEADERS });
  }

  const body = { ok: false, error: 'method-not-allowed', method: req.method };
  return new Response(JSON.stringify(body, null, 2), {
    status: 405,
    headers: { ...POST_TIKTOK_CORS_HEADERS, Allow: 'POST,OPTIONS', 'content-type': 'application/json; charset=utf-8' },
  });
});

router.post('/stripe/webhook', async (req, env, ctx) => {
  const configuredSecret = (env as Record<string, unknown>).STRIPE_WEBHOOK_SECRET;
  const secret =
    (typeof configuredSecret === 'string' && configuredSecret) ||
    (typeof process !== 'undefined' ? process.env?.STRIPE_WEBHOOK_SECRET : undefined);

  if (!secret) {
    console.error('[stripe-webhook] missing STRIPE_WEBHOOK_SECRET');
    return jsonResponse({ ok: false, error: 'missing-webhook-secret' }, { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    console.warn('[stripe-webhook] missing stripe-signature header');
    return jsonResponse({ ok: false, error: 'missing-signature' }, { status: 400 });
  }

  let payload: string;
  try {
    payload = await req.text();
  } catch (err) {
    console.error('[stripe-webhook] failed to read request body', err);
    return jsonResponse({ ok: false, error: 'invalid-payload' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    console.warn('[stripe-webhook] invalid signature', err);
    return jsonResponse({ ok: false, error: 'invalid-signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const sessionId = session.id;
    const metadata = (session.metadata ?? {}) as Record<string, string | undefined>;
    const email =
      firstNonEmptyString(
        session.customer_details?.email ?? undefined,
        typeof session.customer_email === 'string' ? session.customer_email : undefined,
        metadata['email']
      ) ?? null;
    const name =
      firstNonEmptyString(
        session.customer_details?.name ?? undefined,
        metadata['name'],
        metadata['customer_name']
      ) ?? null;
    const productName =
      firstNonEmptyString(
        metadata['product_name'],
        metadata['product'],
        metadata['blueprint'],
        metadata['productName']
      ) ?? null;

    const tasks: Promise<unknown>[] = [];

    if (sessionId && env.BRAIN && typeof env.BRAIN.put === 'function') {
      const record = {
        email,
        name,
        product: productName,
        sessionId,
        eventId: event.id,
        receivedAt: new Date().toISOString(),
      };
      tasks.push(
        env.BRAIN.put(`orders:${sessionId}`, JSON.stringify(record)).catch((err) => {
          console.error('[stripe-webhook] failed to persist order data', err);
        })
      );
    }

    const taskUrl = new URL('/tasks/run', req.url);
    const taskPayload = {
      type: 'generateReading',
      email,
      product: productName,
    };
    tasks.push(
      fetch(taskUrl.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(taskPayload),
      }).catch((err) => {
        console.error('[stripe-webhook] failed to trigger background task', err);
      })
    );

    if (tasks.length) {
      ctx.waitUntil(Promise.all(tasks));
    }

    const emailLabel = email ?? 'unknown-email';
    console.log(`[stripe-webhook] ✅ Processed ${event.type} for ${emailLabel}`);
  }

  return jsonResponse({ ok: true });
});

router.post('/brain/learn', async (req, env) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    console.warn('[worker:/brain/learn] invalid JSON body', err);
    return jsonResponse({ ok: false, error: 'invalid-json' }, { status: 400 });
  }

  const summary = typeof (body as any)?.summary === 'string' ? (body as any).summary.trim() : '';
  if (!summary) {
    return jsonResponse({ ok: false, error: 'missing-summary' }, { status: 400 });
  }

  const entry = await recordBrainUpdate(env, {
    summary,
    type: 'learning-sync',
    severity: 'info',
    metadata: { source: 'worker:/brain/learn' },
  });

  const codexUrl = getCodexSyncUrl(env);
  const codexToken = getCodexAuthToken(env);
  const codexDetails: { attempted: boolean; ok: boolean; tags: string[] } = {
    attempted: false,
    ok: false,
    tags: [],
  };

  if (codexUrl) {
    codexDetails.attempted = true;
    try {
      const headers = new Headers({ 'content-type': 'application/json' });
      if (codexToken) headers.set('authorization', `Bearer ${codexToken}`);

      const response = await fetch(codexUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ summary, event: entry }),
      });

      codexDetails.ok = response.ok;
      const data = await response.json().catch(() => null);
      if (data && typeof data === 'object') {
        const tags = coerceTagList((data as Record<string, unknown>).tags ?? (data as Record<string, unknown>).tagList);
        if (tags.length) {
          await storeCodexTags(env, tags);
          codexDetails.tags = tags;
        }
      }
    } catch (err) {
      codexDetails.ok = false;
      console.warn('[worker:/brain/learn] Codex sync failed', err);
    }
  }

  const geminiKey = typeof env.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  const geminiDetails: { attempted: boolean; ok: boolean } = {
    attempted: false,
    ok: false,
  };
  let geminiState: GeminiSyncState | null = null;

  if (geminiKey) {
    geminiDetails.attempted = true;
    const model = firstNonEmptyString(env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL) ?? DEFAULT_GEMINI_MODEL;
    const base =
      firstNonEmptyString(env.GEMINI_API_BASE, DEFAULT_GEMINI_API_BASE) ??
      DEFAULT_GEMINI_API_BASE;
    const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
    const url = `${trimmedBase}/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const payload = {
      contents: [
        {
          parts: [
            {
              text: `Store this Maggie learning summary and keep Codex + Gemini aligned. Summary:\n${summary}`,
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      geminiDetails.ok = response.ok;
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        geminiState = {
          ok: false,
          timestamp: entry.timestamp,
          summary,
          error: errorText.slice(0, 512),
        };
      } else {
        geminiState = { ok: true, timestamp: entry.timestamp, summary };
      }
    } catch (err) {
      geminiDetails.ok = false;
      const message = err instanceof Error ? err.message : String(err);
      geminiState = { ok: false, timestamp: entry.timestamp, summary, error: message };
      console.warn('[worker:/brain/learn] Gemini sync failed', err);
    }
  } else {
    geminiState = { ok: false, timestamp: entry.timestamp, summary, error: 'GEMINI_API_KEY not configured' };
  }

  if (geminiState) {
    await setGeminiSyncState(env, geminiState);
  }

  return jsonResponse({
    ok: true,
    update: entry,
    codex: codexDetails,
    gemini: geminiDetails,
  });
});

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

    const preBootstrapResponse = await router.handlePreBootstrap(req, env, ctx);
    if (preBootstrapResponse) {
      return preBootstrapResponse;
    }

    try {
      await bootstrapWorker(env, req, ctx);
      const siteResponse = await serveStaticSite(req, env);
      if (siteResponse) {
        return siteResponse;
      }

      const routedResponse = await router.handlePostBootstrap(req, env, ctx);
      if (routedResponse) {
        return routedResponse;
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

      if (url.pathname === '/debug/brain') {
        if (req.method !== 'GET') {
          const res = jsonResponse({ ok: false, error: 'method-not-allowed' }, { status: 405 });
          res.headers.set('Allow', 'GET');
          return res;
        }

        const kv = (env as any).PostQ ?? (env as any).POSTQ ?? env.BRAIN;
        if (!kv || typeof kv.get !== 'function') {
          return jsonResponse({ ok: false, error: 'kv-binding-missing' }, { status: 500 });
        }

        const raw = await kv.get('PostQ:brain', 'text');
        console.log('[worker:/debug/brain] fetched blob:', raw);

        if (!raw) {
          return jsonResponse({ ok: false, error: 'brain-blob-missing' }, { status: 404 });
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResponse({ ok: false, error: 'brain-blob-invalid-json', message }, { status: 500 });
        }

        let keysSummary: Array<{ key: string; value: unknown }> = [];
        if (Array.isArray(parsed)) {
          keysSummary = [{ key: 'root', value: { type: 'array', length: parsed.length } }];
        } else if (parsed && typeof parsed === 'object') {
          keysSummary = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
            key,
            value: summarizeDebugValue(key, value),
          }));
        } else {
          keysSummary = [{ key: 'root', value: summarizeDebugValue('root', parsed) }];
        }

        return jsonResponse({ keys: keysSummary, total_keys: keysSummary.length });
      }

      if (url.pathname === '/' || url.pathname === '/health') {
        return await handleHealth(env);
      }
      if (['/diag/config', '/status', '/summary', '/diag/brain-state'].includes(url.pathname)) {
        const unauthorized = requireAdminAuthorization(req, env);
        if (unauthorized) return unauthorized;
      }

      if (url.pathname === '/diag/config') {
        return await handleDiagConfig(env);
      }

      if (url.pathname === '/diag/brain-state') {
        const snapshot = await getBrainStateSnapshot(env, { recentLimit: 5 });
        return jsonResponse(snapshot);
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
        return jsonResponse({
          ok: true,
          summary,
        });
      }

      if (url.pathname === '/daily' || url.pathname === '/cron-report') {
        if (req.method !== 'GET') {
          const res = jsonResponse({ ok: false, error: 'method-not-allowed' }, { status: 405 });
          res.headers.set('Allow', 'GET');
          return res;
        }

        const unauthorized = requireAdminAuthorization(req, env);
        if (unauthorized) return unauthorized;

        const host = url.hostname || null;
        try {
          const report = await runDailyReport(env, host);
          return jsonResponse({
            ok: true,
            source: url.pathname === '/cron-report' ? 'cron-report' : 'daily',
            metrics: report.metrics,
            message: report.message,
            telegram: report.telegram,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'daily-report-failed';
          console.error('[worker:/daily] failed to generate report', err);
          return jsonResponse({ ok: false, error: message }, { status: 500 });
        }
      }

      if (url.pathname === '/kv/keys') {
        if (req.method !== 'GET') {
          const res = jsonResponse({ ok: false, error: 'method-not-allowed' }, { status: 405 });
          res.headers.set('Allow', 'GET');
          return res;
        }

        const unauthorized = requireAdminAuthorization(req, env);
        if (unauthorized) return unauthorized;

        try {
          const keys = await listAllKvKeys(env);
          return jsonResponse({ ok: true, count: keys.length, keys });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'kv-list-failed';
          console.error('[worker:/kv/keys] failed to list keys', err);
          return jsonResponse({ ok: false, error: message }, { status: 500 });
        }
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
        const unauthorized = requireAdminAuthorization(req, env);
        if (unauthorized) return unauthorized;

        // @ts-ignore - email config helper ships from shared runtime
        const { getEmailConfig } = await import("../" + 'utils/email');
        const { fromEmail, fromName, apiKey } = getEmailConfig(env);
        const domain = fromEmail.split("@")[1] || "";
        let domainVerified: boolean | undefined;
        if (apiKey) {
          try {
            const resp = await fetch("https://api.resend.com/domains", {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            const data = (await resp.json().catch(() => ({}))) as { data?: Array<{ name?: string; status?: string }> };
            const match = data.data?.find((d) => d?.name === domain);
            domainVerified = match?.status === "verified";
          } catch {}
        }
        return new Response(
          JSON.stringify({ ok: true, from: `${fromName} <${fromEmail}>`, domain, domainVerified }),
          { status: 200, headers: cors({ "content-type": "application/json" }) }
        );
      }

      if (url.pathname === "/diag/email/test" && req.method === "POST") {
        const unauthorized = requireAdminAuthorization(req, env);
        if (unauthorized) return unauthorized;

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
          // @ts-ignore - ready route is generated during build
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
        const unauthorized = requireAdminAuthorization(req, env);
        if (unauthorized) return unauthorized;

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
      if (warmUrl) ctx.waitUntil(fetch(String(warmUrl)).then(() => {}));
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

    if (event.cron === '30 3 * * *') {
      ctx.waitUntil(
        (async () => {
          try {
            const report = await runDailyReport(env, 'cron-event');
            if (!report.telegram.ok) {
              console.warn('[worker.cron] daily telegram delivery failed', report.telegram);
            }
          } catch (err) {
            console.error('[worker.cron] daily report failed', err);
          }
        })().catch((err) => console.error('[worker.cron] daily report crashed', err))
      );
    }

    try {
      ctx.waitUntil(
        (async () => {
          try {
            await syncThreadStateFromGitHub(env);
          } catch (err) {
            console.error('[worker.cron] thread-state sync failed:', err);
          }
          try {
            await syncBrainDocFromGitHub(env);
          } catch (err) {
            console.error('[worker.cron] brain-doc sync failed:', err);
          }
        })()
      );
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
      // @ts-ignore - optional tasks route is generated during build
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