// worker/routes/admin.ts

// --- CORS helpers (simple JSON API) ---
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export const ROUTES = [
  '/health',
  '/diag/config',
  '/api/browser/session',
  '/admin/status',
  '/admin/social-mode',
  '/admin/social/seed',
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

export async function onRequestGet({ request, env }: any) {
  const { pathname, searchParams } = new URL(request.url);

  if (pathname === '/health') return json({ ok: true });

  if (pathname === '/admin/media/report') {
    const id = searchParams.get('id');
    if (!id) return json({ ok: false, error: 'missing id' }, 400);
    try {
      const raw = await env.BRAIN.get(`media:report:${id}`);
      const report = raw ? JSON.parse(raw) : null;
      return json({ ok: true, report });
    } catch {
      return json({ ok: false }, 500);
    }
  }

  if (pathname === '/admin/social-mode') {
    const live = env.ENABLE_SOCIAL_POSTING === 'true';
    return json({ ok: true, mode: live ? 'live' : 'dryrun' });
  }

  const now = new Date().toISOString();
  let kvKeysSample: string[] = [];
  let trendsAgeMinutes: number | null = null;
  let queueSize: number | null = null;
  let accountsCount: number | null = null;
  let posts24h: number | null = null;

  try {
    const list = await env.BRAIN.list({ prefix: 'thread-state' });
    kvKeysSample = (list.keys ?? []).slice(0, 5).map((k: any) => k.name);
  } catch {}

  try {
    const v = await env.BRAIN.get('tiktok:trends:updatedAt');
    if (v) trendsAgeMinutes = Math.floor((Date.now() - Number(v)) / 60000);
  } catch {}

  try {
    const size = await env.BRAIN.get('ops:queue:size');
    if (size) queueSize = Number(size);
  } catch {}

  try {
    const n = await env.BRAIN.get('tiktok:accounts:count');
    if (n) accountsCount = Number(n);
  } catch {}

  try {
    const n = await env.BRAIN.get('stats:posts:24h');
    if (n) posts24h = Number(n);
  } catch {}

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cronConfigured = !!env.WORKERS_CRON;

  return json({
    ok: true,
    now,
    timezone,
    routesCount: ROUTES.length,
    routes: ROUTES,
    kvKeysSample,
    trendsAgeMinutes,
    queueSize,
    accountsCount,
    cronConfigured,
    '24hPosts': posts24h ?? 0,
  });
}

export async function onRequestPost({ request, env }: any) {
  const url = new URL(request.url);

  if (url.pathname === '/admin/social/seed') {
    if (request.headers.get('x-api-key') !== env.POST_THREAD_SECRET) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    try {
      const mod: any = await import('../../src/social/defaults');
      if (typeof mod.ensureDefaults === 'function') {
        const config = await mod.ensureDefaults(env);
        return json({ ok: true, config });
      }
    } catch {}
    return json({ ok: false, error: 'seed-failed' }, 500);
  }

  if (url.pathname === '/admin/trigger') {
    const body = await request.json().catch(() => ({}));
    switch (body.kind) {
      case 'plan': {
        const mod: any = await import('../../src/social/orchestrate');
        if (typeof mod.runScheduled === 'function') {
          await mod.runScheduled(env, { dryrun: true });
        }
        return json({ ok: true });
      }
      case 'run': {
        const mod: any = await import('../../src/social/orchestrate');
        if (typeof mod.runScheduled === 'function') {
          await mod.runScheduled(env, { dryrun: false });
        }
        return json({ ok: true });
      }
      case 'trends': {
        const mod: any = await import('../../src/social/trends');
        if (typeof mod.refreshTrends === 'function') {
          await mod.refreshTrends(env);
        }
        return json({ ok: true });
      }
      case 'tick': {
        try {
          const mod: any = await import('../tiktok/index');
          if (typeof mod.runNextJob === 'function') {
            await mod.runNextJob();
          }
        } catch {}
        return json({ ok: true });
      }
      case 'ops': {
        try {
          const mod: any = await import('../ops/queue');
          if (typeof mod.runScheduled === 'function') {
            await mod.runScheduled(null as any, null as any);
          }
        } catch {}
        return json({ ok: true });
      }
      default:
        return json({ ok: false, error: 'unknown trigger' }, 400);
    }
  }

  if (url.pathname === '/admin/media/override') {
    // media override handler not implemented
  }

  return json({ ok: false }, 404);
}
