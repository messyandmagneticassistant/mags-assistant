// 📍 File: src/utils/getConfig.ts

import { getSecretBlobFromKV } from './kv';

let _cache: Record<string, any> | null = null;

/**
 * Loads the unified secret blob from Cloudflare KV and caches it.
 * Allows fetching the full blob or a specific nested key (e.g., 'telegram', 'stripe').
 */
export async function getConfig(key?: string): Promise<any> {
  if (!_cache) {
    const raw = await getSecretBlobFromKV('SECRETS_BLOB'); // ✅ ensure this key name is correct in KV
    _cache = JSON.parse(raw || '{}');
  }

  return key ? _cache[key] : _cache;
}