import { NextRequest } from 'next/server';
import {
  fetchWorkflowRuns,
  pickLatestFailedRun,
  resolveGitHubToken,
  resolveRepoFromRequest,
  resolveRepoInfo,
  summarizeRun,
} from '../../../../lib/github/deploy';
import { getConfigDiagnostics } from '../../../../src/utils/getConfig';

export const runtime = 'nodejs';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return Response.json(body, init);
}

export async function GET(req: NextRequest) {
  const workflow = req.nextUrl.searchParams.get('workflow') ?? 'deploy.yml';
  const perPage = Number(req.nextUrl.searchParams.get('per_page') || '5');
  const repo = resolveRepoFromRequest(req) ?? resolveRepoInfo();
  if (!repo) {
    return jsonResponse({ ok: false, error: 'Unable to resolve GitHub repository' }, { status: 500 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return jsonResponse(
      {
        ok: false,
        error: 'Missing GitHub token (set GITHUB_PAT or GITHUB_TOKEN)',
      },
      { status: 500 }
    );
  }

  const runs = await fetchWorkflowRuns({ repo, token, workflow, perPage: Number.isFinite(perPage) ? perPage : 5 });
  if (!runs.ok) {
    return jsonResponse({ ok: false, error: runs.error ?? 'Failed to load workflow runs', status: runs.status }, {
      status: runs.status || 500,
    });
  }

  const summaries = (runs.data?.workflow_runs ?? []).map((run) => summarizeRun(run)).filter(Boolean);
  const latestFailed = pickLatestFailedRun(runs.data?.workflow_runs);
  const latestSummary = latestFailed ? summarizeRun(latestFailed) : null;
  const diagnostics = getConfigDiagnostics();

  return jsonResponse({
    ok: true,
    repo,
    workflow,
    latestFailed: latestSummary,
    runs: summaries,
    config: diagnostics,
  });
}
