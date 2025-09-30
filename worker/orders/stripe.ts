import Stripe from 'stripe';
import type { KVNamespace } from '@cloudflare/workers-types';

interface Env {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  BRAIN?: KVNamespace;
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const key = env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const stripe = key ? new Stripe(key, { apiVersion: '2025-08-27.basil' }) : null;
  const secret = env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    if (secret && signature && stripe) {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } else {
      event = JSON.parse(rawBody || '{}');
    }
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid-signature' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const sessionId = session.id;
    if (sessionId) {
      // @ts-ignore - queue helpers are shared with the Node runtime
      const { enqueueFulfillmentJob } = await import('../../src/' + 'queue');
      await enqueueFulfillmentJob(
        {
          source: 'stripe',
          payload: { sessionId },
          metadata: { eventId: event.id },
        },
        env
      );
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
