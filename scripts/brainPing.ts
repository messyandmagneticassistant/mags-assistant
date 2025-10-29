import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { CANONICAL_BRAIN_KV_KEY, CANONICAL_BRAIN_REPO_PATH } from '../config/env';

type BrainState = {
  lastUpdated?: string;
  lastSynced?: string | null;
  [key: string]: unknown;
};

export type BrainDriftReport = {
  ok: true;
  matches: boolean;
  checkedAt: string;
  remoteBytes: number;
  localBytes: number;
  canonicalPath: string;
  canonicalKvKey: string;
  localLastUpdated: string | null;
  remoteLastUpdated: string | null;
  remoteLastSynced: string | null;
  lastUpdatedSkewMinutes: number | null;
};

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type DriftOptions = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchImpl;
  canonicalPath?: string;
};

function safeParse(json: string): BrainState | null {
  try {
    return JSON.parse(json) as BrainState;
  } catch (err) {
    console.warn('[brainPing] Unable to parse payload as JSON:', err);
    return null;
  }
}

function diffMinutes(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const aTs = Date.parse(a);
  const bTs = Date.parse(b);
  if (Number.isNaN(aTs) || Number.isNaN(bTs)) return null;
  return Math.round((aTs - bTs) / 60000);
}

async function readLocalState(canonicalPath: string): Promise<{
  raw: string;
  data: BrainState | null;
  filePath: string;
}> {
  const filePath = path.resolve(canonicalPath);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return { raw, data: safeParse(raw), filePath };
  } catch (err) {
    console.error(`[brainPing] Failed to read ${filePath}:`, err);
    return { raw: '', data: null, filePath };
  }
}

function resolveEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env) return env;
  return typeof process !== 'undefined' ? process.env : ({} as NodeJS.ProcessEnv);
}

function resolveFetch(fetchImpl?: FetchImpl): FetchImpl {
  if (fetchImpl) return fetchImpl;
  if (typeof fetch === 'function') return fetch.bind(globalThis);
  throw new Error('Global fetch implementation unavailable. Provide fetchImpl to checkBrainDrift.');
}

export async function checkBrainDrift(options: DriftOptions = {}): Promise<BrainDriftReport> {
  const env = resolveEnv(options.env);
  const fetcher = resolveFetch(options.fetchImpl);

  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const token =
    env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_TOKEN || env.CF_API_TOKEN || env.API_TOKEN;
  const namespaceId = env.CF_KV_POSTQ_NAMESPACE_ID || env.CF_KV_NAMESPACE_ID;

  if (!account || !token || !namespaceId) {
    throw new Error(
      'Missing Cloudflare credentials. Ensure CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (or CLOUDFLARE_TOKEN), and CF_KV_NAMESPACE_ID are set.'
    );
  }

  const canonicalPath = options.canonicalPath ?? CANONICAL_BRAIN_REPO_PATH;
  const { raw: localRaw, data: localState, filePath } = await readLocalState(canonicalPath);

  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(
    CANONICAL_BRAIN_KV_KEY
  )}`;
  const res = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch brain (${res.status}): ${text}`);
  }

  const remoteRaw = await res.text();
  const remoteState = safeParse(remoteRaw);

  const matches = remoteState && localState
    ? JSON.stringify(remoteState) === JSON.stringify(localState)
    : remoteRaw.trim() === localRaw.trim();

  const localUpdated = localState?.lastUpdated || null;
  const remoteUpdated = remoteState?.lastUpdated || null;
  const skewMinutes = diffMinutes(remoteUpdated ?? undefined, localUpdated ?? undefined);

  return {
    ok: true,
    matches,
    checkedAt: new Date().toISOString(),
    remoteBytes: remoteRaw.length,
    localBytes: localRaw.length,
    canonicalPath: filePath,
    canonicalKvKey: CANONICAL_BRAIN_KV_KEY,
    localLastUpdated: localUpdated,
    remoteLastUpdated: remoteUpdated,
    remoteLastSynced: remoteState?.lastSynced ?? null,
    lastUpdatedSkewMinutes: skewMinutes,
  };
}

async function runCli() {
  try {
    const result = await checkBrainDrift();
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

const isDirectExecution = (() => {
  if (typeof process === 'undefined' || typeof process.argv === 'undefined') return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(entry);
  } catch (err) {
    return false;
  }
})();

if (isDirectExecution) {
  runCli();
}
