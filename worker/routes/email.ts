import { enqueue } from '../../src/ops/queue';
import { sendReply } from '../../src/ops/email';

export async function onRequestPost({ request, env }: any) {
  const { pathname } = new URL(request.url);
  if (pathname === '/email/inbound') {
    const body = await request.json();
    const id = crypto.randomUUID();
    await env.BRAIN.put(`email:inbox:${id}`, JSON.stringify({ id, ...body, ts: Date.now(), status: 'new' }));
    await enqueue(env, { kind: 'email_inbound', id });
    return new Response(JSON.stringify({ ok: true, id }), { headers: { 'content-type': 'application/json' } });
  }
  if (pathname === '/email/reply') {
    const body = await request.json();
    const r = await sendReply(env, body);
    return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
}

export async function onRequestGet({ request, env }: any) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (id) {
    const item = await env.BRAIN.get(`email:inbox:${id}`, { type: 'json' });
    return new Response(JSON.stringify(item || null), { headers: { 'content-type': 'application/json' } });
  }
  return new Response('missing id', { status: 400 });
}
