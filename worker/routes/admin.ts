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
  // Preflight for both /admin and /admin/trigger
  return new Response(null, { status: 204, headers: CORS });
}

// Routes we expose from the admin surface (for quick reference in /admin status)
export const ROUTES = [
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

// GET /admin  (or used as your light diagnostics surface)
export async function onRequestGet({ request, env }: { request: Request; env: any }) {
  const { pathname } = new URL(request.url);

  // Super-light health probe if someone hits /health through this route file
  if (pathname === '/health') {
    return json({ ok: true, pong: true });
  }

  const now = new Date().toISOString();

  // Safe probes; each in try{} so a missing binding doesn’t 500
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

  // Optional stat you might populate elsewhere
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
    // Key name must be quoted to be valid JSON/JS
    "24hPosts": posts24h ?? 0,
  });
}

// POST /admin/trigger  { "kind": "plan" | "trends" | "tick" | "ops" }
export async function onRequestPost({ request }: { request: Request }) {
  const url = new URL(request.url);
  if (url.pathname !== '/admin/trigger') {
    return json({ ok: false, error: 'not-found' }, 404);
  }

  const body = await request.json().catch(() => ({} as any));

  switch (body.kind) {
    case 'plan': {
      try {
        const mod: any = await import('../planner/index');
        if (typeof mod.runScheduled === 'function') {
          await mod.runScheduled(null as any, null as any);
        }
      } catch {}
      break;
    }

    case 'trends': {
      try {
        const mod: any = await import('../tiktok/index');
        if (typeof mod.refreshTrends === 'function') {
          await mod.refreshTrends();
        }
      } catch {}
      break;
    }

    case 'tick': {
      try {
        const mod: any = await import('../tiktok/index');
        if (typeof mod.runNextJob === 'function') {
          await mod.runNextJob();
        }
      } catch {}
      break;
    }

    case 'ops': {
      try {
        const mod: any = await import('../ops/queue');
        if (typeof mod.runScheduled === 'function') {
          await mod.runScheduled(null as any, null as any);
        }
      } catch {}
      break;
    }

    default:
      return json({ ok: false, error: 'unknown kind' }, 400);
  }

  return json({ ok: true });
}