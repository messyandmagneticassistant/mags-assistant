import { getRouterRegisteredPaths } from '../router/router';
import type { Env } from '../lib/env';

type CodexEnv = Env & {
  MAGGIE?: KVNamespace;
  MAGGIE_KV?: KVNamespace;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  CODEX_API_KEY?: string;
  CODEX_AUTH_TOKEN?: string;
  CODEX_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_API_BASE?: string;
};

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
};

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

interface ProviderAttempt {
  provider: string;
  ok: boolean;
  elapsedMs: number;
  status?: number;
  error?: string;
}

interface ProviderSuccess {
  provider: string;
  output: string;
  attempts: ProviderAttempt[];
}

interface ProviderFailure {
  provider: null;
  output: null;
  attempts: ProviderAttempt[];
  error: string;
}

type ProviderResult = ProviderSuccess | ProviderFailure;

interface KvBindingInfo {
  binding: string;
  namespace: KVNamespace;
}

interface AuditRecord {
  prompt: string;
  provider: string | null;
  ok: boolean;
  attempts: ProviderAttempt[];
  requestId: string;
  storedAt: string;
  outputPreview?: string;
  error?: string;
}

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  const status = init?.status ?? 200;
  const headers = new Headers({
    ...JSON_HEADERS,
    ...CORS_HEADERS,
    ...(init?.headers ?? {}),
  });
  return new Response(JSON.stringify(data, null, 2), { status, headers });
}

function toErrorMessage(error: unknown): string {
  if (!error) return 'unknown-error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function pickKvBinding(env: CodexEnv): KvBindingInfo | null {
  if (env.MAGGIE && typeof env.MAGGIE.put === 'function') {
    return { binding: 'MAGGIE', namespace: env.MAGGIE };
  }
  if (env.MAGGIE_KV && typeof env.MAGGIE_KV.put === 'function') {
    return { binding: 'MAGGIE_KV', namespace: env.MAGGIE_KV };
  }
  if (env.BRAIN && typeof env.BRAIN.put === 'function') {
    return { binding: 'BRAIN', namespace: env.BRAIN };
  }
  return null;
}

async function writeAudit(env: CodexEnv, record: AuditRecord) {
  const binding = pickKvBinding(env);
  if (!binding) {
    return { ok: false, error: 'kv-binding-missing', binding: null } as const;
  }

  const key = 'codex:last-run';
  const mirrorKey = 'maggie:status';
  try {
    const payload = JSON.stringify(record, null, 2);
    await binding.namespace.put(key, payload);
    await binding.namespace.put(mirrorKey, payload);
    const confirm = await binding.namespace.get(key, 'text');
    return {
      ok: true,
      binding: binding.binding,
      key,
      mirrorKey,
      bytes: confirm ? confirm.length : 0,
    } as const;
  } catch (err) {
    return {
      ok: false,
      binding: binding.binding,
      key,
      mirrorKey,
      error: toErrorMessage(err),
    } as const;
  }
}

async function readLastRun(env: CodexEnv) {
  const binding = pickKvBinding(env);
  if (!binding) return { binding: null, value: null } as const;
  try {
    const raw = await binding.namespace.get('codex:last-run', 'text');
    if (!raw) return { binding: binding.binding, value: null } as const;
    try {
      return { binding: binding.binding, value: JSON.parse(raw) } as const;
    } catch {
      return { binding: binding.binding, value: raw } as const;
    }
  } catch (err) {
    return { binding: binding.binding, value: { error: toErrorMessage(err) } } as const;
  }
}

async function callOpenAI(prompt: string, env: CodexEnv) {
  const key = env.OPENAI_API_KEY || env.CODEX_API_KEY || env.CODEX_AUTH_TOKEN || env.CODEX_TOKEN;
  if (!key) {
    throw Object.assign(new Error('Missing OpenAI-compatible API key'), {
      status: 401,
    });
  }

  const model = env.OPENAI_MODEL || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are Codex, a precise assistant that returns concise results.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    }),
  });

  const status = response.status;
  let json: any = null;
  try {
    json = await response.json();
  } catch (err) {
    if (!response.ok) {
      throw Object.assign(new Error(`OpenAI responded with status ${status}`), { status });
    }
    throw Object.assign(new Error('OpenAI returned non-JSON response'), { status });
  }

  if (!response.ok) {
    const message =
      json?.error?.message ||
      json?.error?.code ||
      `OpenAI responded with status ${status}`;
    throw Object.assign(new Error(message), { status, body: json });
  }

  const output: string | undefined = json?.choices?.[0]?.message?.content;
  if (!output || !output.trim()) {
    throw Object.assign(new Error('OpenAI returned empty content'), { status, body: json });
  }

  return { output: output.trim(), status } as const;
}

async function callGemini(prompt: string, env: CodexEnv) {
  const key = env.GEMINI_API_KEY;
  if (!key) {
    throw Object.assign(new Error('Missing GEMINI_API_KEY'), { status: 401 });
  }

  const base = env.GEMINI_API_BASE?.replace(/\/$/, '') || 'https://generativelanguage.googleapis.com';
  const model = env.GEMINI_MODEL || 'gemini-1.5-pro';
  const url = `${base}/v1beta/models/${model}:generateContent?key=${key}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: { temperature: 0.2 },
    }),
  });

  const status = response.status;
  let json: any = null;
  try {
    json = await response.json();
  } catch (err) {
    if (!response.ok) {
      throw Object.assign(new Error(`Gemini responded with status ${status}`), { status });
    }
    throw Object.assign(new Error('Gemini returned non-JSON response'), { status });
  }

  if (!response.ok) {
    const message =
      json?.error?.message ||
      json?.error?.status ||
      `Gemini responded with status ${status}`;
    throw Object.assign(new Error(message), { status, body: json });
  }

  const output: string =
    json?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('\n').trim() || '';
  if (!output) {
    throw Object.assign(new Error('Gemini returned empty content'), { status, body: json });
  }

  return { output, status } as const;
}

async function runPromptWithFallback(prompt: string, env: CodexEnv): Promise<ProviderResult> {
  const attempts: ProviderAttempt[] = [];

  const providers: Array<{
    label: string;
    available: boolean;
    run: () => Promise<{ output: string; status: number }>;
  }> = [
    {
      label: 'openai',
      available: Boolean(env.OPENAI_API_KEY || env.CODEX_API_KEY || env.CODEX_AUTH_TOKEN || env.CODEX_TOKEN),
      run: () => callOpenAI(prompt, env),
    },
    {
      label: 'gemini',
      available: Boolean(env.GEMINI_API_KEY),
      run: () => callGemini(prompt, env),
    },
  ];

  const activeProviders = providers.filter((provider) => provider.available);
  if (!activeProviders.length) {
    return {
      provider: null,
      output: null,
      attempts: [],
      error: 'no-provider-configured',
    };
  }

  for (const provider of activeProviders) {
    const started = Date.now();
    try {
      const { output, status } = await provider.run();
      const elapsedMs = Date.now() - started;
      attempts.push({ provider: provider.label, ok: true, status, elapsedMs });
      return { provider: provider.label, output, attempts };
    } catch (err) {
      const elapsedMs = Date.now() - started;
      const status = (err as any)?.status;
      const error = toErrorMessage(err);
      attempts.push({ provider: provider.label, ok: false, status, elapsedMs, error });
      console.warn(`[codex:fallback] ${provider.label} failed`, { error, status });
    }
  }

  const lastError = attempts.at(-1)?.error || 'all-providers-failed';
  return { provider: null, output: null, attempts, error: lastError };
}

function createRequestId(request: Request): string {
  const headerId = request.headers.get('cf-ray');
  if (headerId) return headerId;
  const cf: any = (request as any).cf;
  if (cf?.ray) return cf.ray;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function handleStatus(request: Request, env: CodexEnv) {
  const requestId = createRequestId(request);
  const now = new Date().toISOString();
  const kv = pickKvBinding(env);
  const lastRun = await readLastRun(env);
  const routerPaths = getRouterRegisteredPaths().filter((path) => path.startsWith('/codex'));

  const body = {
    ok: true,
    service: 'codex',
    requestId,
    time: now,
    routes: {
      registered: routerPaths,
      exposed: ['/codex', '/codex/run', '/codex/prompt'],
    },
    environment: {
      hasOpenAI: Boolean(env.OPENAI_API_KEY || env.CODEX_API_KEY || env.CODEX_AUTH_TOKEN || env.CODEX_TOKEN),
      hasGemini: Boolean(env.GEMINI_API_KEY),
      bindings: {
        codex: kv?.binding ?? null,
      },
    },
    lastRun,
  };

  console.log('[codex] status check', body.environment);
  return jsonResponse(body);
}

async function handleRun(request: Request, env: CodexEnv) {
  let payload: any;
  try {
    payload = await request.json();
  } catch (err) {
    return jsonResponse({ ok: false, error: 'invalid-json', detail: toErrorMessage(err) }, { status: 400 });
  }

  const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt) {
    return jsonResponse({ ok: false, error: 'missing-prompt' }, { status: 400 });
  }

  const requestId = createRequestId(request);
  console.log('[codex] run request', { requestId, promptPreview: prompt.slice(0, 120) });

  const result = await runPromptWithFallback(prompt, env);

  const record: AuditRecord = {
    prompt,
    provider: result.provider,
    ok: result.provider !== null,
    attempts: result.attempts,
    requestId,
    storedAt: new Date().toISOString(),
    outputPreview: result.output ? result.output.slice(0, 400) : undefined,
    error: 'error' in result ? result.error : undefined,
  };

  const kvResult = await writeAudit(env, record);

  return jsonResponse({
    ok: result.provider !== null,
    provider: result.provider,
    output: result.output,
    attempts: result.attempts,
    error: 'error' in result ? result.error : null,
    requestId,
    kv: kvResult,
  });
}

async function handlePrompt(request: Request, env: CodexEnv) {
  const kv = pickKvBinding(env);
  if (!kv) {
    return jsonResponse({ ok: false, error: 'kv-binding-missing' }, { status: 500 });
  }

  if (request.method === 'GET') {
    try {
      const list = await kv.namespace.list({ prefix: 'codex:prompt:' });
      const latestRaw = await kv.namespace.get('codex:prompt:latest', 'text');
      let latest: any = null;
      if (latestRaw) {
        try {
          latest = JSON.parse(latestRaw);
        } catch {
          latest = latestRaw;
        }
      }
      return jsonResponse({
        ok: true,
        binding: kv.binding,
        count: list.keys.length,
        keys: list.keys.map((entry) => entry.name),
        latest,
      });
    } catch (err) {
      return jsonResponse({ ok: false, error: toErrorMessage(err) }, { status: 500 });
    }
  }

  if (request.method === 'POST') {
    let payload: any;
    try {
      payload = await request.json();
    } catch (err) {
      return jsonResponse({ ok: false, error: 'invalid-json', detail: toErrorMessage(err) }, { status: 400 });
    }

    const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
    if (!prompt) {
      return jsonResponse({ ok: false, error: 'missing-prompt' }, { status: 400 });
    }

    const label = typeof payload?.label === 'string' && payload.label.trim() ? payload.label.trim() : 'latest';
    const record = {
      label,
      prompt,
      storedAt: new Date().toISOString(),
      metadata: payload?.metadata ?? null,
    };

    try {
      await kv.namespace.put(`codex:prompt:${label}`, JSON.stringify(record, null, 2));
      if (label !== 'latest') {
        await kv.namespace.put('codex:prompt:latest', JSON.stringify(record, null, 2));
      } else {
        await kv.namespace.put('codex:prompt:latest', JSON.stringify(record, null, 2));
      }
      return jsonResponse({ ok: true, binding: kv.binding, label });
    } catch (err) {
      return jsonResponse({ ok: false, error: toErrorMessage(err) }, { status: 500 });
    }
  }

  return jsonResponse({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { Allow: 'GET,POST,OPTIONS' } });
}

export async function codexRouter(request: Request, env: CodexEnv, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/codex')) {
    return new Response('Not Found', { status: 404 });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
  }

  if (url.pathname === '/codex' || url.pathname === '/codex/') {
    return handleStatus(request, env);
  }

  if (url.pathname === '/codex/run') {
    return handleRun(request, env);
  }

  if (url.pathname === '/codex/prompt') {
    return handlePrompt(request, env);
  }

  return jsonResponse({ ok: false, error: 'not-found', path: url.pathname }, { status: 404 });
}

export default codexRouter;
