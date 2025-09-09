function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ request }: { request: Request }) {
  const url = new URL(request.url);
  if (url.pathname === '/orders/links') {
    return json([]);
  }
  return json({ ok: false }, 404);
}
