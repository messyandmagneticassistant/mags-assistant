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
  '/brain/get',
  '/brain/sync',
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
  '/fundraising/status',
  '/fundraising/outreach',
  '/fundraising/followup',
  '/fundraising/submit',
  '/fundraising/onepager',
];

export async function onRequestGet({ request, env }: any) {
  const { pathname, searchParams } = new URL(request.url);

  if (pathname === '/health') return json({ ok: true });
  if (pathname === '/brain/get') {
    const key = env.BRAIN_DOC_KEY || 'PostQ:thread-state';
    const raw = await env.BRAIN.get(key);
    return json({ ok: true, exists: !!raw, size: raw?.length ?? 0 });
  }


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

  if (pathname === '/fundraising/status') {
    return json({ ok: true, sheetRows: 0, lastOutreach: null, lastReport: null });
  }

  const now = new Date().toISOString();
  let kvKeysSample: string[] = [];
  let trendsAgeMinutes: number | null = null;
  let queueSize: number | null = null;
  let accountsCount: number | null = null;
  let posts24h: number | null = null;

  try {
    const list = await env.BRAIN.list({ prefix: env.SECRET_BLOB || 'thread-state' });
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

  if (url.pathname === '/brain/sync') {
    if (request.headers.get('x-fetch-pass') !== process.env.FETCH_PASS) {
      return json({ ok: false, error: 'auth' }, 401);
    }
    const file = await fetch(new URL('../../brain/.brain.md', import.meta.url)).then((r) => r.text());
    const key = env.BRAIN_DOC_KEY || 'PostQ:thread-state';
    await env.BRAIN.put(key, file);
    return json({ ok: true });
  }

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
          const planned = await mod.runScheduled(env, { dryrun: true });
          return json({ ok: true, planned });
        }
        return json({ ok: false, error: 'missing orchestrator' }, 500);
      }
      case 'run': {
        const mod: any = await import('../../src/social/orchestrate');
        if (typeof mod.runScheduled === 'function') {
          const scheduled = await mod.runScheduled(env, { dryrun: false });
          return json({ ok: true, scheduled });
        }
        return json({ ok: false, error: 'missing orchestrator' }, 500);
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

  const needsKey = (req: Request) => {
    const key = req.headers.get('x-api-key');
    return key === env.POST_THREAD_SECRET || key === env.CRON_SECRET;
  };

  if (url.pathname === '/fundraising/outreach') {
    if (!needsKey(request)) return json({ ok: false, error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    const mod: any = await import('../../src/fundraising');
    for (const c of contacts) {
      const html = (await import('../../src/fundraising/email')).renderTemplate('outreach', {
        name: c.name,
        org: c.org,
        land: env.LAND_ADDRESS || '',
        landTown: (env.LAND_ADDRESS || '').split(',')[0] || '',
        donateRecurring: env.STRIPE_LINK_RECURRING || '',
        donateOnce: env.STRIPE_LINK_ONE_TIME || '',
        notionPage: env.NOTION_DONOR_PAGE_ID || '',
        sender: env.MAGGIE_SENDER_NAME || '',
        senderEmail: env.MAGGIE_SENDER_EMAIL || '',
        tags: env.LAND_PITCH_TAGS || '',
      });
      await mod.sendEmail({ to: c.email, subject: 'outreach', html });
      await mod.addContact(c);
    }
    return json({ ok: true, sent: contacts.length });
  }

  if (url.pathname === '/fundraising/followup') {
    if (!needsKey(request)) return json({ ok: false, error: 'unauthorized' }, 401);
    return json({ ok: true });
  }

  if (url.pathname === '/fundraising/submit') {
    if (!needsKey(request)) return json({ ok: false, error: 'unauthorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const mod: any = await import('../../src/fundraising');
    if (Array.isArray(body.files)) {
      for (const f of body.files) {
        await mod.saveFile(f);
      }
    }
    await mod.logSubmission({ org: body.org, program: body.program, url: body.url, submittedAt: new Date().toISOString(), status: body.status || 'submitted', notes: body.notes });
    await mod.updateNotionSummary({ recent: body.org });
    return json({ ok: true });
  }

  if (url.pathname === '/fundraising/onepager') {
    if (!needsKey(request)) return json({ ok: false, error: 'unauthorized' }, 401);
    const mod: any = await import('../../src/fundraising');
    const link = await mod.createOnePager({ data: {} });
    return json({ ok: true, link });
  }

  if (url.pathname === '/admin/media/override') {
    // media override handler not implemented
  }

  return json({ ok: false }, 404);
}
