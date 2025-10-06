import type { Env } from './lib/env';

const RECENT_UPDATES_KEY = 'brain:recent';
const CODEX_TAGS_KEY = 'brain:codex-tags';
const GEMINI_SYNC_KEY = 'brain:gemini-synced';
const MAX_RECENT_ENTRIES = 25;

function toStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item == null) return null;
        return String(item);
      })
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }

  try {
    const parsed = JSON.parse(String(value));
    return toStringArray(parsed);
  } catch {
    return [];
  }
}

async function readRecentUpdates(env: Env): Promise<string[]> {
  try {
    const raw = await env.BRAIN.get(RECENT_UPDATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const updates = toStringArray(parsed);
    return updates.slice(0, MAX_RECENT_ENTRIES);
  } catch (err) {
    console.warn('[brain] failed to read recent updates', err);
    return [];
  }
}

function formatUpdate(summary: string): string {
  const timestamp = new Date().toISOString();
  const trimmed = summary.trim();
  return `[${timestamp}] ${trimmed}`;
}

export async function recordBrainUpdate(summary: string, env: Env): Promise<string[]> {
  const update = formatUpdate(summary);
  const existing = await readRecentUpdates(env);
  const next = [update, ...existing].slice(0, MAX_RECENT_ENTRIES);
  await env.BRAIN.put(RECENT_UPDATES_KEY, JSON.stringify(next));
  return next;
}

export async function getRecentBrainUpdates(env: Env, limit = 5): Promise<string[]> {
  const updates = await readRecentUpdates(env);
  if (limit >= updates.length) {
    return updates;
  }
  return updates.slice(0, limit);
}

export async function storeCodexTags(env: Env, tags: unknown): Promise<string[]> {
  const values = toStringArray(tags);
  await env.BRAIN.put(CODEX_TAGS_KEY, JSON.stringify(values));
  return values;
}

export async function getCodexTags(env: Env): Promise<string[]> {
  try {
    const raw = await env.BRAIN.get(CODEX_TAGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return toStringArray(parsed);
  } catch (err) {
    console.warn('[brain] failed to load codex tags', err);
    return [];
  }
}

type GeminiSyncState = { synced: boolean; timestamp: string };

export async function setGeminiSynced(env: Env, synced: boolean): Promise<void> {
  const payload: GeminiSyncState = { synced, timestamp: new Date().toISOString() };
  await env.BRAIN.put(GEMINI_SYNC_KEY, JSON.stringify(payload));
}

export async function getGeminiSynced(env: Env): Promise<boolean> {
  try {
    const raw = await env.BRAIN.get(GEMINI_SYNC_KEY);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as GeminiSyncState | boolean;
      if (typeof parsed === 'boolean') return parsed;
      if (parsed && typeof parsed === 'object' && typeof parsed.synced === 'boolean') {
        return parsed.synced;
      }
    } catch {
      if (raw === 'true') return true;
      if (raw === 'false') return false;
    }
  } catch (err) {
    console.warn('[brain] failed to read gemini sync flag', err);
  }
  return false;
}

function pickFirstUrl(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed.replace(/\/$/, '');
    }
  }
  return null;
}

function appendPath(base: string, path: string): string {
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function getCodexLearnUrl(env: Env): string | null {
  const explicit = pickFirstUrl(
    (env as any).CODEX_LEARN_URL,
    (env as any).CODEX_API_URL
  );
  if (explicit) {
    return explicit.endsWith('/codex/learn') ? explicit : appendPath(explicit, '/codex/learn');
  }

  const base = pickFirstUrl(
    (env as any).CODEX_API_BASE,
    (env as any).CODEX_BASE_URL,
    (env as any).CODEX_URL,
    (env as any).CODEX_ORIGIN
  );
  if (!base) return null;
  return appendPath(base, '/codex/learn');
}

export function getGeminiLearnUrl(env: Env): string | null {
  const explicit = pickFirstUrl(
    (env as any).GEMINI_LEARN_URL,
    (env as any).GEMINI_AGENT_URL,
    (env as any).GEMINI_API_URL
  );
  if (explicit) {
    if (explicit.endsWith('/brain/learn') || explicit.endsWith('/gemini/learn')) {
      return explicit;
    }
    return appendPath(explicit, '/brain/learn');
  }

  const base = pickFirstUrl(
    (env as any).GEMINI_API_BASE,
    (env as any).GEMINI_SYNC_URL
  );
  if (!base) return null;
  return appendPath(base, '/brain/learn');
}
