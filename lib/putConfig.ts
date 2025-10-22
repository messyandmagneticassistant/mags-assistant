import type { KVNamespace } from '@cloudflare/workers-types';
import { getConfigValue, putConfig as putConfigToCloudflare } from './kv';
import { getBrain } from './getBrain';

type AnyEnv = Record<string, unknown> & {
  BRAIN?: Pick<KVNamespace, 'get' | 'put'>;
  POSTQ_KV_ID?: string;
  POSTQ_KV_NAMESPACE?: string;
  POSTQ_KV_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_ACCOUNT_ID?: string;
  ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CF_API_TOKEN?: string;
  API_TOKEN?: string;
  CF_KV_POSTQ_NAMESPACE_ID?: string;
  CF_KV_NAMESPACE_ID?: string;
};

const FRONT_MATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
const KV_BRAIN_KEY = 'PostQ:thread-state';
const KV_BRAIN_SNAPSHOT_KEY = 'brain/latest';

function parseScalar(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    const num = Number(value);
    return Number.isNaN(num) ? value : num;
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function countIndent(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count += 1;
    else if (ch === '\t') count += 2;
    else break;
  }
  return count;
}

function peekNext(lines: string[], start: number): { index: number; indent: number; trimmed: string } | null {
  for (let i = start; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    return { index: i, indent: countIndent(lines[i]), trimmed };
  }
  return null;
}

function parseArray(lines: string[], start: number, indent: number): { value: unknown[]; index: number } {
  const items: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      i += 1;
      continue;
    }
    const currentIndent = countIndent(raw);
    if (currentIndent < indent || !trimmed.startsWith('- ')) {
      break;
    }
    const valuePart = trimmed.slice(2).trim();
    if (valuePart.length === 0) {
      const nested = parseBlock(lines, i + 1, indent + 2);
      items.push(nested.value);
      i = nested.index;
    } else {
      items.push(parseScalar(valuePart));
      i += 1;
    }
  }
  return { value: items, index: i };
}

function parseBlock(
  lines: string[],
  start: number,
  indent: number
): { value: Record<string, unknown> | unknown[]; index: number } {
  const result: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      i += 1;
      continue;
    }
    const currentIndent = countIndent(raw);
    if (currentIndent < indent) {
      break;
    }
    if (trimmed.startsWith('- ')) {
      const arr = parseArray(lines, i, currentIndent);
      return { value: arr.value, index: arr.index };
    }
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      i += 1;
      continue;
    }
    const key = trimmed.slice(0, colonIndex).trim();
    const remainder = trimmed.slice(colonIndex + 1).trim();
    if (remainder.length === 0) {
      const next = peekNext(lines, i + 1);
      if (!next || next.indent <= currentIndent) {
        result[key] = {};
        i += 1;
        continue;
      }
      const nested = parseBlock(lines, i + 1, currentIndent + 2);
      result[key] = nested.value;
      i = nested.index;
      continue;
    }
    result[key] = parseScalar(remainder);
    i += 1;
  }
  return { value: result, index: i };
}

function parseFrontMatter(raw: string): { data: Record<string, unknown> | null; warnings: string[] } {
  const warnings: string[] = [];
  const lines = raw.split(/\r?\n/);
  try {
    const parsed = parseBlock(lines, 0, 0).value;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { data: parsed as Record<string, unknown>, warnings };
    }
    warnings.push('front-matter-not-object');
  } catch (err) {
    warnings.push('front-matter-parse-failed');
    console.warn('[putBrainToKV] Failed to parse front matter', err);
  }
  return { data: null, warnings };
}

function parseBrainMarkdown(raw: string): {
  content: string;
  frontMatter: Record<string, unknown> | null;
  frontMatterRaw: string | null;
  warnings: string[];
} {
  const match = raw.match(FRONT_MATTER_REGEX);
  if (!match) {
    console.warn('[putBrainToKV] brain.md missing front matter header');
    return { content: raw.trimStart(), frontMatter: null, frontMatterRaw: null, warnings: ['missing-front-matter'] };
  }
  const [, frontMatterBlock] = match;
  const content = raw.slice(match[0].length).trimStart();
  const parsed = parseFrontMatter(frontMatterBlock);
  const warnings = [...parsed.warnings];
  if (!parsed.data) warnings.push('front-matter-empty');
  return { content, frontMatter: parsed.data, frontMatterRaw: frontMatterBlock, warnings };
}

function pickFirstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function pickAccountId(env: AnyEnv): string | undefined {
  return pickFirstString(env.POSTQ_KV_ID, env.CLOUDFLARE_ACCOUNT_ID, env.CF_ACCOUNT_ID, env.ACCOUNT_ID);
}

function pickNamespaceId(env: AnyEnv): string | undefined {
  return pickFirstString(env.POSTQ_KV_NAMESPACE, env.CF_KV_POSTQ_NAMESPACE_ID, env.CF_KV_NAMESPACE_ID);
}

function pickApiToken(env: AnyEnv): string | undefined {
  return pickFirstString(
    env.POSTQ_KV_TOKEN,
    env.CLOUDFLARE_API_TOKEN,
    (env as AnyEnv & { CLOUDFLARE_TOKEN?: string }).CLOUDFLARE_TOKEN,
    env.CF_API_TOKEN,
    env.API_TOKEN,
  );
}

function textSize(text: string): number {
  return new TextEncoder().encode(text).length;
}

function hasWritableKv(env: AnyEnv): env is AnyEnv & { BRAIN: Pick<KVNamespace, 'get' | 'put'> } {
  const kv = env?.BRAIN;
  return !!kv && typeof kv.put === 'function';
}

function hasReadableKv(env: AnyEnv): env is AnyEnv & { BRAIN: Pick<KVNamespace, 'get' | 'put'> } {
  const kv = env?.BRAIN;
  return !!kv && typeof kv.get === 'function';
}

function parseSnapshot(raw: string): Record<string, unknown> | null {
  if (raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (err) {
    console.warn('[getBrainSnapshot] Failed to parse brain snapshot JSON', err);
  }
  return null;
}

export type PutBrainResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  warnings?: string[];
  syncedAt?: string;
  bytes?: number;
  snapshot?: {
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    warnings?: string[];
    bytes?: number;
  };
};

type SnapshotCredentials = {
  accountId?: string;
  namespaceId?: string;
  apiToken?: string;
};

function cloneFrontMatter(frontMatter: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(frontMatter)) as Record<string, unknown>;
}

function buildSnapshotPayload(
  frontMatter: Record<string, unknown> | null,
  syncedAt: string
): Record<string, unknown> | null {
  if (!frontMatter || typeof frontMatter !== 'object' || Array.isArray(frontMatter)) {
    return null;
  }

  const snapshot = cloneFrontMatter(frontMatter);
  snapshot.lastUpdated = syncedAt;
  snapshot.lastSynced = syncedAt;
  return snapshot;
}

async function putSnapshotToKv(
  env: AnyEnv,
  snapshot: Record<string, unknown>,
  credentials: SnapshotCredentials
): Promise<{ bytes: number }> {
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;

  const bytes = textSize(json);
  if (hasWritableKv(env)) {
    await env.BRAIN.put(KV_BRAIN_SNAPSHOT_KEY, json);
    console.log('[putBrainSnapshot] Updated brain snapshot in KV', {
      key: KV_BRAIN_SNAPSHOT_KEY,
      bytes,
      target: 'binding',
    });
    return { bytes };
  }

  const accountId = credentials.accountId ?? pickAccountId(env);
  const namespaceId = credentials.namespaceId ?? pickNamespaceId(env);
  const apiToken = credentials.apiToken ?? pickApiToken(env);

  await putConfigToCloudflare(KV_BRAIN_SNAPSHOT_KEY, json, {
    accountId,
    namespaceId,
    apiToken,
    contentType: 'application/json',
  });

  console.log('[putBrainSnapshot] Updated brain snapshot in KV', {
    key: KV_BRAIN_SNAPSHOT_KEY,
    bytes,
  });
  return { bytes };
}

async function readSnapshotFromBinding(env: AnyEnv): Promise<
  | { key: string; raw: string; bytes: number; data: Record<string, unknown> | null }
  | null
> {
  if (!hasReadableKv(env)) return null;
  try {
    const raw = await env.BRAIN.get(KV_BRAIN_SNAPSHOT_KEY);
    if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
      return null;
    }
    const bytes = textSize(raw);
    return { key: KV_BRAIN_SNAPSHOT_KEY, raw, bytes, data: parseSnapshot(raw) };
  } catch (err) {
    console.warn('[getBrainSnapshot] Failed to read brain snapshot from KV binding', err);
    return null;
  }
}

async function putBrainSnapshotFromParsed(
  env: AnyEnv,
  parsed: ReturnType<typeof parseBrainMarkdown>,
  syncedAt: string,
  credentials: SnapshotCredentials
): Promise<PutBrainResult> {
  const warnings: string[] = [];
  const snapshot = buildSnapshotPayload(parsed.frontMatter, syncedAt);
  if (!snapshot) {
    warnings.push('snapshot-front-matter-missing');
    return {
      ok: false,
      skipped: true,
      reason: 'snapshot-front-matter-missing',
      warnings,
      syncedAt,
    };
  }

  try {
    const { bytes } = await putSnapshotToKv(env, snapshot, credentials);
    return {
      ok: true,
      bytes,
      syncedAt,
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[putBrainSnapshot] Failed to update brain/latest snapshot', reason);
    return {
      ok: false,
      reason,
      warnings: [...warnings, 'snapshot-sync-failed'],
      syncedAt,
    };
  }
}

export async function putBrainSnapshot(env: AnyEnv): Promise<PutBrainResult> {
  const brainMarkdown = await getBrain(env);
  if (!brainMarkdown || brainMarkdown.trim().length === 0) {
    console.warn('[putBrainSnapshot] brain.md fetch returned empty payload');
    return { ok: false, skipped: true, reason: 'brain-empty' };
  }

  const parsed = parseBrainMarkdown(brainMarkdown);
  const syncedAt = new Date().toISOString();
  const baseWarnings = [...(parsed.warnings ?? [])];

  const result = await putBrainSnapshotFromParsed(env, parsed, syncedAt, {
    accountId: pickAccountId(env),
    namespaceId: pickNamespaceId(env),
    apiToken: pickApiToken(env),
  });

  const warnings = [...baseWarnings, ...(result.warnings ?? [])];
  return {
    ...result,
    warnings: warnings.length ? warnings : undefined,
    syncedAt,
  };
}

export async function putBrainToKV(env: AnyEnv): Promise<PutBrainResult> {
  const brainMarkdown = await getBrain(env);
  if (!brainMarkdown || brainMarkdown.trim().length === 0) {
    console.warn('[putBrainToKV] brain.md fetch returned empty payload');
    return { ok: false, skipped: true, reason: 'brain-empty' };
  }

  const parsed = parseBrainMarkdown(brainMarkdown);
  const warnings = [...(parsed.warnings ?? [])];

  const syncedAt = new Date().toISOString();

  const credentials = {
    accountId: pickAccountId(env),
    namespaceId: pickNamespaceId(env),
    apiToken: pickApiToken(env),
  };

  const snapshotResult = await putBrainSnapshotFromParsed(env, parsed, syncedAt, credentials);
  if (snapshotResult.warnings) warnings.push(...snapshotResult.warnings);

  let existing: Record<string, unknown> = {};
  try {
    const kv = env.BRAIN;
    if (kv && typeof kv.get === 'function') {
      const raw = await kv.get(KV_BRAIN_KEY, { type: 'text' });
      if (raw) {
        existing = JSON.parse(raw);
      }
    }
  } catch (err) {
    warnings.push('existing-state-read-failed');
    console.warn('[putBrainToKV] Unable to read existing KV state', err);
  }

  const brainEntry = {
    markdown: brainMarkdown,
    content: parsed.content,
    frontMatter: parsed.frontMatter,
    frontMatterRaw: parsed.frontMatterRaw,
    warnings: warnings.length ? warnings : undefined,
    syncedAt,
  };

  const nextState = { ...existing, brain: brainEntry };
  const json = JSON.stringify(nextState, null, 2);

  await putConfigToCloudflare(KV_BRAIN_KEY, json, {
    accountId: credentials.accountId,
    namespaceId: credentials.namespaceId,
    apiToken: credentials.apiToken,
    contentType: 'application/json',
  });

  const bytes = textSize(json);
  console.log('[putBrainToKV] Updated brain blob in KV', { key: KV_BRAIN_KEY, bytes });
  return {
    ok: true,
    syncedAt,
    bytes,
    warnings: warnings.length ? warnings : undefined,
    snapshot: snapshotResult,
  };
}

export type BrainSnapshotRecord = {
  key: string;
  raw: string;
  data: Record<string, unknown> | null;
  bytes: number;
};

export async function getBrainSnapshot(env: AnyEnv): Promise<BrainSnapshotRecord | null> {
  const bindingSnapshot = await readSnapshotFromBinding(env);
  if (bindingSnapshot) return bindingSnapshot;

  const accountId = pickAccountId(env);
  const namespaceId = pickNamespaceId(env);
  const apiToken = pickApiToken(env);

  if (!accountId || !namespaceId || !apiToken) {
    console.warn(
      '[getBrainSnapshot] Cloudflare credentials unavailable; brain snapshot cannot be fetched.'
    );
    return null;
  }

  try {
    const raw = await getConfigValue<string>(KV_BRAIN_SNAPSHOT_KEY, {
      accountId,
      namespaceId,
      apiToken,
    });
    if (!raw || raw.trim().length === 0) {
      console.warn('[getBrainSnapshot] brain/latest returned empty payload');
      return null;
    }
    const bytes = textSize(raw);
    return { key: KV_BRAIN_SNAPSHOT_KEY, raw, bytes, data: parseSnapshot(raw) };
  } catch (err) {
    console.warn('[getBrainSnapshot] Failed to fetch brain snapshot from Cloudflare', err);
    return null;
  }
}

export const putConfig = putConfigToCloudflare;
