import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

import { triggerReading } from '../../../../lib/stripe/reading';

const stripeApiVersion: Stripe.LatestApiVersion = '2023-10-16';

function parseBoolean(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function parseTier(value: string | null | undefined): 'full' | 'lite' | 'mini' | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'full' || normalized === 'lite' || normalized === 'mini') {
    return normalized;
  }
  return null;
}

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

    const email =
      session.customer_details?.email ||
      (typeof session.customer_email === 'string' ? session.customer_email : '') ||
      '';
    const name = session.customer_details?.name || '';
    const purchasedAt = new Date(((session.created ?? Date.now() / 1000) as number) * 1000).toISOString();

    await Promise.all(
      lineItems.data.map(async (item) => {
        const product = item.price?.product;
        if (!product || typeof product === 'string') {
          return;
        }

        const metadata = product.metadata ?? {};
        const tier = parseTier(metadata.reading_tier);
        if (!tier) {
          return;
        }

        const payload = {
          email,
          name,
          metadata: {
            tier,
            is_addon: parseBoolean(metadata.is_addon),
            ...(metadata.child_friendly !== undefined
              ? { child_friendly: parseBoolean(metadata.child_friendly) }
              : {}),
          },
          sessionId: session.id!,
          purchasedAt,
        } as const;

        await triggerReading(payload);

        if (process.env.NODE_ENV !== 'production') {
          console.info('[StripeWebhook] Triggered reading', {
            email: payload.email,
            tier: payload.metadata.tier,
            is_addon: payload.metadata.is_addon,
            child_friendly: payload.metadata.child_friendly,
          });
        }
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[StripeWebhook] Failed to process checkout session', message);
    return new NextResponse('Failed to process session', { status: 400 });
  }

  return new NextResponse('OK', { status: 200 });
}
