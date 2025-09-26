import type { Env } from '../lib/env';
import { loadState, saveState } from '../lib/state';

interface HealthEntry {
  ok?: boolean;
  checkedAt?: string;
  detail?: string;
  issues?: string[];
  warnings?: string[];
}

interface HealthUpdateBody {
  website?: HealthEntry;
  stripe?: HealthEntry;
  tally?: HealthEntry;
  metrics?: {
    flopsRecovered?: number;
  };
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function normalizeEntry(entry: HealthEntry | undefined): HealthEntry | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const normalized: HealthEntry = {
    ok: entry.ok ?? undefined,
    checkedAt: typeof entry.checkedAt === 'string' ? entry.checkedAt : undefined,
    detail: typeof entry.detail === 'string' ? entry.detail : undefined,
    issues: Array.isArray(entry.issues) ? entry.issues.map(String) : undefined,
    warnings: Array.isArray(entry.warnings) ? entry.warnings.map(String) : undefined,
  };
  return normalized;
}

function mergeEntry(target: any, key: string, entry: HealthEntry | undefined) {
  if (!entry) return;
  if (!target[key] || typeof target[key] !== 'object') {
    target[key] = {};
  }
  const bucket = target[key] as Record<string, unknown>;
  if (entry.ok !== undefined) bucket.ok = entry.ok;
  if (entry.checkedAt) bucket.checkedAt = entry.checkedAt;
  if (entry.detail) bucket.detail = entry.detail;
  if (entry.issues) bucket.issues = entry.issues;
  if (entry.warnings) bucket.warnings = entry.warnings;
}

function authorize(request: Request, env: Env): boolean {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const expected =
    (env as any).WORKER_KEY ||
    (env as any).POST_THREAD_SECRET ||
    (env as any).MAGGIE_WORKER_KEY ||
    (env as any).CF_WORKER_KEY;
  if (!expected) return false;
  return token && token === expected;
}

export async function onRequestGet({ env }: { env: Env }) {
  const state = await loadState(env);
  const health = (state as any)?.health ?? {};
  const metrics = (state as any)?.metrics ?? {};
  return json({ ok: true, health, metrics });
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  if (!authorize(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = (await request.json().catch(() => null)) as HealthUpdateBody | null;
  if (!body || typeof body !== 'object') {
    return json({ ok: false, error: 'invalid-body' }, 400);
  }

  const state = await loadState(env);
  if (!state || typeof state !== 'object') {
    return json({ ok: false, error: 'state-unavailable' }, 500);
  }

  const health = (state as any).health || {};
  mergeEntry(health, 'website', normalizeEntry(body.website));
  mergeEntry(health, 'stripe', normalizeEntry(body.stripe));
  mergeEntry(health, 'tally', normalizeEntry(body.tally));
  (state as any).health = health;

  if (body.metrics && typeof body.metrics === 'object') {
    const metrics = (state as any).metrics || {};
    if (typeof body.metrics.flopsRecovered === 'number' && Number.isFinite(body.metrics.flopsRecovered)) {
      metrics.flopsRecovered = body.metrics.flopsRecovered;
    }
    (state as any).metrics = metrics;
  }

  await saveState(env, state);
  return json({ ok: true });
}
