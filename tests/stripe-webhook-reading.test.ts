import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildReadingPayloads } from '../lib/stripe/buildReadingPayloads';
import { triggerReading } from '../lib/stripe/reading';

describe('Stripe soul reading automation', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.MAKE_SOUL_READING_WEBHOOK_URL = 'https://example.com/webhook';
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MAKE_SOUL_READING_WEBHOOK_URL;
  });

  it('builds reading payloads with price metadata priority and triggers webhook', async () => {
    const session = {
      id: 'cs_test_123',
      customer_details: { email: 'reader@example.com', name: 'Reader Example' },
      customer_email: null,
      created: Math.floor(Date.now() / 1000),
    } as Stripe.Checkout.Session;

    const lineItems = [
      {
        id: 'li_test_123',
        price: {
          id: 'price_test_123',
          metadata: {
            reading_tier: 'lite',
            is_addon: 'false',
          },
          product: {
            id: 'prod_test_123',
            metadata: {
              reading_tier: 'full',
              is_addon: 'true',
              child_friendly: 'true',
              special_note: 'thank you',
            },
          },
        },
      },
    ] as unknown as Stripe.LineItem[];

    const payloads = buildReadingPayloads(session, lineItems);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      email: 'reader@example.com',
      name: 'Reader Example',
      metadata: {
        tier: 'lite',
        is_addon: false,
        child_friendly: true,
        special_note: 'thank you',
      },
      sessionId: 'cs_test_123',
    });

    await triggerReading(payloads[0]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchSpy.mock.calls[0];
    expect((requestInit as RequestInit).method).toBe('POST');
    const body = (requestInit as RequestInit).body as string;
    expect(JSON.parse(body)).toMatchObject({
      metadata: { tier: 'lite', is_addon: false, child_friendly: true, special_note: 'thank you' },
    });
  });
});
