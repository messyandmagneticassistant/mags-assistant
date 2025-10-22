type GetConfigFn = ((scope: string) => Promise<any>) | undefined;

let resolvedGetConfig: GetConfigFn | null = null;

function normalizeString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

async function loadGetConfig(): Promise<GetConfigFn> {
  if (resolvedGetConfig !== null) {
    return resolvedGetConfig ?? undefined;
  }

  const candidates = ['../utils/config.js', '../utils/config.ts'];
  for (const candidate of candidates) {
    try {
      const mod = await import(candidate);
      if (typeof mod.getConfig === 'function') {
        const fn = mod.getConfig as (scope: string) => Promise<any>;
        resolvedGetConfig = fn;
        return fn;
      }
    } catch {
      // Ignore resolution errors and continue to the next candidate.
    }
  }

  resolvedGetConfig = undefined;
  return undefined;
}

interface ResolveOptions {
  accountId?: string;
  apiToken?: string;
  namespaceId?: string;
}

async function resolveCredentials(
  options: ResolveOptions = {}
): Promise<{ accountId: string; apiToken: string; namespaceId: string }> {
  let accountId =
    options.accountId ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.CF_ACCOUNT_ID ||
    process.env.ACCOUNT_ID;
  let apiToken =
    options.apiToken ||
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CLOUDFLARE_TOKEN ||
    process.env.CF_API_TOKEN ||
    process.env.API_TOKEN;
  let namespaceId =
    options.namespaceId ||
    process.env.CF_KV_POSTQ_NAMESPACE_ID ||
    process.env.CF_KV_NAMESPACE_ID;

  if (!accountId || !apiToken || !namespaceId) {
    try {
      const getConfig = await loadGetConfig();
      if (getConfig) {
        const cloudflareConfig = ((await getConfig('cloudflare')) ?? {}) as Record<
          string,
          unknown
        >;
        accountId ||=
          normalizeString(cloudflareConfig.accountId) ||
          normalizeString(cloudflareConfig.cloudflareAccountId) ||
          normalizeString(cloudflareConfig.accountID);
        apiToken ||=
          normalizeString(cloudflareConfig.apiToken) ||
          normalizeString(cloudflareConfig.cloudflareApiToken) ||
          normalizeString(cloudflareConfig.apiKey) ||
          normalizeString(cloudflareConfig.token) ||
          normalizeString(cloudflareConfig.cloudflareToken) ||
          normalizeString(cloudflareConfig.workerToken) ||
          normalizeString(cloudflareConfig.postqToken) ||
          normalizeString(cloudflareConfig.kvToken);
        namespaceId ||=
          normalizeString(cloudflareConfig.namespaceId) ||
          normalizeString(cloudflareConfig.kvNamespaceId) ||
          normalizeString(cloudflareConfig.cloudflareKvNamespaceId) ||
          normalizeString(cloudflareConfig.namespaceID);

        if (!namespaceId) {
          const kv = cloudflareConfig.kv as Record<string, unknown> | undefined;
          if (kv) {
            namespaceId =
              normalizeString(kv.namespaceId) ||
              normalizeString(kv.id) ||
              normalizeString(kv.namespaceID) ||
              namespaceId;
          }
        }
      }
    } catch (err) {
      console.warn('Failed to resolve Cloudflare credentials via getConfig', err);
    }
  }

  accountId = normalizeString(accountId);
  apiToken = normalizeString(apiToken);
  namespaceId = normalizeString(namespaceId);

  if (!accountId || !apiToken || !namespaceId) {
    throw new Error(
      'Cloudflare credentials required (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CF_KV_POSTQ_NAMESPACE_ID)'
    );
  }

  return { accountId, apiToken, namespaceId } as const;
}

export interface PutConfigOptions extends ResolveOptions {
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
  const { accountId, apiToken, namespaceId } = await resolveCredentials(options);
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

export interface GetConfigOptions extends ResolveOptions {
  type?: 'text' | 'json';
}

export async function getConfigValue<T = unknown>(
  key: string,
  options: GetConfigOptions = {}
): Promise<T | string> {
  const { accountId, apiToken, namespaceId } = await resolveCredentials(options);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(
    key
  )}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Failed to fetch config for ${key}: ${res.status}${text ? ` ${text}` : ''}`
    );
  }

  const text = await res.text();
  if (options.type === 'json') {
    return text ? (JSON.parse(text) as T) : ({} as T);
  }
  return text;
}
export default saveToKV;
