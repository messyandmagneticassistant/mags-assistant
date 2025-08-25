// 📍 File: src/utils/kv.ts

export async function getSecretBlobFromKV(blobKey: string): Promise<string | null> {
  try {
    const namespace = globalThis.__STATIC_CONTENT_KV__ || process.env.KV || undefined;
    const kv = (globalThis as any)[blobKey] || (globalThis as any)['__KV__'];

    if (!kv || !kv.get) {
      throw new Error(`[getSecretBlobFromKV] KV namespace is not available`);
    }

    return await kv.get(blobKey);
  } catch (err) {
    console.error(`[getSecretBlobFromKV] Failed to retrieve blob: ${err.message}`);
    return null;
  }
}