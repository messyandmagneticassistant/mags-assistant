const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

async function appendJobs(env: any, jobs: any[]) {
  const queue = (await env.POSTQ.get('tiktok:queue', 'json')) || [];
  for (const j of jobs) queue.push(j);
  await env.POSTQ.put('tiktok:queue', JSON.stringify(queue));
  return queue.length;
}

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  const { pathname } = new URL(request.url);

  if (pathname === '/planner/run') {
    const body = await request.json().catch(() => ({}));
    const mod = await import('../../src/planner');
    const plan = await (mod as any).runPlanner(env, body);
    return json({ ok: true, plan });
  }

  if (pathname === '/compose') {
    const body = await request.json().catch(() => ({}));
    const caption = body.text || '...';
    return json({ ok: true, caption, audioHint: null, when: null, planStep: null });
  }

  if (pathname === '/schedule') {
    const body = await request.json().catch(() => ({}));
    const jobs = Array.isArray(body.jobs) ? body.jobs : [];
    const size = await appendJobs(env, jobs);
    return json({ ok: true, queued: jobs.length, queueSize: size });
  }

  return new Response('Not Found', { status: 404, headers: CORS });
}

export async function onRequestGet({ request, env }: { request: Request; env: any }) {
  const { pathname } = new URL(request.url);

  if (pathname === '/planner/today') {
    const mod = await import('../../src/planner');
    const plan = await (mod as any).getTodayPlan(env);
    return json({ ok: true, plan });
  }

  return new Response('Not Found', { status: 404, headers: CORS });
}

export async function onScheduled(_event: ScheduledEvent, env: any) {
  // refresh trends if stale
  try {
    const ts = await env.POSTQ.get('tiktok:trends:ts');
    if (!ts || Date.now() - Number(ts) > 60 * 60 * 1000) {
      const mod = await import('../../src/trends');
      if (typeof (mod as any).refreshTrends === 'function') await (mod as any).refreshTrends(env);
    }
  } catch {}
}
