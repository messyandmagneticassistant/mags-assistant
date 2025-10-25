import type { Env } from './env';

const DEFAULT_REPO = 'messyandmagneticassistant/mags-assistant';
const DEFAULT_BRANCH_FALLBACKS = ['chore/nightly-brain-sync', 'main'];
const CANONICAL_REPO_BRAIN_PATH = 'brain/brain.json';
const DEFAULT_BRAIN_DOC_PATH = CANONICAL_REPO_BRAIN_PATH;

function pickToken(env: Env & Record<string, any>): string | undefined {
  const token =
    (typeof env.GITHUB_PAT === 'string' && env.GITHUB_PAT.trim()) ||
    (typeof env.GITHUB_TOKEN === 'string' && env.GITHUB_TOKEN.trim());
  return token && token.length > 0 ? token : undefined;
}

function buildFetchHeaders(env: Env & Record<string, any>): HeadersInit {
  const headers: Record<string, string> = {
    'User-Agent': 'maggie-worker-thread-state-sync',
    Accept: 'application/vnd.github.raw+json',
  };
  const token = pickToken(env);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchFileFromGitHub(
  env: Env & Record<string, any>,
  repo: string,
  branch: string,
  path: string
): Promise<{ branch: string; payload: string } | null> {
  const base = `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
  const res = await fetch(base, { headers: buildFetchHeaders(env) });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`GitHub fetch failed (${res.status}) for ${branch}`);
  }
  const payload = await res.text();
  return { branch, payload };
}

function uniqueBranches(primary?: string | null): string[] {
  const fromEnv = primary && primary.trim().length ? [primary.trim()] : [];
  const fallback = DEFAULT_BRANCH_FALLBACKS.filter(
    (b) => !fromEnv.includes(b)
  );
  return [...fromEnv, ...fallback];
}

function determineRepo(env: Env & Record<string, any>): string {
  const fromEnv =
    (typeof env.THREAD_STATE_REPO === 'string' && env.THREAD_STATE_REPO.trim()) ||
    (typeof env.GITHUB_REPOSITORY === 'string' && env.GITHUB_REPOSITORY.trim());
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_REPO;
}

function determineBranchPreference(env: Env & Record<string, any>): string | null {
  const keys = [
    'THREAD_STATE_BRANCH',
    'BRAIN_SYNC_BRANCH',
    'THREAD_STATE_REF',
    'GITHUB_REF_NAME',
  ];
  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length) return value.trim();
  }
  return null;
}

function determinePath(env: Env & Record<string, any>): string {
  const value = env.THREAD_STATE_PATH;
  return typeof value === 'string' && value.trim().length
    ? value.trim()
    : CANONICAL_REPO_BRAIN_PATH;
}

function determineBrainDocPath(env: Env & Record<string, any>): string {
  const value = env.BRAIN_DOC_GITHUB_PATH;
  return typeof value === 'string' && value.trim().length
    ? value.trim()
    : DEFAULT_BRAIN_DOC_PATH;
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('[thread-state-sync] Failed to parse JSON:', err);
    return null;
  }
}

export async function syncThreadStateFromGitHub(env: Env & Record<string, any>) {
  if (!env?.BRAIN || typeof env.BRAIN.put !== 'function') {
    console.warn('[thread-state-sync] BRAIN KV binding missing, skipping.');
    return;
  }

  const repo = determineRepo(env);
  const branchPreference = determineBranchPreference(env);
  const path = determinePath(env);
  const branches = uniqueBranches(branchPreference);

  let fetched: { branch: string; payload: string } | null = null;
  for (const branch of branches) {
    try {
      const result = await fetchFileFromGitHub(env, repo, branch, path);
      if (result) {
        fetched = result;
        break;
      }
    } catch (err) {
      console.error('[thread-state-sync] Fetch attempt failed:', branch, err);
    }
  }

  if (!fetched) {
    console.error(
      '[thread-state-sync] Unable to fetch thread-state from GitHub for branches:',
      branches
    );
    return;
  }

  const parsed = safeJsonParse(fetched.payload);
  if (!parsed) {
    console.error('[thread-state-sync] Thread-state payload was not valid JSON.');
    return;
  }

  const syncedAt = new Date().toISOString();
  const enriched = {
    ...parsed,
    lastSynced: syncedAt,
    syncedFromBranch: fetched.branch,
  };

  const secretKey =
    (typeof env.SECRET_BLOB === 'string' && env.SECRET_BLOB.length
      ? env.SECRET_BLOB
      : 'thread-state');

  await env.BRAIN.put(secretKey, JSON.stringify(enriched));
  console.log(
    `[thread-state-sync] Updated ${secretKey} from GitHub (${repo}@${fetched.branch}) at ${syncedAt}`
  );
}

export async function syncBrainDocFromGitHub(env: Env & Record<string, any>) {
  if (!env?.BRAIN || typeof env.BRAIN.put !== 'function') {
    console.warn('[brain-doc-sync] BRAIN KV binding missing, skipping.');
    return;
  }

  const repo = determineRepo(env);
  const branchPreference = determineBranchPreference(env);
  const path = determineBrainDocPath(env);
  const branches = uniqueBranches(branchPreference);

  let fetched: { branch: string; payload: string } | null = null;
  for (const branch of branches) {
    try {
      const result = await fetchFileFromGitHub(env, repo, branch, path);
      if (result) {
        fetched = result;
        break;
      }
    } catch (err) {
      console.error('[brain-doc-sync] Fetch attempt failed:', branch, err);
    }
  }

  if (!fetched) {
    console.error(
      '[brain-doc-sync] Unable to fetch brain doc from GitHub for branches:',
      branches
    );
    return;
  }

  const parsed = safeJsonParse(fetched.payload);
  if (!parsed) {
    console.error('[brain-doc-sync] Brain doc payload was not valid JSON.');
    return;
  }

  const syncedAt = new Date().toISOString();
  const enriched = {
    ...parsed,
    lastSynced: syncedAt,
    syncedFromBranch: fetched.branch,
    syncedFromPath: path,
  };

  const brainDocKey = env.BRAIN_DOC_KEY || 'PostQ:thread-state';

  await env.BRAIN.put(brainDocKey, JSON.stringify(enriched));
  console.log(
    `[brain-doc-sync] Updated ${brainDocKey} from GitHub (${repo}@${fetched.branch}) at ${syncedAt}`
  );
}
