const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

export async function onRequestPost({ request, env }: { request: Request; env: any }) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/browser/session') {
    return new Response('Not Found', { status: 404, headers: CORS });
  }

  const r = await fetch(env.BROWSERLESS_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.BROWSERLESS_TOKEN}`,
    },
  });
  const data = (await r.json()) as Record<string, any>;
  return new Response(JSON.stringify({ wsUrl: data.wsUrl }), {
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}
