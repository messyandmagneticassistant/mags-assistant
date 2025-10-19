// 📍 File: src/utils/getConfig.ts

import { getSecretBlobFromKV } from './kv';

const DEFAULT_BLOB_KEY = process.env.MAGGIE_SECRET_BLOB_KEY || 'SECRETS_BLOB';
const RETRY_DELAY_MS = Number(process.env.MAGGIE_CONFIG_RETRY_MS || '60000');
const MAX_ERROR_SNIPPET = 4000;

type ConfigSource = 'kv' | 'fallback' | 'empty';

let _cache: Record<string, any> | null = null;
let _source: ConfigSource = 'empty';
let _loadingPromise: Promise<void> | null = null;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _lastError: string | null = null;
let _lastAttemptAt: number | null = null;
let _lastSuccessAt: number | null = null;
let _fallbackCache: Record<string, any> | null = null;
let _retryCount = 0;

function ensureObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function summarizeError(err: unknown): string {
  if (!err) return 'unknown error';
  if (err instanceof Error && err.message) return err.message.slice(0, MAX_ERROR_SNIPPET);
  if (typeof err === 'string') return err.slice(0, MAX_ERROR_SNIPPET);
  try {
    return JSON.stringify(err).slice(0, MAX_ERROR_SNIPPET);
  } catch {
    return String(err).slice(0, MAX_ERROR_SNIPPET);
  }
}

function parseJsonBlob(raw: string | null): Record<string, any> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return ensureObject(parsed);
  } catch (err) {
    _lastError = `Failed to parse KV blob: ${summarizeError(err)}`;
    console.warn('[getConfig] Unable to parse KV blob', err);
    return null;
  }
}

function loadFallbackFromEnv(): Record<string, any> {
  if (_fallbackCache) {
    return _fallbackCache;
  }

  const candidateValues = [
    process.env.MAGGIE_CONFIG_JSON,
    process.env.SECRET_BLOB,
  ];

  for (const candidate of candidateValues) {
    if (!candidate || !candidate.trim()) continue;
    try {
      const parsed = JSON.parse(candidate);
      _fallbackCache = ensureObject(parsed);
      if (Object.keys(_fallbackCache).length) {
        console.warn('[getConfig] Using MAGGIE_CONFIG fallback secrets blob.');
      }
      return _fallbackCache;
    } catch (err) {
      console.warn('[getConfig] Failed to parse fallback config payload', err);
    }
  }

  _fallbackCache = {};
  return _fallbackCache;
}

async function loadFromKv(): Promise<Record<string, any> | null> {
  try {
    const raw = await getSecretBlobFromKV(DEFAULT_BLOB_KEY);
    const parsed = parseJsonBlob(raw);
    if (parsed) {
      _lastError = null;
      _lastSuccessAt = Date.now();
      _retryCount = 0;
    }
    return parsed;
  } catch (err) {
    _lastError = summarizeError(err);
    console.warn('[getConfig] Failed to load secrets from KV', err);
    return null;
  }
}

function scheduleBackgroundRefresh(): void {
  if (typeof setTimeout !== 'function') return;
  if (_retryTimer) return;

  const delay = Number.isFinite(RETRY_DELAY_MS) && RETRY_DELAY_MS > 0 ? RETRY_DELAY_MS : 60000;
  _retryTimer = setTimeout(async () => {
    _retryTimer = null;
    try {
      const next = await loadFromKv();
      if (next && Object.keys(next).length) {
        _cache = next;
        _source = 'kv';
        return;
      }
    } catch (err) {
      _lastError = summarizeError(err);
    }
    _retryCount += 1;
    scheduleBackgroundRefresh();
  }, delay);
}

async function ensureConfigLoaded(): Promise<void> {
  if (_cache) return;
  if (_loadingPromise) {
    await _loadingPromise;
    return;
  }

  _loadingPromise = (async () => {
    _lastAttemptAt = Date.now();
    const fromKv = await loadFromKv();
    if (fromKv && Object.keys(fromKv).length) {
      _cache = fromKv;
      _source = 'kv';
      return;
    }

    const fallback = loadFallbackFromEnv();
    _cache = fallback;
    _source = Object.keys(fallback).length ? 'fallback' : 'empty';
    if (!_lastError) {
      _lastError = 'KV blob unavailable; using fallback configuration';
    }
    scheduleBackgroundRefresh();
  })()
    .catch((err) => {
      _lastError = summarizeError(err);
      console.error('[getConfig] Unexpected error initializing config', err);
      _cache = loadFallbackFromEnv();
      _source = Object.keys(_cache).length ? 'fallback' : 'empty';
      scheduleBackgroundRefresh();
    })
    .finally(() => {
      _loadingPromise = null;
    });

  await _loadingPromise;
}

export async function getConfig(key?: string): Promise<any> {
  await ensureConfigLoaded();
  const snapshot = _cache ?? {};
  return key ? snapshot?.[key] : snapshot;
}

export function clearConfigCache(): void {
  _cache = null;
  _loadingPromise = null;
  if (_retryTimer) {
    clearTimeout(_retryTimer);
    _retryTimer = null;
  }
}

export function getConfigDiagnostics() {
  return {
    source: _source,
    lastAttemptAt: _lastAttemptAt,
    lastSuccessAt: _lastSuccessAt,
    lastError: _lastError,
    retryCount: _retryCount,
    hasFallback: Object.keys(_fallbackCache ?? {}).length > 0,
  } as const;
}
