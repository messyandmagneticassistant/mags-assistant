function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ env, request }: { env: any; request: Request }) {
  const url = new URL(request.url);
  if (url.pathname !== '/orders/links') return json({ ok: false }, 404);

  const email = url.searchParams.get('email');
  if (!email) return json([]);

  try {
    const stored = await env.BRAIN.get(`checkout:${email}`, 'json');
    return json(stored ? [stored] : []);
  } catch {
    return json([]);
  }
}
