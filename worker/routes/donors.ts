import { recordDonation, listRecentDonations } from '../../src/donors/notion';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }: { request: Request; env: any }) {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname !== '/donors/recent') return new Response('Not Found', { status: 404, headers: CORS });
  const limit = Number(searchParams.get('limit') || 10);
  const data = await listRecentDonations(limit, env).catch(() => ({ results: [] }));
  return json(data);
}

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  const { pathname } = new URL(request.url);
  if (pathname !== '/donors/add') return new Response('Not Found', { status: 404, headers: CORS });
  const auth = request.headers.get('Authorization')?.replace('Bearer ', '') || '';
  if (env.POST_THREAD_SECRET && auth !== env.POST_THREAD_SECRET) return new Response('forbidden', { status: 403, headers: CORS });
  const payload = await request.json().catch(() => ({}));
  const out = await recordDonation(payload, env).catch(() => ({ ok: false }));
  return json(out);
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
