import { readFile } from 'fs/promises';
import path from 'path';
import { getBrainSnapshot, putBrainSnapshot, type BrainSnapshotRecord } from '../lib/putConfig';

type KvBinding = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

type MutableEnv = Record<string, unknown> & { BRAIN?: KvBinding };

function hasCloudflareCredentials(env: NodeJS.ProcessEnv): boolean {
  const account = env.POSTQ_KV_ID || env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID || env.ACCOUNT_ID;
  const namespace = env.POSTQ_KV_NAMESPACE || env.CF_KV_POSTQ_NAMESPACE_ID || env.CF_KV_NAMESPACE_ID;
  const token =
    env.POSTQ_KV_TOKEN ||
    env.CLOUDFLARE_API_TOKEN ||
    env.CLOUDFLARE_TOKEN ||
    env.CF_API_TOKEN ||
    env.API_TOKEN;
  return Boolean(account && namespace && token);
}

function createMemoryKv(): KvBinding {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function snapshotSample(snapshot: BrainSnapshotRecord): Record<string, unknown> | string {
  if (snapshot.data && typeof snapshot.data === 'object') {
    const entries = Object.entries(snapshot.data).slice(0, 5);
    return Object.fromEntries(entries);
  }
  return snapshot.raw.slice(0, 200);
}

function requestToUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return '';
}

function installFetchFallback(): void {
  const originalFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
  if (!originalFetch) return;

  const localPathEnv = typeof process.env.LOCAL_BRAIN_PATH === 'string' ? process.env.LOCAL_BRAIN_PATH.trim() : '';
  const defaultPath = path.resolve(process.cwd(), 'brain/brain.md');

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = requestToUrl(input);
    if (!url.includes('raw.githubusercontent.com')) {
      return originalFetch(input as any, init);
    }

    try {
      return await originalFetch(input as any, init);
    } catch (err) {
      const localPath = localPathEnv ? path.resolve(process.cwd(), localPathEnv) : defaultPath;
      try {
        const body = await readFile(localPath, 'utf8');
        console.warn('[putBrainSnapshot] ⚠️ Using local brain/brain.md fallback for snapshot sync.');
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      } catch (readErr) {
        console.error('[putBrainSnapshot] ❌ Failed to load local brain fallback', readErr);
        throw err;
      }
    }
  }) as typeof fetch;
}

async function run() {
  installFetchFallback();
  const env: MutableEnv = { ...process.env };
  if (!hasCloudflareCredentials(process.env)) {
    env.BRAIN = createMemoryKv();
    console.warn(
      '[putBrainSnapshot] ⚠️ Cloudflare credentials not detected; using in-memory KV binding for snapshot sync.'
    );
  }

  try {
    const result = await putBrainSnapshot(env);
    if (result.ok) {
      console.log('[putBrainSnapshot] ✅ Snapshot synced', {
        syncedAt: result.syncedAt ?? null,
        bytes: result.bytes ?? null,
        warnings: result.warnings ?? [],
      });

      const snapshot = await getBrainSnapshot(env);
      if (snapshot) {
        console.log('[putBrainSnapshot] 🔍 Snapshot verification', {
          key: snapshot.key,
          bytes: snapshot.bytes,
          sample: snapshotSample(snapshot),
        });
      } else {
        console.warn('[putBrainSnapshot] ⚠️ Snapshot verification unavailable.');
      }

      process.exit(0);
    }

    console.error('[putBrainSnapshot] ⚠️ Snapshot skipped or failed', result);
    process.exit(result.skipped ? 0 : 1);
  } catch (err) {
    console.error('[putBrainSnapshot] ❌ Unexpected error', err);
    process.exit(1);
  }
}

run();
