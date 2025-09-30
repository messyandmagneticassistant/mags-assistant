export async function onRequestGet({ request, env }: { request: Request; env: any }) {
  const url = new URL(request.url);
  if (url.pathname === '/ops/recent-order') {
    // @ts-ignore - queue helpers are shared with the Node runtime
    const { getLastOrderSummary } = await import('../../src/' + 'queue');
    const summary = await getLastOrderSummary(env);
    return json({ ok: true, summary });
  }
  if (url.pathname !== '/orders/list') return json({ ok: false }, 404);

  const email = url.searchParams.get('email')?.trim();
  if (!email) return json([]);

  try {
    const prefix = `order:${await sha(email)}`;
    const list = await env.BRAIN.list({ prefix });
    const items = await Promise.all(
      list.keys.map((k: any) => env.BRAIN.get(k.name).then((v: any) => (v ? JSON.parse(v) : null)))
    );
    return json(items.filter(Boolean));
  } catch {
    return json([]);
  }
}

export async function onRequestPost(ctx: any) {
  // expects a ctx.waitUntil + dynamic import to keep bundle light
  const body = await ctx.request.json().catch(() => ({}));
  const ctxObj = { ...body, env: undefined, url: ctx.request.url }; // pass only needed bits

  try {
    ctx.waitUntil(
      (async () => {
        const mod: any = await import('../orders/fulfill');
        if (typeof mod.fulfill === 'function') await mod.fulfill(ctxObj, ctx.env);
      })()
    );
  } catch {}
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** util */
async function sha(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
