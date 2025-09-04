import { enqueue, dequeue } from '../../src/ops/queue';
import { handle as outreachHandle } from '../../src/ops/outreach';
import { handle as orderHandle } from '../../src/ops/orders';
import { handleInbound } from '../../src/ops/email';

async function run(env: any) {
  const jobs = await dequeue(env, 5);
  for (const job of jobs) {
    try {
      if (job.kind === 'email_outreach') await outreachHandle(job, env);
      else if (job.kind === 'fulfill_order' || job.kind === 'process_form') await orderHandle(job, env);
      else if (job.kind === 'email_inbound') await handleInbound(job, env);
      console.log('ops', job.kind);
    } catch (err) {
      console.log('ops err', job.kind, err);
    }
  }
  return { processed: jobs.length };
}

export async function onRequestPost({ request, env }: any) {
  const { pathname } = new URL(request.url);
  if (pathname === '/ops/enqueue') {
    const body = await request.json();
    await enqueue(env, body.job || body);
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  }
  if (pathname === '/ops/tick') {
    const r = await run(env);
    return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
  }
  return new Response('not found', { status: 404 });
}

export async function runScheduled(_event: any, env: any) {
  await run(env);
}
