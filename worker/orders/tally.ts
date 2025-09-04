import { enqueue } from '../../src/ops/queue';

export async function onRequestPost({ request, env }: any) {
  const sig = request.headers.get('tally-signature');
  if (env.TALLY_SIGNING_SECRET && sig !== env.TALLY_SIGNING_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }
  const event = await request.json();
  await env.BRAIN.put(`tally:evt:${event.id || event.eventId || crypto.randomUUID()}`, JSON.stringify(event));
  await enqueue(env, { kind: 'process_form', id: event.id || event.eventId });
  return new Response('ok');
}
