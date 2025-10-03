import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { logErrorToSheet } from '../../../../lib/maggieLogs';
import { updateWebhookStatus } from '../../../../lib/statusStore';
import { runOrder } from '../../../../src/fulfillment/runner';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const startedAt = new Date().toISOString();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!secret || !apiKey) {
    await updateWebhookStatus('stripe', {
      lastFailureAt: startedAt,
      error: 'missing stripe configuration',
    });
    return NextResponse.json({ ok: false, error: 'missing stripe configuration' }, { status: 500 });
  }

  const payload = await req.text();
  const signature = req.headers.get('stripe-signature') || '';
  const stripe = new Stripe(apiKey, { apiVersion: '2023-10-16' });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await Promise.all([
      logErrorToSheet({ module: 'StripeWebhook', error: message, timestamp: startedAt }),
      updateWebhookStatus('stripe', {
        lastFailureAt: startedAt,
        error: `signature: ${message}`,
      }),
    ]);
    return new NextResponse('invalid signature', { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (!session?.id) {
    await updateWebhookStatus('stripe', {
      lastFailureAt: startedAt,
      error: 'missing session id',
    });
    return NextResponse.json({ ok: false, error: 'missing session id' }, { status: 400 });
  }

  try {
    await runOrder({ kind: 'stripe-session', sessionId: session.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await Promise.all([
      logErrorToSheet({ module: 'StripeWebhook', error: err, timestamp: startedAt }),
      updateWebhookStatus('stripe', {
        lastFailureAt: startedAt,
        error: message,
      }),
    ]);
    return NextResponse.json({ ok: false, error: 'fulfillment failed' }, { status: 500 });
  }

  await updateWebhookStatus('stripe', {
    lastSuccessAt: new Date().toISOString(),
    error: null,
  });

  return NextResponse.json({ ok: true, sessionId: session.id });
}
