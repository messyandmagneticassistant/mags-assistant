import axios from 'axios';

const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const NAMESPACE_ID = process.env.KV_NAMESPACE_ID;

export async function putConfig(key: string, value: any) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/values/${key}`;

  const res = await axios.put(url, JSON.stringify(value), {
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  return res.data;
}

export async function saveToKV(key: string, value: any) {
  let base = process.env.WORKER_URL;
  let auth = process.env.WORKER_KEY;

  if (!base || !auth) {
    try {
      const { getConfig } = await import('../utils/config');
      const cfg = await getConfig('cloudflare');
      base ||= (cfg as any).worker_url || (cfg as any).workerUrl;
      auth ||= (cfg as any).worker_key || (cfg as any).workerKey;
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
