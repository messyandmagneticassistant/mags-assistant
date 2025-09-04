const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

const ROUTES = [
  '/health',
  '/diag/config',
  '/api/browser/session',
  '/admin/status',
  '/admin/trigger',
  '/tiktok/accounts',
  '/tiktok/cookies',
  '/tiktok/check',
  '/tiktok/post',
  '/tiktok/eng/rules',
  '/tiktok/eng/persona',
  '/tiktok/eng/orchestrate',
  '/tiktok/eng/plan',
  '/planner/run',
  '/planner/today',
  '/compose',
  '/schedule',
];

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }: { request: Request; env: any }) {
  const { pathname } = new URL(request.url);
  if (pathname === '/admin/status') {
    let kvKeysSample: string[] = [];
    try {
      const list = await env.POSTQ.list({ limit: 10 });
      kvKeysSample = list.keys.map((k: any) => k.name);
    } catch {}

    let trendsAgeMinutes: number | null = null;
    try {
      const ts = await env.POSTQ.get('tiktok:trends:ts');
      if (ts) trendsAgeMinutes = Math.floor((Date.now() - Number(ts)) / 60000);
    } catch {}

    let queueSize = 0;
    try {
      const q = await env.POSTQ.get('tiktok:queue', 'json');
      if (Array.isArray(q)) queueSize = q.length;
    } catch {}

    let accountsCount = 0;
    try {
      const accounts = await env.POSTQ.get('tiktok:accounts', 'json');
      if (accounts) accountsCount = Object.keys(accounts).length;
    } catch {}

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const cronConfigured = !!env.WORKER_CRON_KEY || !!env.CRON_SECRET;

    return json({
      ok: true,
      now: new Date().toISOString(),
      timezone,
      routesCount: ROUTES.length,
      kvKeysSample,
      trendsAgeMinutes,
      queueSize,
      accountsCount,
      cronConfigured,
    });
  }

  if (pathname === '/admin/config') {
    const keys = ['blueprint:cohorts', 'blueprint:products', 'blueprint:tally'];
    const out: any = {};
    for (const k of keys) {
      try {
        out[k] = await env.BRAIN.get(k, 'json');
      } catch {}
    }
    return json(out);
  }

  return new Response('Not Found', { status: 404, headers: CORS });
}

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  const { pathname } = new URL(request.url);
  if (pathname === '/admin/trigger') {
    const body = await request.json().catch(() => ({}));
    switch (body.kind) {
      case 'plan': {
        const mod = await import('../../src/planner');
        if (typeof (mod as any).runPlanner === 'function') await (mod as any).runPlanner(env, {});
        break;
      }
      case 'trends': {
        const mod = await import('../../src/trends');
        if (typeof (mod as any).refreshTrends === 'function') await (mod as any).refreshTrends(env);
        break;
      }
      case 'tick': {
        const mod = await import('./tiktok');
        if (typeof (mod as any).runNextJob === 'function') await (mod as any).runNextJob(env);
        break;
      }
      default:
        return json({ ok: false, error: 'unknown kind' }, 400);
    }
    return json({ ok: true });
  }

  if (pathname === '/admin/config') {
    const auth = request.headers.get('Authorization')?.replace('Bearer ', '') || '';
    if (env.POST_THREAD_SECRET && auth !== env.POST_THREAD_SECRET) {
      return new Response('forbidden', { status: 403, headers: CORS });
    }
    const body = await request.json().catch(() => ({}));
    for (const [k, v] of Object.entries(body)) {
      try {
        await env.BRAIN.put(k, JSON.stringify(v));
      } catch {}
    }
    return json({ ok: true });
  }

  return new Response('Not Found', { status: 404, headers: CORS });
}
