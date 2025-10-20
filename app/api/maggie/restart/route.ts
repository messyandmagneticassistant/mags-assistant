import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const WORKER_URL_KEYS = ['WORKER_URL', 'WORKER_BASE_URL', 'MAGS_WORKER_URL', 'MAGGIE_WORKER_URL'];
const ADMIN_TOKEN_KEYS = [
  'INTERNAL_ADMIN_TOKEN',
  'MAGS_INTERNAL_ADMIN_TOKEN',
  'MAGGIE_INTERNAL_ADMIN_TOKEN',
  'WORKER_ADMIN_TOKEN',
  'ADMIN_SHARED_SECRET',
];

function pickEnv(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function buildRestartUrl(base: string): string {
  try {
    return new URL('/maggie/restart', base).toString();
  } catch {
    const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${normalized}/maggie/restart`;
  }
}

function collectWorkerHeaders(worker: Response): Headers {
  const headers = new Headers();
  headers.set('x-worker-status', String(worker.status));
  if (worker.statusText) {
    headers.set('x-worker-status-text', worker.statusText);
  }
  worker.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith('content-')) {
      return;
    }
    headers.set(`x-worker-${key}`, value);
  });
  return headers;
}

function parseWorkerPayload(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function POST() {
  const base = pickEnv(WORKER_URL_KEYS);
  if (!base) {
    return NextResponse.json({ ok: false, error: 'WORKER_URL not configured' }, { status: 500 });
  }

  const url = buildRestartUrl(base);
  const adminToken = pickEnv(ADMIN_TOKEN_KEYS);
  const headers = new Headers();
  if (adminToken) {
    headers.set('Authorization', `Bearer ${adminToken}`);
  }

  let worker: Response;
  try {
    worker = await fetch(url, { method: 'POST', headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: 'Failed to reach Maggie worker', detail: message },
      { status: 502 },
    );
  }

  const debugHeaders = collectWorkerHeaders(worker);
  const raw = await worker.text().catch(() => '');
  const parsed = parseWorkerPayload(raw);

  if (!worker.ok) {
    const errorMessage =
      typeof parsed === 'string'
        ? parsed || worker.statusText || 'Worker restart failed'
        : parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof (parsed as any).error === 'string'
          ? (parsed as { error: string }).error
          : worker.statusText || 'Worker restart failed';

    const body: Record<string, unknown> = {
      ok: false,
      error: errorMessage,
      status: worker.status,
    };

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body.details = parsed;
    } else if (typeof parsed === 'string' && parsed && parsed !== errorMessage) {
      body.details = parsed;
    }

    return NextResponse.json(body, {
      status: worker.status || 502,
      headers: debugHeaders,
    });
  }

  let responseBody: Record<string, unknown>;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    responseBody = { ...(parsed as Record<string, unknown>) };
  } else if (typeof parsed === 'string' && parsed) {
    responseBody = { message: parsed };
  } else {
    responseBody = {};
  }

  if (!('ok' in responseBody)) {
    responseBody.ok = true;
  }

  return NextResponse.json(responseBody, {
    status: worker.status || 200,
    headers: debugHeaders,
  });
}
