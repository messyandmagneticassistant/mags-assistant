import { readFile } from 'fs/promises';
import path from 'path';
import { putBrainSnapshot } from '../lib/putConfig';

const store = new Map<string, string>();

const env: Record<string, unknown> & {
  BRAIN: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
} = {
  ...process.env,
  BRAIN: {
    async get() {
      return store.get('brain') ?? null;
    },
    async put(_, value) {
      store.set('brain', value);
    },
  },
};

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
  const defaultPath = path.resolve(process.cwd(), 'brain/brain.json');

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = requestToUrl(input);
    if (!url.includes('raw.githubusercontent.com')) {
      return originalFetch(input as any, init);
    }

    try {
      return await originalFetch(input as any, init);
    } catch (err) {
      const localPath = localPathEnv ? path.resolve(process.cwd(), localPathEnv) : defaultPath;
      const body = await readFile(localPath, 'utf8');
      console.warn('[runPutBrainSnapshotToBrain] ⚠️ Using local brain/brain.json fallback for snapshot sync.');
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  }) as typeof fetch;
}

async function main() {
  installFetchFallback();

  const result = await putBrainSnapshot(env);
  if (!result.ok) {
    console.error('[runPutBrainSnapshotToBrain] ❌ Snapshot sync failed', result);
    process.exit(1);
  }

  const raw = store.get('brain');
  if (!raw) {
    console.error('[runPutBrainSnapshotToBrain] ❌ No brain snapshot stored');
    process.exit(1);
  }

  console.log('[runPutBrainSnapshotToBrain] ✅ Snapshot synced under key "brain"', {
    bytes: new TextEncoder().encode(raw).length,
    syncedAt: result.syncedAt,
  });

  const lines = raw.split('\n').slice(0, 12);
  console.log('[runPutBrainSnapshotToBrain] 🔍 Preview');
  console.log(lines.join('\n'));
}

main().catch((err) => {
  console.error('[runPutBrainSnapshotToBrain] ❌ Unexpected error', err);
  process.exit(1);
});
