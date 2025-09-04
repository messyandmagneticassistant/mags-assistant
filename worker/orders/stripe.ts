import { enqueue } from '../../src/ops/queue';

export async function onRequestPost({ request, env }: any) {
  const sig = request.headers.get('stripe-signature');
  if (env.STRIPE_WEBHOOK_SECRET && sig !== env.STRIPE_WEBHOOK_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  const event = await request.json();
  await env.BRAIN.put(`stripe:evt:${event.id}`, JSON.stringify(event));
  await enqueue(env, { kind: 'fulfill_order', id: event.id });
  return new Response('ok');
}
