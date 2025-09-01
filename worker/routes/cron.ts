import { dequeue, QueueEnv, QueueItem } from '../lib/queue';

function cors(extra: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,Stripe-Signature,X-Requested-With',
    ...extra,
  };
}

async function runTask(_env: QueueEnv, _item: QueueItem) {
  // Supported task stubs
  switch (_item.type) {
    case 'tiktok.post':
    case 'orders.fulfill':
    case 'summary.daily':
      // real implementation would go here
      break;
    default:
      break;
  }
}

async function tick(env: QueueEnv, label: string): Promise<Response> {
  const items = await dequeue(env);
  for (const item of items) {
    await runTask(env, item);
  }
  return new Response(
    JSON.stringify({ ok: true, tick: label, processed: items.length, types: items.map(i => i.type) }),
    { headers: { 'content-type': 'application/json', ...cors() } }
  );
}

export async function handleCron(request: Request, env: QueueEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/cron/minute') return tick(env, 'minute');
  if (url.pathname === '/cron/hourly') return tick(env, 'hourly');
  if (url.pathname === '/cron/daily') return tick(env, 'daily');
  return null;
}
