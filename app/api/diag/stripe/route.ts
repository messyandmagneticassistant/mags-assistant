import { env } from '../../../../lib/env.js';

export const runtime = 'nodejs';

export async function GET() {
  if (!env.STRIPE_SECRET_KEY)
    return Response.json({ ok: false, reason: 'missing STRIPE_SECRET_KEY' });
  try {
    const r = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    return Response.json({ ok: r.ok, reason: r.ok ? undefined : `status ${r.status}` });
  } catch (e: any) {
    return Response.json({ ok: false, reason: e.message });
  }
}

