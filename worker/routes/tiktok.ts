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

async function read(env: any, key: string) {
  try {
    const val = await env.POSTQ.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

async function write(env: any, key: string, val: any) {
  await env.POSTQ.put(key, JSON.stringify(val));
}

export async function onRequestGet({ request, env }: { request: Request; env: any }) {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  if (pathname === '/tiktok/accounts') {
    const accounts = (await read(env, 'tiktok:accounts')) || {};
    return json({ ok: true, accounts });
  }

  if (pathname === '/tiktok/eng/plan') {
    const postId = searchParams.get('postId') || '';
    const plan = await read(env, `tiktok:eng:plan:${postId}`);
    return json({ ok: true, plan });
  }

  if (pathname === '/tiktok/review-queue') {
    const review = (await read(env, 'tiktok:review')) || [];
    return json({ ok: true, review });
  }

  return new Response('Not Found', { status: 404, headers: CORS });
}

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  const { pathname } = new URL(request.url);
  const body = await request.json().catch(() => ({}));

  if (pathname === '/tiktok/accounts') {
    const accounts = (await read(env, 'tiktok:accounts')) || {};
    accounts[body.handle] = {
      handle: body.handle,
      label: body.label,
      privacy: body.privacy,
      enabled: body.enabled !== false,
    };
    await write(env, 'tiktok:accounts', accounts);
    return json({ ok: true, accounts });
  }

  if (pathname === '/tiktok/cookies') {
    const key = `tiktok:cookies:${body.handle}`;
    await write(env, key, body.cookies);
    return json({ ok: true });
  }

  if (pathname === '/tiktok/check') {
    const key = `tiktok:cookies:${body.handle}`;
    const cookies = await read(env, key);
    return json({ ok: !!cookies });
  }

  if (pathname === '/tiktok/post') {
    const queue = (await read(env, 'tiktok:queue')) || [];
    queue.push({ kind: 'post', ...body, runAt: Date.now() });
    await write(env, 'tiktok:queue', queue);
    return json({ ok: true });
  }

  if (pathname === '/tiktok/schedule') {
    const queue = (await read(env, 'tiktok:queue')) ?? [];
    const whenISO = body.whenISO ?? new Date(Date.now() + 5 * 60 * 1000).toISOString();
    queue.push({ kind: 'schedule', whenISO, meta: body.meta ?? {} });
    await write(env, 'tiktok:queue', queue);
    return json({ ok: true });
  }

  if (pathname === '/tiktok/reschedule') {
    const queue = (await read(env, 'tiktok:queue')) ?? [];
    const whenISO = body.whenISO ?? new Date(Date.now() + 10 * 60 * 1000).toISOString();
    queue.push({ kind: 'reschedule', whenISO, id: body.id });
    await write(env, 'tiktok:queue', queue);
    return json({ ok: true });
  }

  if (pathname === '/tiktok/capcut/apply-template') {
    return json({ status: 'requires-manual', template: body.templateRef, cuts: body.assets || [] });
  }

  if (pathname === '/tiktok/eng/rules') {
    await write(env, 'tiktok:eng:rules', body);
    return json({ ok: true });
  }

  if (pathname === '/tiktok/eng/persona') {
    const key = `tiktok:eng:persona:${body.handle || body.name || Date.now()}`;
    await write(env, key, body);
    return json({ ok: true });
  }

  if (pathname === '/tiktok/eng/orchestrate') {
    const postId = body.postId || Date.now().toString();
    const plan = { postId, ...body };
    await write(env, `tiktok:eng:plan:${postId}`, plan);
    const queue = (await read(env, 'tiktok:queue')) || [];
    if (Array.isArray(body.boosters)) {
      for (const step of body.boosters) {
        queue.push({ kind: 'eng', step, runAt: Date.now() + (step.offsetSec || 0) * 1000 });
      }
    }
    await write(env, 'tiktok:queue', queue);
    return json({ ok: true, postId });
  }

  return new Response('Not Found', { status: 404, headers: CORS });
}

export async function runNextJob(env: any) {
  const queue = (await read(env, 'tiktok:queue')) || [];
  const now = Date.now();
  const idx = queue.findIndex((j: any) => !j.runAt || j.runAt <= now);
  if (idx === -1) return null;
  const job = queue.splice(idx, 1)[0];
  await write(env, 'tiktok:queue', queue);
  return job;
}

export async function onScheduled(_event: ScheduledEvent, env: any) {
  try {
    const mod = await import('../../src/trends');
    const ts = await env.POSTQ.get('tiktok:trends:ts');
    if (!ts || Date.now() - Number(ts) > 60 * 60 * 1000) {
      if (typeof (mod as any).refreshTrends === 'function') await (mod as any).refreshTrends(env);
    }
  } catch {}
  await runNextJob(env);
}
