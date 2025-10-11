import type Stripe from 'stripe';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildReadingPayloads } from '../lib/stripe/buildReadingPayloads';

const runOrderMock = vi.fn();
const updateBrainMock = vi.fn();
const getConfigMock = vi.fn();

vi.mock('../src/fulfillment/runner', () => ({
  runOrder: (...args: any[]) => runOrderMock(...args),
}));

vi.mock('../utils/config', () => ({
  getConfig: (...args: any[]) => getConfigMock(...args),
}));

vi.mock('../lib/brain', () => ({
  updateBrain: (...args: any[]) => updateBrainMock(...args),
}));

let triggerReading: typeof import('../lib/stripe/reading').triggerReading;

const trackedEnvKeys = [
  'FETCH_PASS',
  'GOOGLE_CLIENT_EMAIL',
  'GOOGLE_KEY_URL',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'RESEND_FROM_NAME',
  'NOTION_TOKEN',
  'NOTION_API_KEY',
  'FULFILLMENT_NOTION_DB_ID',
  'FULFILLMENT_SHEET_ID',
  'FULFILLMENT_DRIVE_ROOT_ID',
  'FULFILLMENT_BLUEPRINT_TEMPLATE_ID',
  'FULFILLMENT_SCHEDULE_DAILY_TEMPLATE_ID',
  'FULFILLMENT_SCHEDULE_WEEKLY_TEMPLATE_ID',
  'FULFILLMENT_SCHEDULE_MONTHLY_TEMPLATE_ID',
] as const;

type TrackedKey = (typeof trackedEnvKeys)[number];

const originalEnv: Partial<Record<TrackedKey, string | undefined>> = {};

beforeAll(() => {
  for (const key of trackedEnvKeys) {
    originalEnv[key] = process.env[key];
  }
});

afterAll(() => {
  for (const key of trackedEnvKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('Stripe soul reading automation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ triggerReading } = await import('../lib/stripe/reading'));
  });

  afterEach(() => {
    for (const key of trackedEnvKeys) {
      delete process.env[key];
    }
  });

  it('builds reading payloads with price metadata priority', () => {
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
  });

  it('runs the internal fulfillment pipeline and syncs the brain', async () => {
    const payload = {
      email: 'reader@example.com',
      name: 'Reader Example',
      metadata: {
        tier: 'lite' as const,
        is_addon: false,
      },
      sessionId: 'cs_test_123',
      purchasedAt: new Date().toISOString(),
    };

    const fulfillmentRecord: ReturnType<typeof buildFulfillmentRecord> = buildFulfillmentRecord({
      email: 'reader@example.com',
      tier: 'lite',
    });

    getConfigMock.mockResolvedValue({
      gmail: {
        clientEmail: 'bot@example.com',
        keyUrl: 'https://example.com/google-key',
        fetchPass: 'secret-pass',
      },
      resend: {
        apiKey: 'resend-key',
        fromEmail: 'hi@example.com',
        fromName: 'Maggie',
      },
      notion: {
        token: 'notion-token',
        fulfillmentDatabaseId: 'notion-db',
      },
      fulfillment: {
        sheetId: 'sheet-123',
        driveRootId: 'drive-456',
        blueprintTemplateId: 'blueprint-789',
        scheduleTemplates: {
          daily: 'daily-tmpl',
          weekly: 'weekly-tmpl',
          monthly: 'monthly-tmpl',
        },
      },
    });

    runOrderMock.mockResolvedValue(fulfillmentRecord);
    updateBrainMock.mockResolvedValue(undefined);

    const record = await triggerReading(payload);

    expect(record).toEqual(fulfillmentRecord);
    expect(getConfigMock).toHaveBeenCalledTimes(1);

    expect(runOrderMock).toHaveBeenCalledWith(
      { kind: 'stripe-session', sessionId: 'cs_test_123' },
      {
        env: expect.objectContaining({
          RESEND_API_KEY: 'resend-key',
          RESEND_FROM_EMAIL: 'hi@example.com',
          RESEND_FROM_NAME: 'Maggie',
          NOTION_TOKEN: 'notion-token',
          NOTION_API_KEY: 'notion-token',
          FULFILLMENT_NOTION_DB_ID: 'notion-db',
          FULFILLMENT_SHEET_ID: 'sheet-123',
          FULFILLMENT_DRIVE_ROOT_ID: 'drive-456',
          FULFILLMENT_BLUEPRINT_TEMPLATE_ID: 'blueprint-789',
          FULFILLMENT_SCHEDULE_DAILY_TEMPLATE_ID: 'daily-tmpl',
          FULFILLMENT_SCHEDULE_WEEKLY_TEMPLATE_ID: 'weekly-tmpl',
          FULFILLMENT_SCHEDULE_MONTHLY_TEMPLATE_ID: 'monthly-tmpl',
          GOOGLE_CLIENT_EMAIL: 'bot@example.com',
          GOOGLE_KEY_URL: 'https://example.com/google-key',
          FETCH_PASS: 'secret-pass',
        }),
      }
    );

    expect(updateBrainMock).toHaveBeenCalledTimes(1);
    const [update] = updateBrainMock.mock.calls[0];
    expect(update.message).toContain('Delivered');
    expect(update.tiers).toEqual(['lite']);
    expect(update.updates?.fulfillment?.lastEmail).toBe('reader@example.com');
  });

  it('continues even if brain sync fails', async () => {
    const payload = {
      email: 'reader@example.com',
      name: 'Reader Example',
      metadata: {
        tier: 'lite' as const,
        is_addon: false,
      },
      sessionId: 'cs_test_987',
      purchasedAt: new Date().toISOString(),
    };

    getConfigMock.mockResolvedValue({});
    runOrderMock.mockResolvedValue(
      buildFulfillmentRecord({ email: 'reader@example.com', tier: 'lite' })
    );
    updateBrainMock.mockRejectedValue(new Error('network down'));

    await expect(triggerReading(payload)).resolves.toMatchObject({
      intake: expect.objectContaining({ email: 'reader@example.com' }),
    });
    expect(updateBrainMock).toHaveBeenCalledTimes(1);
  });
});

function buildFulfillmentRecord({
  email,
  tier,
}: {
  email: string;
  tier: 'mini' | 'lite' | 'full';
}) {
  const now = new Date();
  return {
    intake: {
      source: 'stripe' as const,
      email,
      tier,
      addOns: [],
      fulfillmentType: 'digital' as const,
      prefs: {},
      customer: { name: 'Reader Example' },
    },
    blueprint: {
      docId: 'doc-1',
      docUrl: 'https://docs.example.com/doc-1',
      pdfId: 'pdf-1',
      pdfUrl: 'https://docs.example.com/pdf-1',
      summary: 'Summary',
      story: 'Story',
      attempts: [],
      folderId: 'folder-1',
      folderUrl: 'https://drive.example.com/folder-1',
    },
    icons: {
      bundleFolderId: 'icons-1',
      bundleFolderUrl: 'https://drive.example.com/icons-1',
      manifestId: 'manifest-1',
      manifestUrl: 'https://drive.example.com/manifest-1',
      icons: [],
    },
    schedule: {
      scheduleFolderId: 'schedule-1',
      scheduleFolderUrl: 'https://drive.example.com/schedule-1',
      files: [],
    },
    delivery: [],
    outputs: [],
    workspace: {
      drive: {} as any,
      docs: {} as any,
      rootFolderId: 'root-1',
      orderFolderId: 'order-1',
      orderFolderUrl: 'https://drive.example.com/order-1',
      timestamp: now,
      config: {
        driveRootId: 'root-1',
      },
    },
  };
}
