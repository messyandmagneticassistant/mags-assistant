// 📍 File: src/utils/getConfig.ts

import { getSecretBlobFromKV } from './kv';

let _cache: Record<string, any> | null = null;

function ensureCacheShape(value: unknown): Record<string, any> {
  if (value && typeof value === 'object') {
    return value as Record<string, any>;
  }
  return {};
}

/**
 * Loads the unified secret blob from Cloudflare KV and caches it.
 * Allows fetching the full blob or a specific nested key (e.g., 'telegram', 'stripe').
 */
export async function getConfig(key?: string): Promise<any> {
  if (!_cache) {
    const raw = await getSecretBlobFromKV('SECRETS_BLOB'); // ✅ ensure this key name is correct in KV
    const parsed = raw ? JSON.parse(raw) : {};
    _cache = ensureCacheShape(parsed);
  }

  if (!_cache) {
    _cache = {};
  }

  return key ? _cache[key] : _cache;
}