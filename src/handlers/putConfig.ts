import type { KVNamespace } from '@cloudflare/workers-types';
import type { Env } from '../../worker/lib/env';
import brainState from '../../brain/brain.json';

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
};

const KV_KEY = 'PostQ:thread-state';

type WorkerBindings = Env & {
  POSTQ?: KVNamespace;
  PostQ?: KVNamespace;
};

type Handler = (
  request: Request,
  env: WorkerBindings,
  ctx: ExecutionContext
) => Response | Promise<Response>;

function pickWritableNamespace(env: WorkerBindings): KVNamespace | null {
  const candidates: Array<KVNamespace | undefined> = [
    env.POSTQ,
    env.PostQ,
    env.MAGGIE,
    env.MAGGIE_KV,
    env.BRAIN,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate.put === 'function') return candidate;
  }
  return null;
}

function buildPayload(): { json: string; timestamp: string } {
  const now = new Date().toISOString();
  const clone = JSON.parse(JSON.stringify(brainState ?? {}));
  if (clone && typeof clone === 'object') {
    (clone as Record<string, unknown>).lastSynced = now;
    (clone as Record<string, unknown>).lastUpdated = now;
  }
  return { json: JSON.stringify(clone, null, 2), timestamp: now };
}

export const putConfig: Handler = async (_request, env) => {
  const namespace = pickWritableNamespace(env);
  if (!namespace) {
    return new Response(
      JSON.stringify({ ok: false, error: 'kv-binding-missing' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  try {
    const { json, timestamp } = buildPayload();
    await namespace.put(KV_KEY, json, {
      metadata: { updatedAt: timestamp, source: 'route:putConfig' },
    });

    return new Response(JSON.stringify({ ok: true, updated: true }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'kv-write-failed';
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
