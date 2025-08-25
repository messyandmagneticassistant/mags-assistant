export async function requestRedeploy(reason: string) {
  const r = await fetch('/api/redeploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner: process.env.NEXT_PUBLIC_GITHUB_OWNER,
      repo: process.env.NEXT_PUBLIC_GITHUB_REPO,
      workflow_file: 'vercel-redeploy.yml',
      ref: 'main',
      reason,
    }),
  });
  return r.json();
}
