import { OrderContext } from '../../src/forms/schema';

function headers(env: any) {
  return env.POST_THREAD_SECRET
    ? { Authorization: `Bearer ${env.POST_THREAD_SECRET}` }
    : {};
}

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  const body: any = await request.json().catch(() => ({}));
  const email = body.data?.email || body.email;
  const productId = body.data?.product_id || body.productId || '';
  const cohort = body.data?.cohort || body.cohort;
  const answers = body.data?.answers || body.answers || body;
  const ctx: OrderContext = { email, productId, cohort, answers };
  try {
    await env.BRAIN.put(`order:${email}`, JSON.stringify(ctx));
  } catch {}
  try {
    const url = new URL('/orders/fulfill', request.url);
    await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers(env) },
      body: JSON.stringify(ctx),
    });
  } catch {}
  return new Response('ok', { status: 200 });
}
