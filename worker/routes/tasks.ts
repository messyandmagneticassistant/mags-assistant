import { enqueue, size, QueueEnv } from '../lib/queue';

function cors(extra: Record<string, string> = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,Stripe-Signature,X-Requested-With',
    ...extra,
  };
}

export async function handleTasks(request: Request, env: QueueEnv): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/tasks/enqueue') {
    try {
      const { type, payload } = await request.json();
      await enqueue(env, String(type), payload);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json', ...cors() },
      });
    } catch (e: any) {
      return new Response(
        JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
        { status: 400, headers: { 'content-type': 'application/json', ...cors() } }
      );
    }
  }

  if (request.method === 'GET' && url.pathname === '/tasks/size') {
    const n = await size(env);
    return new Response(
      JSON.stringify({ ok: true, size: n }),
      { headers: { 'content-type': 'application/json', ...cors() } }
    );
  }

  return null;
}
