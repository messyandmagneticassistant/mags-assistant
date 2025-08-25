import { getConfig } from '../utils/config';

export async function saveToKV(key: string, value: any) {
  let base = process.env.WORKER_URL;
  let auth = process.env.WORKER_KEY;

  // Fallback to config lookup if env vars missing
  if (!base || !auth) {
    try {
      const cfg = await getConfig('cloudflare');
      base ||= cfg.worker_url || cfg.workerUrl;
      auth ||= cfg.worker_key || cfg.workerKey;
    } catch {
      // ignore and rely on env vars
    }
  }

  if (!base || !auth) {
    throw new Error('Missing WORKER_URL or WORKER_KEY');
  }

  const url = `${base.replace(/\/?$/, '')}/kv/${encodeURIComponent(key)}`;
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Failed to write to KV: ${res.status}`);
  }
  return { ok: true };
}
export default saveToKV;
