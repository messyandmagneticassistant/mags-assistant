const DEFAULT_REPO = 'messyandmagneticassistant/mags-assistant';
const DEFAULT_BRANCH_FALLBACKS = ['chore/nightly-brain-sync', 'main'];
const DEFAULT_PATH = 'brain/brain.md';

type AnyEnv = Record<string, unknown> & {
  GITHUB_PAT?: string;
  GITHUB_TOKEN?: string;
  THREAD_STATE_REPO?: string;
  GITHUB_REPOSITORY?: string;
  THREAD_STATE_BRANCH?: string;
  BRAIN_SYNC_BRANCH?: string;
  THREAD_STATE_REF?: string;
  GITHUB_REF_NAME?: string;
  BRAIN_DOC_GITHUB_PATH?: string;
  THREAD_STATE_PATH?: string;
};

function pickToken(env: AnyEnv): string | undefined {
  const candidates = [env.GITHUB_PAT, env.GITHUB_TOKEN];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}

function buildHeaders(env: AnyEnv): HeadersInit {
  const headers: Record<string, string> = {
    'User-Agent': 'maggie-worker-brain-sync',
    Accept: 'application/vnd.github.raw',
  };
  const token = pickToken(env);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function determineRepo(env: AnyEnv, override?: string): string {
  if (override && override.trim().length > 0) return override.trim();
  const fromEnv =
    (typeof env.THREAD_STATE_REPO === 'string' && env.THREAD_STATE_REPO.trim()) ||
    (typeof env.GITHUB_REPOSITORY === 'string' && env.GITHUB_REPOSITORY.trim());
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_REPO;
}

function determineBranchPreference(env: AnyEnv, override?: string | null): string | null {
  if (typeof override === 'string' && override.trim().length > 0) {
    return override.trim();
  }
  const keys = ['THREAD_STATE_BRANCH', 'BRAIN_SYNC_BRANCH', 'THREAD_STATE_REF', 'GITHUB_REF_NAME'];
  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function determinePath(env: AnyEnv, override?: string): string {
  if (override && override.trim().length > 0) return override.trim();
  const value = env.BRAIN_DOC_GITHUB_PATH || env.THREAD_STATE_PATH;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return DEFAULT_PATH;
}

function uniqueBranches(primary?: string | null, overrides?: string[]): string[] {
  const fromEnv = primary && primary.trim().length > 0 ? [primary.trim()] : [];
  const fromOverrides = Array.isArray(overrides)
    ? overrides.filter((branch) => typeof branch === 'string' && branch.trim().length > 0)
    : [];
  const fallback = DEFAULT_BRANCH_FALLBACKS.filter(
    (branch) => !fromEnv.includes(branch) && !fromOverrides.includes(branch)
  );
  return [...fromEnv, ...fromOverrides, ...fallback];
}

async function fetchBrainFromGitHub(
  env: AnyEnv,
  repo: string,
  branch: string,
  path: string
): Promise<string | null> {
  const base = `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
  try {
    const res = await fetch(base, { headers: buildHeaders(env) });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`GitHub responded with ${res.status}`);
    }
    return await res.text();
  } catch (err) {
    console.error('[getBrain] GitHub fetch failed', { repo, branch, path, err });
    return null;
  }
}

export interface GetBrainOptions {
  repo?: string;
  branches?: string[];
  branch?: string | null;
  path?: string;
}

function resolveEnv(env?: AnyEnv): AnyEnv {
  if (env) return env;
  if (typeof process !== 'undefined' && process?.env) {
    return process.env as AnyEnv;
  }
  return {};
}

export async function getBrain(
  env?: AnyEnv,
  options: GetBrainOptions = {}
): Promise<string> {
  const resolvedEnv = resolveEnv(env);
  const repo = determineRepo(resolvedEnv, options.repo);
  const preferredBranch = determineBranchPreference(resolvedEnv, options.branch ?? null);
  const path = determinePath(resolvedEnv, options.path);
  const branches = uniqueBranches(preferredBranch, options.branches);

  for (const branch of branches) {
    const payload = await fetchBrainFromGitHub(resolvedEnv, repo, branch, path);
    if (typeof payload === 'string' && payload.length > 0) {
      console.log('[getBrain] Loaded brain.md from GitHub', {
        repo,
        branch,
        path,
        bytes: payload.length,
      });
      return payload;
    }
  }

  console.error('[getBrain] Unable to load brain.md from GitHub', { repo, path, branches });
  return '';
}

export default getBrain;
