import { enqueue } from '../../src/ops/queue';

export async function onRequestPost({ request, env }: any) {
  const { pathname } = new URL(request.url);
  if (pathname === '/outreach/lead') {
    const body = await request.json();
    const id = crypto.randomUUID();
    await env.BRAIN.put(`leads:${id}`, JSON.stringify({ id, ...body, ts: Date.now() }));
    return new Response(JSON.stringify({ ok: true, id }), { headers: { 'content-type': 'application/json' } });
  }
  if (pathname === '/outreach/enqueue') {
    const body = await request.json();
    await enqueue(env, { kind: 'email_outreach', ...body });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
}

export async function onRequestGet({ request, env }: any) {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname === '/outreach/lead') {
    const id = searchParams.get('id');
    if (id) {
      const item = await env.BRAIN.get(`leads:${id}`, { type: 'json' });
      return new Response(JSON.stringify(item || null), { headers: { 'content-type': 'application/json' } });
    }
  }
  if (pathname === '/outreach/leads') {
    const tag = searchParams.get('tag');
    const list = await env.BRAIN.list({ prefix: 'leads:' });
    const items = [];
    for (const k of list.keys) {
      const v = await env.BRAIN.get(k.name, { type: 'json' });
      if (!tag || v.tags?.includes(tag)) items.push(v);
    }
    return new Response(JSON.stringify(items), { headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
}
