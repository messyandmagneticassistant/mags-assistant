type GetConfigFn = ((scope: string) => Promise<any>) | undefined;

let resolvedGetConfig: GetConfigFn | null = null;

async function loadGetConfig(): Promise<GetConfigFn> {
  if (resolvedGetConfig !== null) {
    return resolvedGetConfig;
  }

  const candidates = ['../utils/config.js', '../utils/config.ts'];
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      if (typeof mod.getConfig === 'function') {
        resolvedGetConfig = mod.getConfig;
        return resolvedGetConfig;
      }
    } catch {
      // Ignore resolution errors and continue to the next candidate.
    }
  }

  resolvedGetConfig = undefined;
  return resolvedGetConfig;
}

export interface PutConfigOptions {
  accountId?: string;
  apiToken?: string;
  namespaceId?: string;
  contentType?: string;
}

export async function saveToKV(key: string, value: any) {
  let base = process.env.WORKER_URL;
  let auth = process.env.WORKER_KEY;

  // Fallback to config lookup if env vars missing
  if (!base || !auth) {
    try {
      const getConfig = await loadGetConfig();
      if (getConfig) {
        const cfg = await getConfig('cloudflare');
        base ||= cfg.worker_url || cfg.workerUrl;
        auth ||= cfg.worker_key || cfg.workerKey;
      }
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

export async function putConfig(
  key: string,
  value: unknown,
  options: PutConfigOptions = {}
) {
  const accountId =
    options.accountId ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.CF_ACCOUNT_ID ||
    process.env.ACCOUNT_ID;
  const apiToken =
    options.apiToken ||
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CF_API_TOKEN ||
    process.env.API_TOKEN;
  const namespaceId =
    options.namespaceId ||
    process.env.CF_KV_POSTQ_NAMESPACE_ID ||
    process.env.CF_KV_NAMESPACE_ID;

  if (!accountId || !apiToken || !namespaceId) {
    throw new Error(
      'putConfig requires Cloudflare credentials (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CF_KV_POSTQ_NAMESPACE_ID)'
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(
    key
  )}`;
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const contentType = options.contentType || 'application/json';
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': contentType,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to put config for ${key}: ${res.status}${text ? ` ${text}` : ''}`
    );
  }

  return { ok: true } as const;
}
export default saveToKV;
