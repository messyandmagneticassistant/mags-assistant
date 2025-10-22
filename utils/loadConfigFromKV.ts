import { promises as fs } from 'fs';
import path from 'path';
import {
  cloudflareAccountId,
  cloudflareApiToken,
  cloudflareNamespaceId,
  resolveThreadStateEnv,
  threadStateFallbackPaths,
} from '../config/env.ts';

export type ThreadStateSource = 'kv' | 'fallback' | 'empty';

export interface ThreadStateLoadResult {
  config: Record<string, any> | null;
  raw: string | null;
  source: ThreadStateSource;
  key: string;
  accountId: string;
  namespaceId: string;
  bytes?: number;
  fetchedAt: string;
  error?: string;
  fallbackPath?: string;
}

interface KvFetchOptions {
  key: string;
  accountId?: string;
  namespaceId?: string;
  apiToken?: string;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    const abs = path.resolve(filePath);
    return await fs.readFile(abs, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null;
    }
    console.warn(`[loadConfigFromKV] Failed to read fallback ${filePath}:`, err);
    return null;
  }
}

function parseJson(text: string | null): Record<string, any> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch (err) {
    console.warn('[loadConfigFromKV] Unable to parse JSON payload from KV:', err);
    return null;
  }
}

async function fetchFromKv({ key, accountId, namespaceId, apiToken }: KvFetchOptions) {
  const account = accountId || cloudflareAccountId;
  const namespace = namespaceId || cloudflareNamespaceId;
  const token = apiToken || cloudflareApiToken;

  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}/values/${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`);
  }

  const text = await response.text();
  const parsed = parseJson(text);
  return { raw: text, parsed, bytes: Buffer.byteLength(text), key, account, namespace } as const;
}

async function loadFromFallback(paths: string[]): Promise<ThreadStateLoadResult | null> {
  for (const relPath of paths) {
    const raw = await readFileIfExists(relPath);
    if (!raw) continue;
    const parsed = parseJson(raw);
    if (!parsed) continue;
    return {
      config: parsed,
      raw,
      source: 'fallback',
      key: path.basename(relPath),
      accountId: cloudflareAccountId,
      namespaceId: cloudflareNamespaceId,
      bytes: Buffer.byteLength(raw),
      fetchedAt: new Date().toISOString(),
      fallbackPath: path.resolve(relPath),
    };
  }
  return null;
}

export interface LoadConfigOptions {
  key?: string;
  fallbackKey?: string;
  accountId?: string;
  namespaceId?: string;
  apiToken?: string;
  fallbackPaths?: string[];
}

export async function loadConfigFromKV(key?: string, options: LoadConfigOptions = {}): Promise<ThreadStateLoadResult> {
  const env = resolveThreadStateEnv();

  const keysToTry = [options.key || key || env.key];
  const fallbackKey = options.fallbackKey || env.fallbackKey;
  if (fallbackKey && !keysToTry.includes(fallbackKey)) {
    keysToTry.push(fallbackKey);
  }

  const accountId = options.accountId || env.accountId;
  const namespaceId = options.namespaceId || env.namespaceId;
  const apiToken = options.apiToken || env.apiToken;

  const attemptedErrors: string[] = [];

  for (const candidateKey of keysToTry) {
    try {
      const { raw, parsed, bytes } = await fetchFromKv({
        key: candidateKey,
        accountId,
        namespaceId,
        apiToken,
      });

      if (!parsed) {
        attemptedErrors.push(`Key "${candidateKey}" did not return valid JSON.`);
        continue;
      }

      return {
        config: parsed,
        raw,
        source: 'kv',
        key: candidateKey,
        accountId,
        namespaceId,
        bytes,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attemptedErrors.push(`Key "${candidateKey}" — ${message}`);
    }
  }

  const fallbackPaths = options.fallbackPaths || threadStateFallbackPaths;
  const fallback = await loadFromFallback(fallbackPaths);
  if (fallback) {
    fallback.error = attemptedErrors.join(' | ') || undefined;
    return fallback;
  }

  return {
    config: null,
    raw: null,
    source: 'empty',
    key: keysToTry[0] || env.key,
    accountId,
    namespaceId,
    fetchedAt: new Date().toISOString(),
    error: attemptedErrors.join(' | ') || 'No configuration payload available.',
  };
}
