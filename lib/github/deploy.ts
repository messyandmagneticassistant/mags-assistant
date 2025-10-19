import type { NextRequest } from 'next/server';

const TOKEN_KEYS = [
  'GITHUB_PAT',
  'GH_PAT',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_REDEPLOY_TOKEN',
  'DEPLOY_GITHUB_TOKEN',
];

const OWNER_KEYS = ['GITHUB_REPO_OWNER', 'DEPLOY_REPO_OWNER', 'MAGGIE_REPO_OWNER'];
const REPO_KEYS = ['GITHUB_REPO_NAME', 'DEPLOY_REPO_NAME', 'MAGGIE_REPO_NAME'];

export type GitHubRepo = { owner: string; repo: string };

type WorkflowRunsResponse = {
  workflow_runs?: Array<{
    id: number;
    name?: string | null;
    display_title?: string | null;
    status?: string | null;
    conclusion?: string | null;
    html_url?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    run_started_at?: string | null;
    run_attempt?: number | null;
    actor?: { login?: string | null } | null;
    head_commit?: {
      id?: string | null;
      message?: string | null;
      timestamp?: string | null;
      author?: { name?: string | null; email?: string | null } | null;
    } | null;
    rerun_url?: string | null;
  }>;
};

type GitHubResult<T> = {
  ok: boolean;
  status: number;
  data?: T | null;
  error?: string;
};

function coerceRepoTuple(value: string | undefined | null): GitHubRepo | null {
  if (!value) return null;
  const [owner, repo] = value.split('/');
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function resolveGitHubToken(): string | null {
  for (const key of TOKEN_KEYS) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function resolveRepoInfo(overrides?: { owner?: string | null; repo?: string | null }): GitHubRepo | null {
  if (overrides?.owner && overrides?.repo) {
    return { owner: overrides.owner, repo: overrides.repo };
  }

  const envRepoTuple = coerceRepoTuple(process.env.GITHUB_REPOSITORY);
  if (envRepoTuple && !overrides?.owner && !overrides?.repo) {
    return envRepoTuple;
  }

  let owner = overrides?.owner ?? null;
  let repo = overrides?.repo ?? null;

  for (const key of OWNER_KEYS) {
    if (owner) break;
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      owner = value.trim();
    }
  }

  for (const key of REPO_KEYS) {
    if (repo) break;
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      repo = value.trim();
    }
  }

  if (owner && repo) {
    return { owner, repo };
  }

  if (envRepoTuple) {
    return envRepoTuple;
  }

  return null;
}

function buildGithubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'maggie-assistant',
  } satisfies HeadersInit;
}

export async function fetchWorkflowRuns(options: {
  repo: GitHubRepo;
  token: string;
  workflow: string;
  perPage?: number;
}): Promise<GitHubResult<WorkflowRunsResponse>> {
  const { repo, token, workflow } = options;
  const perPage = options.perPage ?? 5;
  const url = new URL(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/workflows/${workflow}/runs`
  );
  url.searchParams.set('per_page', String(perPage));

  try {
    const response = await fetch(url.toString(), {
      headers: buildGithubHeaders(token),
    });
    const text = await response.text();
    let json: WorkflowRunsResponse | null = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (err) {
        return { ok: false, status: response.status, error: `Failed to parse GitHub response: ${err}` };
      }
    }

    if (!response.ok) {
      const errorMessage = json && 'message' in json ? String((json as any).message) : text;
      return { ok: false, status: response.status, error: errorMessage || 'GitHub request failed', data: json };
    }

    return { ok: true, status: response.status, data: json ?? { workflow_runs: [] } };
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function triggerWorkflowDispatch(options: {
  repo: GitHubRepo;
  token: string;
  workflow: string;
  ref?: string;
  inputs?: Record<string, unknown>;
}): Promise<GitHubResult<null>> {
  const { repo, token, workflow } = options;
  const ref = options.ref || 'main';
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/workflows/${workflow}/dispatches`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildGithubHeaders(token),
      body: JSON.stringify({ ref, inputs: options.inputs ?? {} }),
    });

    if (response.status === 204) {
      return { ok: true, status: response.status, data: null };
    }

    const text = await response.text();
    return {
      ok: false,
      status: response.status,
      error: text || `Unexpected GitHub response ${response.status}`,
    };
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function rerunWorkflowRun(options: {
  repo: GitHubRepo;
  token: string;
  runId: number;
}): Promise<GitHubResult<null>> {
  const { repo, token, runId } = options;
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/rerun`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildGithubHeaders(token),
    });

    if (response.status === 201) {
      return { ok: true, status: response.status, data: null };
    }

    const text = await response.text();
    return {
      ok: false,
      status: response.status,
      error: text || `Unexpected GitHub response ${response.status}`,
    };
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : String(err) };
  }
}

export function resolveRepoFromRequest(req: NextRequest): GitHubRepo | null {
  const owner = req.nextUrl.searchParams.get('owner');
  const repo = req.nextUrl.searchParams.get('repo');
  return resolveRepoInfo({ owner: owner ?? undefined, repo: repo ?? undefined });
}

export function summarizeRun(run: WorkflowRunsResponse['workflow_runs'][number]) {
  if (!run) return null;
  return {
    id: run.id,
    name: run.name || run.display_title || null,
    status: run.status || null,
    conclusion: run.conclusion || null,
    htmlUrl: run.html_url || null,
    createdAt: run.created_at || run.run_started_at || null,
    updatedAt: run.updated_at || null,
    attempt: run.run_attempt ?? null,
    actor: run.actor?.login || null,
    commit: run.head_commit
      ? {
          id: run.head_commit.id || null,
          message: run.head_commit.message || null,
          author: run.head_commit.author?.name || null,
          timestamp: run.head_commit.timestamp || null,
        }
      : null,
    rerunUrl: run.rerun_url || null,
  } as const;
}

export function pickLatestFailedRun(runs: WorkflowRunsResponse['workflow_runs'] | undefined) {
  if (!runs || !runs.length) return null;
  for (const run of runs) {
    if (run.conclusion && run.conclusion !== 'success' && run.status === 'completed') {
      return run;
    }
  }
  return runs[0];
}
