import type { Env } from './lib/env';

export const RECENT_EVENTS_KEY = 'brain:recent';
export const CODEX_TAGS_KEY = 'brain:codex-tags';
export const GEMINI_SYNC_KEY = 'brain:gemini-sync';
export const MAX_RECENT_EVENTS = 25;

const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash';
const DEFAULT_GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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

function firstNonEmptyString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

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

export function getCodexAuthToken(env: Env): string | null {
  return firstNonEmptyString(env.CODEX_AUTH_TOKEN, env.CODEX_TOKEN, env.CODEX_API_KEY);
}

export function getCodexLearnUrl(env: Env): string | null {
  return (
    firstNonEmptyString(
      env.CODEX_SYNC_URL,
      env.CODEX_LEARN_URL,
      env.CODEX_ENDPOINT,
      (env as Record<string, unknown>).CODEX_API_URL,
    ) ?? null
  );
}

export type CodexLearnConfig = {
  url: string;
  authToken: string | null;
};

export function getCodexLearnConfig(env: Env): CodexLearnConfig | null {
  const url = getCodexLearnUrl(env);
  if (!url) return null;
  return { url, authToken: getCodexAuthToken(env) };
}

export function getGeminiApiKey(env: Env): string | null {
  const key = firstNonEmptyString(env.GEMINI_API_KEY);
  return key ?? null;
}

function formatGeminiUrl(base: string, model: string, key: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmedBase}/${model}:generateContent?key=${encodeURIComponent(key)}`;
}

export function getGeminiLearnUrl(env: Env): string | null {
  const direct = firstNonEmptyString((env as Record<string, unknown>).GEMINI_LEARN_URL, env.GEMINI_LEARN_URL);
  const key = getGeminiApiKey(env);

  if (direct) {
    if (!key) return direct;

    const replacements = ['{API_KEY}', '${API_KEY}', '{{API_KEY}}'];
    let final = direct;
    for (const token of replacements) {
      if (final.includes(token)) {
        final = final.replace(token, encodeURIComponent(key));
      }
    }
    return final;
  }

  if (!key) return null;

  const model = firstNonEmptyString(env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL) ?? DEFAULT_GEMINI_MODEL;
  const base = firstNonEmptyString(env.GEMINI_API_BASE, DEFAULT_GEMINI_API_BASE) ?? DEFAULT_GEMINI_API_BASE;

  return formatGeminiUrl(base, model, key);
}

export type GeminiLearnConfig = {
  url: string;
  key: string;
};

export function getGeminiLearnConfig(env: Env): GeminiLearnConfig | null {
  const key = getGeminiApiKey(env);
  const url = getGeminiLearnUrl(env);
  if (!key || !url) return null;
  return { key, url };
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
