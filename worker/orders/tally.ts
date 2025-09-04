import { parseSubmission } from '../../src/forms/schema';

interface Env {
  TALLY_SIGNING_SECRET?: string;
  BRAIN: KVNamespace;
}

async function verifySignature(req: Request, secret: string): Promise<boolean> {
  const sig = req.headers.get('tally-signature');
  if (!sig) return false;
  const [tPart, v1Part] = sig.split(',');
  const timestamp = tPart?.split('=')[1];
  const v1 = v1Part?.split('=')[1];
  if (!timestamp || !v1) return false;
  const body = await req.text();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = enc.encode(`${timestamp}.${body}`);
  const sigBuf = await crypto.subtle.sign('HMAC', key, data);
  const hex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === v1;
}

async function sha(input: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env, ctx }: { request: Request; env: Env; ctx: ExecutionContext }) {
  const secret = env.TALLY_SIGNING_SECRET;
  const raw = await request.text();
  if (secret) {
    const ok = await verifySignature(new Request(request.url, { headers: request.headers, body: raw, method: request.method }), secret);
    if (!ok) return new Response('invalid signature', { status: 400 });
  } else {
    console.warn('TALLY_SIGNING_SECRET missing');
  }
  const body = JSON.parse(raw || '{}');
  const formId = body.formId || body.form_id || '';
  const ctxObj = parseSubmission(formId, body);
  const key = `order:${await sha(ctxObj.email + ':' + Date.now())}`;
  await env.BRAIN.put(key, JSON.stringify({ ...ctxObj, receivedAt: Date.now() }));
  try {
    const mod: any = await import('./fulfill');
    if (typeof mod.fulfill === 'function') ctx.waitUntil(mod.fulfill(ctxObj));
  } catch {}
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
