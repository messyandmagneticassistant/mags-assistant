import type { Env } from './lib/env';

const THREAD_STATE_KEY = 'thread-state';
const MAX_RECENT_EVENTS = 25;

type PlainObject = Record<string, unknown>;

type ThreadStateBrainSection = {
  recentUpdates: BrainUpdateEntry[];
  codexTags: string[];
  geminiSync: GeminiSyncState | null;
};

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

function isPlainObject(value: unknown): value is PlainObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

function coerceGeminiSyncState(value: unknown): GeminiSyncState | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.ok !== 'boolean' || typeof value.timestamp !== 'string') {
    return null;
  }
  const state: GeminiSyncState = {
    ok: value.ok,
    timestamp: value.timestamp,
  };
  if (typeof value.summary === 'string') state.summary = value.summary;
  if (typeof value.error === 'string') state.error = value.error;
  return state;
}

function coerceBrainSection(value: unknown): ThreadStateBrainSection {
  const base: ThreadStateBrainSection = {
    recentUpdates: [],
    codexTags: [],
    geminiSync: null,
  };

  if (!isPlainObject(value)) {
    return base;
  }

  const updatesSource = (value.recentUpdates ?? value.recentEvents ?? value.events) as unknown;
  const updates = coerceBrainUpdates(updatesSource);
  if (updates.length) {
    base.recentUpdates = updates;
  }

  const tagsSource = (value.codexTags ?? value.tags ?? value.tagList) as unknown;
  if (Array.isArray(tagsSource)) {
    base.codexTags = tagsSource
      .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
      .filter((tag) => !!tag);
  }

  const gemini = coerceGeminiSyncState(value.geminiSync ?? value.gemini ?? value.lastGeminiSync);
  if (gemini) {
    base.geminiSync = gemini;
  }

  return base;
}

function clonePlainObject<T extends PlainObject>(value: T | undefined): PlainObject {
  return value ? { ...value } : {};
}

async function readThreadStateDocument(env: Env): Promise<PlainObject> {
  const stored = await readJsonFromKv<PlainObject>(env, THREAD_STATE_KEY);
  if (isPlainObject(stored)) {
    return { ...stored };
  }
  if (stored !== null) {
    console.warn('[brain] Thread-state payload was not a JSON object; resetting brain section.');
  }
  return {};
}

async function readBrainSection(env: Env): Promise<{
  document: PlainObject;
  section: ThreadStateBrainSection;
  container: PlainObject;
}> {
  const document = await readThreadStateDocument(env);
  const containerCandidate = document.brain;
  const container = isPlainObject(containerCandidate)
    ? { ...containerCandidate }
    : {};
  const source = Object.keys(container).length > 0 ? container : document;
  const section = coerceBrainSection(source);
  return { document, section, container };
}

function buildBrainContainer(
  base: PlainObject,
  section: ThreadStateBrainSection
): PlainObject {
  return {
    ...base,
    recentUpdates: section.recentUpdates,
    codexTags: section.codexTags,
    geminiSync: section.geminiSync,
  };
}

async function writeBrainSection(
  env: Env,
  current: { document: PlainObject; container: PlainObject },
  next: ThreadStateBrainSection
): Promise<void> {
  const { document, container } = current;
  const nextDocument: PlainObject = { ...document };
  const nextContainer = buildBrainContainer(clonePlainObject(container), next);
  nextDocument.brain = nextContainer;
  await writeJsonToKv(env, THREAD_STATE_KEY, nextDocument);
}

async function mutateBrainSection(
  env: Env,
  mutate: (section: ThreadStateBrainSection) => ThreadStateBrainSection
): Promise<ThreadStateBrainSection> {
  const snapshot = await readBrainSection(env);
  const next = mutate(snapshot.section);
  await writeBrainSection(env, snapshot, next);
  return next;
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
  if (!hasKv(env)) return [];
  const { section } = await readBrainSection(env);
  return section.recentUpdates;
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

  await mutateBrainSection(env, (section) => {
    const nextUpdates = [...section.recentUpdates, entry].slice(-MAX_RECENT_EVENTS);
    return {
      ...section,
      recentUpdates: nextUpdates,
    };
  });

  return entry;
}

export async function appendToBrainRecent(env: Env, event: BrainUpdateEntry): Promise<void> {
  if (!hasKv(env)) return;
  await mutateBrainSection(env, (section) => {
    const nextUpdates = [...section.recentUpdates, event].slice(-MAX_RECENT_EVENTS);
    return {
      ...section,
      recentUpdates: nextUpdates,
    };
  });
}

export async function storeCodexTags(env: Env, tags: string[]): Promise<void> {
  if (!hasKv(env)) return;
  const normalized = Array.from(new Set(tags.map((tag) => String(tag).trim()).filter(Boolean)));
  await mutateBrainSection(env, (section) => ({
    ...section,
    codexTags: normalized,
  }));
}

export async function getCodexTags(env: Env): Promise<string[]> {
  if (!hasKv(env)) return [];
  const { section } = await readBrainSection(env);
  return section.codexTags;
}

export async function setGeminiSyncState(env: Env, state: GeminiSyncState): Promise<void> {
  if (!hasKv(env)) return;
  await mutateBrainSection(env, (section) => ({
    ...section,
    geminiSync: state,
  }));
}

export async function getGeminiSyncState(env: Env): Promise<GeminiSyncState | null> {
  if (!hasKv(env)) return null;
  const { section } = await readBrainSection(env);
  return section.geminiSync ?? null;
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
