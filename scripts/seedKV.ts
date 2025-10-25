import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { DEFAULT_KV_DAILY_LIMIT, estimateKvWritesRemaining, fetchKvUsageSummary } from '../lib/cloudflare/kvAnalytics';
import { putConfig } from '../lib/kv';
import { describeKvWriteState, isKvWriteAllowed } from '../shared/kvWrites';

type SyncSource =
  | { type: 'env'; name: string; optional?: boolean }
  | { type: 'file'; path: string; optional?: boolean };

interface SyncEntry {
  key: string;
  contentType: string;
  source: SyncSource;
  encoding: 'json' | 'text';
  label: string;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'enable']);
const FALSY = new Set(['0', 'false', 'no', 'off', 'disable']);

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return undefined;
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (TRUTHY.has(normalized)) return true;
    if (FALSY.has(normalized)) return false;
  }
  return undefined;
}

function hasArg(name: string): boolean {
  const normalized = name.startsWith('--') ? name : `--${name}`;
  return process.argv.includes(normalized);
}

async function readFileIfExists(relativePath: string): Promise<string | undefined> {
  const full = path.resolve(process.cwd(), relativePath);
  try {
    return await fs.readFile(full, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return undefined;
    }
    console.warn(`[seedKV] Unable to read ${relativePath}:`, error);
    return undefined;
  }
}

function resolveEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

async function resolveSource(source: SyncSource): Promise<{ value?: string; origin: string }> {
  if (source.type === 'env') {
    const value = resolveEnv(source.name);
    if (value === undefined && !source.optional) {
      throw new Error(`Missing required env ${source.name}`);
    }
    return { value, origin: `env:${source.name}` };
  }
  const value = await readFileIfExists(source.path);
  if (value === undefined && !source.optional) {
    throw new Error(`Missing required file ${source.path}`);
  }
  return { value, origin: source.path };
}

function baseEntries(): SyncEntry[] {
  return [
    {
      key: 'thread-state',
      contentType: 'application/json',
      source: { type: 'env', name: 'THREAD_STATE_JSON', optional: true },
      encoding: 'json',
      label: 'THREAD_STATE_JSON',
    },
    {
      key: 'thread-state',
      contentType: 'application/json',
      source: { type: 'file', path: 'config/thread-state.json', optional: true },
      encoding: 'json',
      label: 'config/thread-state.json',
    },
    {
      key: 'PostQ:thread-state',
      contentType: 'application/json',
      source: { type: 'env', name: 'BRAIN_DOC_JSON', optional: true },
      encoding: 'json',
      label: 'BRAIN_DOC_JSON',
    },
    {
      key: 'PostQ:thread-state',
      contentType: 'text/markdown',
      source: { type: 'env', name: 'BRAIN_DOC_MD', optional: true },
      encoding: 'text',
      label: 'BRAIN_DOC_MD',
    },
    {
      key: 'PostQ:thread-state',
      contentType: 'application/json',
      source: { type: 'file', path: 'brain/brain.json', optional: true },
      encoding: 'json',
      label: 'brain/brain.json (thread-state)',
    },
    {
      key: 'brain/latest',
      contentType: 'application/json',
      source: { type: 'file', path: 'brain/brain.json', optional: true },
      encoding: 'json',
      label: 'brain/brain.json',
    },
  ];
}

function parsePayload(raw: string | undefined, encoding: 'json' | 'text'): unknown {
  if (raw === undefined) return undefined;
  if (encoding === 'json') {
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn('[seedKV] Invalid JSON payload detected; sending raw text instead.', error);
      return raw;
    }
  }
  return raw;
}

function computeSize(value: unknown): number {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return Buffer.byteLength(serialized);
}

async function checkQuota(
  enforceQuota: boolean,
  safeMode: boolean,
  limit: number,
  minRemaining: number,
  windowSeconds: number
): Promise<void> {
  if (!enforceQuota) return;
  try {
    const usage = await fetchKvUsageSummary({ sinceSeconds: windowSeconds });
    const remaining = estimateKvWritesRemaining(usage, limit);
    console.log(
      `[seedKV] Cloudflare KV usage (window ≈${usage.windowSeconds ?? windowSeconds}s): writes=${usage.writes}, reads=${usage.reads}, deletes=${usage.deletes}, remaining≈${remaining}.`
    );

    if (remaining <= minRemaining) {
      throw new Error(
        `Remaining KV writes (${remaining}) below safety threshold (${minRemaining}). Refusing to push.`
      );
    }
  } catch (error) {
    if (!safeMode) {
      console.warn('[seedKV] Unable to verify KV quota before syncing:', error);
      return;
    }
    throw error instanceof Error
      ? error
      : new Error(`[seedKV] Safe mode abort: ${(error as Error)?.message ?? String(error)}`);
  }
}

async function main() {
  const allowed = isKvWriteAllowed(process.env);
  const stateDescription = describeKvWriteState(process.env);
  if (!allowed) {
    console.warn(`[seedKV] KV writes are ${stateDescription}; skipping sync.`);
    return;
  }

  const dryRun = hasArg('--dry-run') || parseBoolean(process.env.KV_SYNC_DRY_RUN) === true;
  const safeMode =
    hasArg('--safe') ||
    hasArg('--safe-mode') ||
    parseBoolean(process.env.KV_SYNC_SAFE_MODE) === true;
  const force = hasArg('--force') || parseBoolean(process.env.KV_SYNC_FORCE) === true;
  const enforceQuota =
    safeMode ||
    hasArg('--check-quota') ||
    parseBoolean(process.env.KV_SYNC_ENFORCE_QUOTA) === true;

  const parsedLimit = Number.parseInt(process.env.KV_SYNC_DAILY_LIMIT ?? `${DEFAULT_KV_DAILY_LIMIT}`, 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_KV_DAILY_LIMIT;
  const minRemainingRaw = Number.parseInt(process.env.KV_SYNC_MIN_WRITES ?? '100', 10);
  const windowSecondsParsed = Number.parseInt(process.env.KV_SYNC_USAGE_WINDOW ?? '86400', 10);
  const windowSeconds = Number.isFinite(windowSecondsParsed) && windowSecondsParsed > 0 ? windowSecondsParsed : 86400;
  const minRemaining = Number.isFinite(minRemainingRaw)
    ? Math.max(0, Math.min(limit, minRemainingRaw))
    : 100;

  if (dryRun) {
    console.log('[seedKV] Running in dry-run mode. No writes will be performed.');
  }
  if (safeMode) {
    console.log('[seedKV] Safe mode enabled. Quota checks are enforced before writes.');
  }

  await checkQuota(enforceQuota && !dryRun, safeMode && !force, limit, minRemaining, windowSeconds);

  const entries = baseEntries();
  const workerManifestRaw = await readFileIfExists('kv/worker-kv.json');
  if (workerManifestRaw) {
    try {
      const manifest = JSON.parse(workerManifestRaw) as Record<string, unknown>;
      for (const [key, template] of Object.entries(manifest)) {
        if (typeof key !== 'string' || !key.trim()) continue;
        if (typeof template !== 'string' || !template.trim()) continue;
        const envMatch = template.match(/^\$\{([^}]+)\}$/);
        if (envMatch) {
          const envName = envMatch[1];
          entries.push({
            key,
            contentType: 'text/plain',
            source: { type: 'env', name: envName, optional: true },
            encoding: 'text',
            label: `env:${envName}`,
          });
        } else {
          entries.push({
            key,
            contentType: 'text/plain',
            source: { type: 'file', path: template, optional: true },
            encoding: 'text',
            label: template,
          });
        }
      }
    } catch (error) {
      console.warn('[seedKV] Unable to parse kv/worker-kv.json:', error);
    }
  }

  const writes: { key: string; contentType: string; payload: unknown; origin: string }[] = [];

  const seenKeys = new Set<string>();
  for (const entry of entries) {
    if (seenKeys.has(entry.key)) continue;
    const { value, origin } = await resolveSource(entry.source);
    if (value === undefined) continue;
    const payload = parsePayload(value, entry.encoding);
    writes.push({ key: entry.key, contentType: entry.contentType, payload, origin });
    seenKeys.add(entry.key);
  }

  if (!writes.length) {
    console.log('[seedKV] No KV payloads resolved; nothing to sync.');
    return;
  }

  console.log(`[seedKV] Preparing to sync ${writes.length} KV entr${writes.length === 1 ? 'y' : 'ies'}.`);
  for (const write of writes) {
    const size = computeSize(write.payload);
    if (dryRun) {
      console.log(
        `[seedKV] DRY RUN → would write ${write.key} (${size} bytes, source=${write.origin}, type=${write.contentType}).`
      );
      continue;
    }

    try {
      const result = await putConfig(write.key, write.payload, { contentType: write.contentType });
      if (result.skipped) {
        console.warn(`[seedKV] Skipped ${write.key}: ${result.reason ?? 'kv-writes-disabled'}`);
        continue;
      }
      console.log(
        `[seedKV] ✅ Synced ${write.key} (${size} bytes) from ${write.origin} with content-type ${write.contentType}.`
      );
    } catch (error) {
      if (!force) {
        throw error instanceof Error
          ? error
          : new Error(`[seedKV] Failed to sync ${write.key}: ${String(error)}`);
      }
      console.error(`[seedKV] Failed to write ${write.key} but continuing due to --force.`);
      console.error(error);
    }
  }
}

main().catch((err) => {
  console.error('[seedKV] Fatal error during KV sync:', err instanceof Error ? err.message : err);
  if (err instanceof Error && (err as any).stack) {
    console.error(err.stack);
  }
  process.exit(1);
});

