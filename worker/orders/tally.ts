import type { Env } from '../worker';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };
}

async function verifyTally(body: string, sig: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expected = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return expected === sig;
  } catch {
    return false;
  }
}

export async function handleTallyWebhook(request: Request, env: Env, cfg: any): Promise<Response> {
  const secret = cfg.TALLY_WEBHOOK_SECRET;
  if (!secret) return new Response('missing secret', { status: 400, headers: cors() });
  const sig = request.headers.get('x-tally-signature') || '';
  const body = await request.text();
  const ok = await verifyTally(body, sig, secret);
  if (!ok) return new Response('invalid signature', { status: 400, headers: cors() });
  const data = JSON.parse(body);
  const email: string | undefined = data?.data?.email || data?.data?.Email;
  if (email) {
    await env.POSTQ.put(`orders:form:${email}`, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 });
  }
  return new Response('ok', { headers: cors() });
}
