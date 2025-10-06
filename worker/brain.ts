import type { Env } from './lib/env';

const RECENT_EVENTS_KEY = 'brain:recent';
const CODEX_TAGS_KEY = 'brain:codex-tags';
const GEMINI_SYNC_KEY = 'brain:gemini-sync';
const MAX_RECENT_EVENTS = 25;

export type BrainUpdateInput = {
  summary: string;
  type?: string;
  severity?: 'info' | 'warn' | 'error';
  metadata?: Record<string, unknown>;
};

export type BrainUpdateEntry = BrainUpdateInput & {
  id: string;
  timestamp: string;
};

export type GeminiSyncState = {
  ok: boolean;
  timestamp: string;
  summary?: string;
  error?: string;
};

function hasKv(env: Env): env is Env & { BRAIN: KVNamespace } {
  return !!env?.BRAIN && typeof env.BRAIN.get === 'function' && typeof env.BRAIN.put === 'function';
}

function coerceBrainUpdates(value: unknown): BrainUpdateEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === 'object' ? (item as BrainUpdateEntry) : null))
    .filter((item): item is BrainUpdateEntry => {
      if (!item) return false;
      if (typeof item.timestamp !== 'string' || typeof item.summary !== 'string') return false;
      if (typeof item.id !== 'string') return false;
      return true;
    });
}

async function readJsonFromKv<T>(env: Env, key: string): Promise<T | null> {
  if (!hasKv(env)) return null;

  try {
    const raw = await env.BRAIN.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    return parsed;
  } catch (err) {
    console.warn(`[brain] Failed to read JSON from KV for key ${key}:`, err);
    return null;
  }
}

async function writeJsonToKv(env: Env, key: string, value: unknown): Promise<void> {
  if (!hasKv(env)) return;

  try {
    await env.BRAIN.put(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[brain] Failed to write JSON to KV for key ${key}:`, err);
  }
}

export async function getRecentBrainUpdates(env: Env): Promise<BrainUpdateEntry[]> {
  const stored = await readJsonFromKv<BrainUpdateEntry[]>(env, RECENT_EVENTS_KEY);
  if (!stored) return [];
  return coerceBrainUpdates(stored);
}

export async function recordBrainUpdate(env: Env, input: BrainUpdateInput): Promise<BrainUpdateEntry> {
  const timestamp = new Date().toISOString();
  const id = `${timestamp}:${Math.random().toString(36).slice(2, 10)}`;
  const entry: BrainUpdateEntry = {
    summary: input.summary,
    type: input.type ?? 'event',
    severity: input.severity ?? 'info',
    metadata: input.metadata,
    timestamp,
    id,
  };

  console.log(`[brain] update recorded`, { type: entry.type, summary: entry.summary, timestamp: entry.timestamp });

  if (!hasKv(env)) {
    console.warn('[brain] BRAIN KV namespace unavailable; update not persisted');
    return entry;
  }

  const existing = await getRecentBrainUpdates(env);
  const next = [...existing, entry];
  const trimmed = next.slice(-MAX_RECENT_EVENTS);
  await writeJsonToKv(env, RECENT_EVENTS_KEY, trimmed);

  return entry;
}

export async function appendToBrainRecent(env: Env, event: BrainUpdateEntry): Promise<void> {
  if (!hasKv(env)) return;
  const existing = await getRecentBrainUpdates(env);
  const next = [...existing, event].slice(-MAX_RECENT_EVENTS);
  await writeJsonToKv(env, RECENT_EVENTS_KEY, next);
}

export async function storeCodexTags(env: Env, tags: string[]): Promise<void> {
  const normalized = Array.from(new Set(tags.map((tag) => String(tag).trim()).filter(Boolean)));
  await writeJsonToKv(env, CODEX_TAGS_KEY, normalized);
}

export async function getCodexTags(env: Env): Promise<string[]> {
  const stored = await readJsonFromKv<string[]>(env, CODEX_TAGS_KEY);
  if (!stored) return [];
  return stored.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim());
}

export async function setGeminiSyncState(env: Env, state: GeminiSyncState): Promise<void> {
  await writeJsonToKv(env, GEMINI_SYNC_KEY, state);
}

export async function getGeminiSyncState(env: Env): Promise<GeminiSyncState | null> {
  return (await readJsonFromKv<GeminiSyncState>(env, GEMINI_SYNC_KEY)) ?? null;
}

export async function getBrainStateSnapshot(
  env: Env,
  options?: { recentLimit?: number }
): Promise<{ recentUpdates: BrainUpdateEntry[]; codexTags: string[]; syncedToGemini: boolean }> {
  const limit = options?.recentLimit ?? 5;
  const recent = await getRecentBrainUpdates(env);
  const codexTags = await getCodexTags(env);
  const gemini = await getGeminiSyncState(env);

  return {
    recentUpdates: recent.slice(-limit).reverse(),
    codexTags,
    syncedToGemini: !!gemini?.ok,
  };
}
