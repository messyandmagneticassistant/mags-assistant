import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { buildReadingPayloads } from '../../../../lib/stripe/buildReadingPayloads';
import { triggerReading } from '../../../../lib/stripe/reading';

const stripeApiVersion: Stripe.LatestApiVersion = '2023-10-16';

export async function POST(req: NextRequest) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey || !webhookSecret) {
    console.error('[StripeWebhook] Missing Stripe configuration');
    return new NextResponse('Missing Stripe configuration', { status: 400 });
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: stripeApiVersion });
  const signature = req.headers.get('stripe-signature') ?? '';
  const payload = await req.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid signature';
    console.error('[StripeWebhook] Failed to verify signature', message);
    return new NextResponse('Invalid signature', { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (!session.id) {
    console.error('[StripeWebhook] Received checkout session without id');
    return new NextResponse('Invalid session', { status: 400 });
  }

  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ['data.price.product'],
    });

    const readingPayloads = buildReadingPayloads(session, lineItems.data);

    if (!readingPayloads.length) {
      if (process.env.NODE_ENV !== 'production') {
        console.info('[StripeWebhook] No soul reading metadata found', {
          sessionId: session.id,
          lineItems: lineItems.data.length,
        });
      }
      return new NextResponse('No reading items', { status: 200 });
    }

    await Promise.all(readingPayloads.map((payload) => triggerReading(payload)));

    if (process.env.NODE_ENV !== 'production') {
      console.info('[StripeWebhook] Soul reading automation dispatched', {
        sessionId: session.id,
        payloadCount: readingPayloads.length,
        tiers: readingPayloads.map((payload) => payload.metadata.tier),
        email: readingPayloads[0]?.email ?? '',
        lineItems: lineItems.data.length,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[StripeWebhook] Failed to process checkout session', message);
    return new NextResponse('Failed to process session', { status: 400 });
  }

  return new NextResponse('OK', { status: 200 });
}
