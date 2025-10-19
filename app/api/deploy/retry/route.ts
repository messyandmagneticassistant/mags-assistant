import { NextRequest } from 'next/server';
import {
  fetchWorkflowRuns,
  pickLatestFailedRun,
  resolveGitHubToken,
  resolveRepoInfo,
  rerunWorkflowRun,
  summarizeRun,
  triggerWorkflowDispatch,
} from '../../../../lib/github/deploy';

export const runtime = 'nodejs';

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, init);
}

async function resolveLatestRun(options: { repo: { owner: string; repo: string }; token: string; workflow: string }) {
  const runs = await fetchWorkflowRuns({ ...options, perPage: 10 });
  if (!runs.ok) {
    return { ok: false as const, error: runs.error ?? 'Failed to load workflow runs', status: runs.status };
  }
  const latest = pickLatestFailedRun(runs.data?.workflow_runs);
  if (!latest) {
    return { ok: false as const, error: 'No workflow runs found to retry', status: 404 };
  }
  return { ok: true as const, run: latest, summary: summarizeRun(latest) };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const workflow = typeof body.workflow === 'string' && body.workflow.trim() ? body.workflow.trim() : 'deploy.yml';
  const repo = resolveRepoInfo({
    owner: typeof body.owner === 'string' ? body.owner : null,
    repo: typeof body.repo === 'string' ? body.repo : null,
  });

  if (!repo) {
    return json({ ok: false, error: 'Unable to resolve GitHub repository' }, { status: 500 });
  }

  const token = resolveGitHubToken();
  if (!token) {
    return json({ ok: false, error: 'Missing GitHub token (set GITHUB_PAT or GITHUB_TOKEN)' }, { status: 500 });
  }

  const action = typeof body.action === 'string' ? body.action : 'auto';
  const ref = typeof body.ref === 'string' ? body.ref : 'main';
  const reason = typeof body.reason === 'string' ? body.reason : 'Deploy retry requested via API';

  if (action === 'dispatch') {
    const dispatch = await triggerWorkflowDispatch({ repo, token, workflow, ref, inputs: { reason } });
    if (!dispatch.ok) {
      return json({ ok: false, error: dispatch.error ?? 'Failed to dispatch workflow', status: dispatch.status }, {
        status: dispatch.status || 500,
      });
    }
    return json({ ok: true, mode: 'dispatch', workflow, repo, ref });
  }

  const runId = typeof body.runId === 'number' ? body.runId : null;

  let targetRunId = runId;
  let targetSummary = null as ReturnType<typeof summarizeRun> | null;

  if (!targetRunId) {
    const resolved = await resolveLatestRun({ repo, token, workflow });
    if (!resolved.ok) {
      if (resolved.status === 404 && action === 'dispatch-or-rerun') {
        const dispatch = await triggerWorkflowDispatch({ repo, token, workflow, ref, inputs: { reason } });
        if (dispatch.ok) {
          return json({ ok: true, mode: 'dispatch', workflow, repo, ref });
        }
        return json(
          { ok: false, error: dispatch.error ?? resolved.error ?? 'Failed to trigger workflow', status: dispatch.status },
          { status: dispatch.status || 500 }
        );
      }
      return json({ ok: false, error: resolved.error, status: resolved.status }, { status: resolved.status || 500 });
    }
    targetRunId = resolved.run.id;
    targetSummary = resolved.summary;
  }

  const rerun = await rerunWorkflowRun({ repo, token, runId: targetRunId });
  if (!rerun.ok) {
    return json({ ok: false, error: rerun.error ?? 'Failed to rerun workflow', status: rerun.status }, {
      status: rerun.status || 500,
    });
  }

  return json({ ok: true, mode: 'rerun', workflow, repo, runId: targetRunId, run: targetSummary });
}

export async function GET() {
  return json({ ok: false, error: 'Use POST with action dispatch|rerun' }, { status: 405 });
}
