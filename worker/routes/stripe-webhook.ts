import Stripe from 'stripe';
import type { Env as BaseEnv } from '../lib/env';
import { recordBrainUpdate } from '../brain';

const RELEVANT_EVENTS = new Set<string>([
  'checkout.session.completed',
  'product.updated',
  'price.updated',
]);

type Env = BaseEnv & {
  STRIPE_WEBHOOK_SECRET?: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPost({
  request,
  env,
  ctx,
}: {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
}): Promise<Response> {
  const secret = env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[stripe-webhook] missing STRIPE_WEBHOOK_SECRET');
    return json({ ok: false, error: 'missing-webhook-secret' }, 500);
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    console.warn('[stripe-webhook] missing stripe-signature header');
    return json({ ok: false, error: 'missing-signature' }, 400);
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.warn('[stripe-webhook] invalid signature', err);
    return json({ ok: false, error: 'invalid-signature' }, 400);
  }

  console.log('[stripe-webhook] event received:', event.type);

  if (!RELEVANT_EVENTS.has(event.type)) {
    return json({ ok: true, ignored: event.type });
  }

  const tasks: Promise<unknown>[] = [];

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

    if (customerId && env.BRAIN && typeof env.BRAIN.put === 'function') {
      tasks.push(
        env.BRAIN.put(
          `stripe:latest:${customerId}`,
          JSON.stringify({
            eventId: event.id,
            type: event.type,
            receivedAt: new Date().toISOString(),
            session,
          })
        )
      );
    }

    tasks.push(
      (async () => {
        try {
          // @ts-ignore - shared queue helper ships from application source
          const { enqueueFulfillmentJob } = await import('../../src/' + 'queue');
          await enqueueFulfillmentJob(
            {
              source: 'stripe',
              payload: { sessionId: session.id },
              metadata: { eventId: event.id },
            },
            env
          );
        } catch (err) {
          console.error('[stripe-webhook] failed to enqueue fulfillment job', err);
        }
      })()
    );

    tasks.push(
      recordBrainUpdate(env, {
        type: 'stripe',
        summary: `Checkout session completed (${session.id})`,
        metadata: {
          eventId: event.id,
          sessionId: session.id,
          customer: customerId,
        },
      }).catch((err) => {
        console.error('[stripe-webhook] failed to record brain update for checkout', err);
      })
    );
  }

  if (event.type === 'product.updated') {
    const product = event.data.object as Stripe.Product;
    tasks.push(
      recordBrainUpdate(env, {
        type: 'stripe',
        summary: `Stripe product updated: ${product.name || product.id}`,
        metadata: {
          eventId: event.id,
          productId: product.id,
        },
      }).catch((err) => {
        console.error('[stripe-webhook] failed to record brain update for product', err);
      })
    );
  }

  if (event.type === 'price.updated') {
    const price = event.data.object as Stripe.Price;
    tasks.push(
      recordBrainUpdate(env, {
        type: 'stripe',
        summary: `Stripe price updated: ${price.nickname || price.id}`,
        metadata: {
          eventId: event.id,
          priceId: price.id,
          product: typeof price.product === 'string' ? price.product : price.product?.id,
        },
      }).catch((err) => {
        console.error('[stripe-webhook] failed to record brain update for price', err);
      })
    );
  }

  if (tasks.length) {
    ctx.waitUntil(Promise.all(tasks).catch((err) => console.error('[stripe-webhook] background task failed', err)));
  }

  return json({ ok: true });
}
