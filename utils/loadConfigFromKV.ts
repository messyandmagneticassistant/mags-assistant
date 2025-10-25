import { promises as fs } from 'fs';
import path from 'path';
import {
  cloudflareAccountId,
  cloudflareApiToken,
  cloudflareNamespaceId,
  resolveThreadStateEnv,
  canonicalBrainFallbackPaths,
} from '../config/env.ts';

export type ThreadStateSource = 'kv' | 'local' | 'secret' | 'empty';

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
  secretName?: string;
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
      source: 'local',
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

function loadFromEnvSecrets(): ThreadStateLoadResult | null {
  if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    return null;
  }

  const candidates: Array<[string, string | undefined]> = [
    ['THREAD_STATE_JSON', process.env.THREAD_STATE_JSON],
    ['RUNTIME_CONFIG_JSON', process.env.RUNTIME_CONFIG_JSON],
    ['CONFIG_JSON', process.env.CONFIG_JSON],
  ];

  for (const [name, value] of candidates) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) continue;
    const parsed = parseJson(raw);
    if (!parsed) continue;
    return {
      config: parsed,
      raw,
      source: 'secret',
      key: `env:${name}`,
      accountId: cloudflareAccountId,
      namespaceId: cloudflareNamespaceId,
      bytes: Buffer.byteLength(raw),
      fetchedAt: new Date().toISOString(),
      secretName: name,
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

  const accountId = options.accountId || env.accountId;
  const namespaceId = options.namespaceId || env.namespaceId;
  const apiToken = options.apiToken || env.apiToken;

  const secretResult = loadFromEnvSecrets();
  if (secretResult) {
    return secretResult;
  }

  const fallbackPaths = options.fallbackPaths || canonicalBrainFallbackPaths;
  const local = await loadFromFallback(fallbackPaths);
  if (local) {
    return local;
  }

  const keysToTry = [options.key || key || env.key];
  const fallbackKey = options.fallbackKey || env.fallbackKey;
  if (fallbackKey && !keysToTry.includes(fallbackKey)) {
    keysToTry.push(fallbackKey);
  }

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
        error: attemptedErrors.length ? attemptedErrors.join(' | ') : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attemptedErrors.push(`Key "${candidateKey}" — ${message}`);
    }
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
