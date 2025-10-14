import { readFile } from 'fs/promises';
import path from 'path';

const FALLBACK_PATH = path.resolve(process.cwd(), 'config/kv-state.json');

let fallbackCache: any | null | undefined;

async function loadFallback(): Promise<any | null> {
  if (fallbackCache !== undefined) return fallbackCache;

  try {
    const raw = await readFile(FALLBACK_PATH, 'utf8');
    fallbackCache = JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[config] Failed to load fallback KV state from ${FALLBACK_PATH}:`,
      err
    );
    fallbackCache = null;
  }

  return fallbackCache;
}

async function readFromKV(env: any, key: string): Promise<string | null> {
  try {
    if (env?.BRAIN && typeof env.BRAIN.get === 'function') {
      return await env.BRAIN.get(key);
    }
  } catch (err) {
    console.warn(`[config] KV fetch failed for key "${key}":`, err);
  }
  return null;
}

export async function getSecrets(env: any) {
  const k = env.SECRET_BLOB || 'thread-state';
  const v = await readFromKV(env, k);
  if (v) {
    try {
      return JSON.parse(v);
    } catch (err) {
      console.warn(`[config] Unable to parse KV payload for key "${k}":`, err);
    }
  }

  const fallback = await loadFallback();
  return fallback ?? {};
}

function collectBrainKeys(env: any): string[] {
  const keys = new Set<string>();
  keys.add('brain/latest');

  const configured = typeof env.BRAIN_DOC_KEY === 'string' ? env.BRAIN_DOC_KEY.trim() : '';
  if (configured) keys.add(configured);

  keys.add('PostQ:thread-state');

  const legacy = typeof env.SECRET_BLOB === 'string' ? env.SECRET_BLOB.trim() : '';
  if (legacy) keys.add(legacy);
  keys.add('thread-state');

  return Array.from(keys);
}

export async function getBrainDoc(env: any) {
  for (const key of collectBrainKeys(env)) {
    const v = await readFromKV(env, key);
    if (typeof v === 'string' && v.length) {
      if (key !== 'brain/latest') {
        console.warn(`[config] brain/latest missing; using fallback key "${key}".`);
      }
      return v;
    }
  }

  const fallback = await loadFallback();
  if (fallback) {
    console.warn('[config] brain KV keys missing; falling back to bundled snapshot.');
    return JSON.stringify(fallback);
  }

  console.warn('[config] brain KV keys missing and fallback unavailable; returning empty brain blob.');
  return '{}';
}
