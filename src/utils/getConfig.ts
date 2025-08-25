// 📍 File: src/utils/getConfig.ts
import { getSecretBlobFromKV } from './kv';

let _cache: Record<string, any> | null = null;

export async function getConfig(key?: string): Promise<any> {
  if (!_cache) {
    const raw = await getSecretBlobFromKV('SECRET_BLOB');
    _cache = JSON.parse(raw || '{}');
  }

  if (!key) return _cache;
  return _cache[key];
}