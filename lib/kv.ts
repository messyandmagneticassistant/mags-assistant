import { getConfig } from '../utils/config';

type CloudflareCredentials = {
  accountId: string;
  namespaceId: string;
  token: string;
};

function pickEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

function resolveCloudflareCredentials(
  overrides: Partial<CloudflareCredentials> = {}
): CloudflareCredentials {
  const accountId =
    overrides.accountId ||
    pickEnv('CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID', 'ACCOUNT_ID');
  const token =
    overrides.token ||
    pickEnv('CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'API_TOKEN');
  const namespaceId =
    overrides.namespaceId ||
    process.env.CF_KV_POSTQ_NAMESPACE_ID ||
    process.env.CF_KV_NAMESPACE_ID;

  if (!accountId || !token || !namespaceId) {
    throw new Error(
      'Missing Cloudflare KV credentials (account id, namespace id, or API token).'
    );
  }

  return { accountId, namespaceId, token };
}

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
export interface PutConfigResult {
  key: string;
  accountId: string;
  namespaceId: string;
  size: number;
}

export async function putConfig(
  key: string,
  value: unknown,
  options: Partial<CloudflareCredentials> & { contentType?: string } = {}
): Promise<PutConfigResult> {
  const { accountId, namespaceId, token } = resolveCloudflareCredentials(options);
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(
    key
  )}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': options.contentType || 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(
      `Failed to write ${key} to KV: ${res.status}${text ? ` ${text}` : ''}`
    );
  }

  return { key, accountId, namespaceId, size: body.length };
}
export default saveToKV;
