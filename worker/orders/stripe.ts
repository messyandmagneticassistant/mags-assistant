import type { Env } from '../worker';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };
}

async function verifyStripe(body: string, sig: string, secret: string): Promise<boolean> {
  try {
    const parts = sig.split(',').reduce<Record<string,string>>((acc, p) => {
      const [k, v] = p.split('=');
      if (k && v) acc[k] = v;
      return acc;
    }, {});
    const payload = `${parts.t}.${body}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const expected = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return expected === parts.v1;
  } catch {
    return false;
  }
}

export async function handleStripeWebhook(request: Request, env: Env, cfg: any): Promise<Response> {
  const secret = cfg.STRIPE_WEBHOOK_SECRET || cfg.STRIPE_SECRET_KEY;
  if (!secret) return new Response('missing secret', { status: 400, headers: cors() });
  const sig = request.headers.get('stripe-signature') || '';
  const body = await request.text();
  const ok = await verifyStripe(body, sig, secret);
  if (!ok) return new Response('invalid signature', { status: 400, headers: cors() });

  const event = JSON.parse(body);
  const type = event.type;
  const obj = event.data?.object || {};
  let email: string | undefined;
  let items: any[] = [];
  if (type === 'checkout.session.completed') {
    email = obj.customer_details?.email || obj.customer_email;
    // try to fetch line items
    if (cfg.STRIPE_SECRET_KEY && obj.id) {
      const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${obj.id}/line_items`, {
        headers: {
          Authorization: `Bearer ${cfg.STRIPE_SECRET_KEY}`,
        },
      });
      const json = await res.json().catch(() => ({}));
      items = json.data || [];
    }
  } else if (type === 'payment_intent.succeeded') {
    email = obj.receipt_email;
    items = obj.lines?.data || [];
  }
  if (email && items.length) {
    await env.ORDERS.send({ email, items, form: null });
  }
  return new Response('ok', { headers: cors() });
}
