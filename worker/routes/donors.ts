import { listRecentDonations, recordDonation } from '../../src/donors/notion';

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ env, request }: { env: any; request: Request }) {
  const url = new URL(request.url);
  if (url.pathname !== '/donors/recent') return json({ ok: false }, 404);
  try {
    const list = await listRecentDonations(10, env);
    return json(list);
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPost({ env, request }: { env: any; request: Request }) {
  const url = new URL(request.url);
  if (url.pathname !== '/donors/add') return json({ ok: false }, 404);
  if (request.headers.get('x-api-key') !== env.POST_THREAD_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const body = await request.json().catch(() => ({}));
  try {
    await recordDonation(body, env);
    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 500);
  }
}
