import { resolveKvCredentials, type ResolveOptions } from '../kv';

export interface KvUsageSummary {
  writes: number;
  reads: number;
  deletes: number;
  periodStart?: string;
  periodEnd?: string;
  windowSeconds?: number;
  raw?: unknown;
}

export interface KvUsageOptions extends ResolveOptions {
  /**
   * Relative window (in seconds) to query. Cloudflare accepts negative offsets such as "-3600".
   * Defaults to the last 24 hours (86,400 seconds) when omitted.
   */
  sinceSeconds?: number;
  /**
   * Optional absolute ISO8601 timestamp for the start of the window.
   */
  since?: string;
  /**
   * Optional absolute ISO8601 timestamp for the end of the window.
   */
  until?: string;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export const DEFAULT_KV_DAILY_LIMIT = 1000;

const ANALYTICS_ENDPOINTS = [
  (accountId: string, namespaceId: string) =>
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/analytics/kv/namespaces/${namespaceId}/summaries`,
  (accountId: string, namespaceId: string) =>
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/analytics/kv/namespaces/${namespaceId}`,
  (accountId: string, namespaceId: string) =>
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/analytics`,
];

function coerceNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function entriesFromObject(value: unknown): any[] {
  if (!value || typeof value !== 'object') return [];
  const entries: any[] = [];
  for (const [operation, record] of Object.entries(value as Record<string, unknown>)) {
    if (record && typeof record === 'object') {
      entries.push({
        operation,
        ...record,
      });
    } else {
      entries.push({ operation, count: record });
    }
  }
  return entries;
}

function extractEntries(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.result)) return payload.result;
  if (payload?.result?.operations) {
    return entriesFromObject(payload.result.operations);
  }
  if (payload?.result?.totals) {
    return entriesFromObject(payload.result.totals);
  }
  if (payload?.result && typeof payload.result === 'object') {
    return entriesFromObject(payload.result);
  }
  if (payload?.operations) {
    return entriesFromObject(payload.operations);
  }
  return [];
}

function accumulateUsage(target: KvUsageSummary, entry: any): void {
  if (!entry) return;
  const op = String(entry.operation ?? entry.command ?? entry.metric ?? entry.type ?? '').toLowerCase();
  const total =
    coerceNumber(entry.total) ||
    coerceNumber(entry.count) ||
    coerceNumber(entry.calls) ||
    coerceNumber(entry.requests) ||
    coerceNumber(entry.value);

  if (!total) return;

  if (op.includes('write')) {
    target.writes += total;
  } else if (op.includes('delete')) {
    target.deletes += total;
  } else if (op.includes('read') || op.includes('get') || op.includes('list')) {
    target.reads += total;
  }
}

function extractWindow(payload: any): { since?: string; until?: string } {
  const query = payload?.result?.query ?? payload?.query ?? payload?.meta;
  if (!query || typeof query !== 'object') return {};
  const since = typeof query.since === 'string' ? query.since : undefined;
  const until = typeof query.until === 'string' ? query.until : undefined;
  return { since, until };
}

async function fetchAnalytics(
  accountId: string,
  namespaceId: string,
  apiToken: string,
  url: string,
  params: URLSearchParams,
  signal?: AbortSignal
): Promise<any> {
  const query = params.toString();
  const resolvedUrl = query ? `${url}?${query}` : url;
  const res = await fetch(resolvedUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Analytics request failed (${res.status}) ${text}`);
  }
  return res.json();
}

export async function fetchKvUsageSummary(options: KvUsageOptions = {}): Promise<KvUsageSummary> {
  const { accountId, apiToken, namespaceId } = await resolveKvCredentials(options);

  const params = new URLSearchParams();
  if (options.sinceSeconds !== undefined && Number.isFinite(options.sinceSeconds)) {
    const seconds = Number(options.sinceSeconds);
    const value = seconds > 0 ? `-${Math.floor(seconds)}` : `${Math.floor(seconds)}`;
    params.set('since', value);
  }
  if (options.since) params.set('since', options.since);
  if (options.until) params.set('until', options.until);

  if (!params.has('since')) {
    params.set('since', '-86400');
  }

  const attempts: Error[] = [];
  for (const builder of ANALYTICS_ENDPOINTS) {
    const endpoint = builder(accountId, namespaceId);
    try {
      const payload = await fetchAnalytics(accountId, namespaceId, apiToken, endpoint, params, options.signal);
      const usage: KvUsageSummary = {
        writes: 0,
        reads: 0,
        deletes: 0,
        raw: payload,
      };

      const entries = extractEntries(payload);
      for (const entry of entries) {
        accumulateUsage(usage, entry);
      }

      const window = extractWindow(payload);
      if (window.since) usage.periodStart = window.since;
      if (window.until) usage.periodEnd = window.until;

      const sinceParam = params.get('since');
      if (sinceParam && sinceParam.startsWith('-')) {
        const seconds = Number.parseInt(sinceParam.slice(1), 10);
        if (Number.isFinite(seconds)) usage.windowSeconds = seconds;
      }

      if (usage.writes || usage.reads || usage.deletes || payload) {
        return usage;
      }
    } catch (error) {
      if (error instanceof Error) {
        attempts.push(error);
      } else {
        attempts.push(new Error(String(error)));
      }
    }
  }

  const message = attempts.length
    ? attempts.map((err) => err.message).join('; ')
    : 'Unable to fetch Cloudflare KV analytics';
  const error = new Error(message);
  (error as any).attempts = attempts;
  throw error;
}

export function estimateKvWritesRemaining(usage: KvUsageSummary, limit = DEFAULT_KV_DAILY_LIMIT): number {
  const remaining = limit - usage.writes;
  return remaining > 0 ? remaining : 0;
}

