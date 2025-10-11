import type { FulfillmentRecord } from '../../src/fulfillment/types';
import { runOrder } from '../../src/fulfillment/runner';
import { getConfig } from '../../utils/config';
import { updateBrain } from '../brain';
import { resolveTierFromProduct } from '../../utils/product';

const TIER_KEYS = ['reading_tier', 'tier', 'level', 'reading-tier'] as const;
const ADDON_KEYS = ['is_addon', 'addon', 'isAddon', 'is-addon'] as const;

type TierKey = (typeof TIER_KEYS)[number];
type AddOnKey = (typeof ADDON_KEYS)[number];

function firstMetadataValue(
  metadata: Record<string, string | boolean | null | undefined>,
  keys: readonly string[]
): string | boolean | null | undefined {
  for (const key of keys) {
    if (key in metadata) {
      return metadata[key];
    }
  }
  return undefined;
}

function parseBoolean(value: string | boolean | null | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return undefined;
}

function parseTier(value: string | null | undefined): 'full' | 'lite' | 'mini' | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'full' || normalized === 'lite' || normalized === 'mini') {
    return normalized;
  }
  return undefined;
}

export interface TriggerReadingLineItem {
  id: string;
  productId?: string;
  priceId?: string;
  description?: string | null;
  quantity: number;
  metadata: Record<string, string | boolean | null | undefined>;
}

export interface TriggerReadingPayload {
  email: string;
  name: string;
  sessionId: string;
  purchasedAt: string;
  lineItems: TriggerReadingLineItem[];
}

const FULFILLMENT_ENV_KEYS = [
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

type FulfillmentEnvKey = (typeof FULFILLMENT_ENV_KEYS)[number];

let cachedFulfillmentEnv: Record<FulfillmentEnvKey, string> | null = null;

function firstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function assignEnvValue(
  bucket: Record<string, string>,
  key: FulfillmentEnvKey,
  value?: string
) {
  if (!value) return;
  if (!process.env[key]) {
    process.env[key] = value;
  }
  if (process.env[key]) {
    bucket[key] = process.env[key] as string;
  }
}

function resolveSection(blob: Record<string, any> | undefined | null, key: string) {
  if (!blob || typeof blob !== 'object') return undefined;
  const candidates = [
    blob[key],
    blob?.services?.[key],
    blob?.integrations?.[key],
    blob?.automation?.[key],
    blob?.infrastructure?.[key],
    blob?.fulfillment?.[key],
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') {
      return candidate as Record<string, any>;
    }
  }
  return undefined;
}

async function ensureFulfillmentEnv(): Promise<Record<FulfillmentEnvKey, string>> {
  if (cachedFulfillmentEnv) {
    return { ...cachedFulfillmentEnv };
  }

  const bucket: Record<FulfillmentEnvKey, string> = {} as Record<FulfillmentEnvKey, string>;

  try {
    const config = await getConfig();
    const gmail = resolveSection(config, 'gmail') || resolveSection(config, 'google');
    const resend = resolveSection(config, 'resend') || resolveSection(config, 'email');
    const notion = resolveSection(config, 'notion');
    const sheets =
      resolveSection(config, 'sheets') ||
      resolveSection(config, 'googleDrive') ||
      resolveSection(config, 'fulfillment');

    if (gmail) {
      assignEnvValue(
        bucket,
        'GOOGLE_CLIENT_EMAIL',
        firstString(
          gmail.clientEmail,
          gmail.client_email,
          gmail.serviceAccountEmail,
          gmail.service_account_email,
          gmail.email
        )
      );
      assignEnvValue(
        bucket,
        'GOOGLE_KEY_URL',
        firstString(gmail.keyUrl, gmail.key_url, gmail.privateKeyUrl, gmail.private_key_url)
      );
      assignEnvValue(
        bucket,
        'FETCH_PASS',
        firstString(gmail.fetchPass, gmail.fetch_pass, gmail.password, gmail.secret)
      );
    }

    if (resend) {
      assignEnvValue(
        bucket,
        'RESEND_API_KEY',
        firstString(resend.apiKey, resend.api_key, resend.key, resend.token)
      );
      assignEnvValue(
        bucket,
        'RESEND_FROM_EMAIL',
        firstString(resend.fromEmail, resend.from_email, resend.senderEmail, resend.sender_email)
      );
      assignEnvValue(
        bucket,
        'RESEND_FROM_NAME',
        firstString(resend.fromName, resend.from_name, resend.senderName, resend.sender_name)
      );
    }

    if (notion) {
      const token = firstString(notion.token, notion.apiKey, notion.key, notion.secret);
      assignEnvValue(bucket, 'NOTION_TOKEN', token);
      assignEnvValue(bucket, 'NOTION_API_KEY', token);
      assignEnvValue(
        bucket,
        'FULFILLMENT_NOTION_DB_ID',
        firstString(
          notion.fulfillmentDatabaseId,
          notion.fulfillmentDbId,
          notion.fulfillmentDb,
          notion.fulfillment_db_id,
          notion.databaseId,
          notion.database_id,
          notion.ordersDb,
          notion.ordersDbId
        )
      );
    }

    if (sheets) {
      assignEnvValue(
        bucket,
        'FULFILLMENT_SHEET_ID',
        firstString(
          sheets.fulfillmentSheetId,
          sheets.fulfillment_sheet_id,
          sheets.sheetId,
          sheets.sheet_id,
          sheets.fulfillmentSheet
        )
      );
      assignEnvValue(
        bucket,
        'FULFILLMENT_DRIVE_ROOT_ID',
        firstString(
          sheets.driveRootId,
          sheets.drive_root_id,
          sheets.driveRoot,
          sheets.rootFolderId,
          sheets.root_folder_id
        )
      );
      assignEnvValue(
        bucket,
        'FULFILLMENT_BLUEPRINT_TEMPLATE_ID',
        firstString(
          sheets.blueprintTemplateId,
          sheets.blueprint_template_id,
          sheets.templates?.blueprint,
          sheets.blueprintTemplate
        )
      );
      assignEnvValue(
        bucket,
        'FULFILLMENT_SCHEDULE_DAILY_TEMPLATE_ID',
        firstString(
          sheets.schedule?.daily,
          sheets.schedule_daily_template_id,
          sheets.scheduleTemplates?.daily,
          sheets.dailyScheduleTemplateId
        )
      );
      assignEnvValue(
        bucket,
        'FULFILLMENT_SCHEDULE_WEEKLY_TEMPLATE_ID',
        firstString(
          sheets.schedule?.weekly,
          sheets.schedule_weekly_template_id,
          sheets.scheduleTemplates?.weekly,
          sheets.weeklyScheduleTemplateId
        )
      );
      assignEnvValue(
        bucket,
        'FULFILLMENT_SCHEDULE_MONTHLY_TEMPLATE_ID',
        firstString(
          sheets.schedule?.monthly,
          sheets.schedule_monthly_template_id,
          sheets.scheduleTemplates?.monthly,
          sheets.monthlyScheduleTemplateId
        )
      );
    }
  } catch (err) {
    console.warn('[reading.trigger] Unable to load fulfillment config from KV', err);
  }

  for (const key of FULFILLMENT_ENV_KEYS) {
    if (process.env[key]) {
      bucket[key] = process.env[key] as string;
    }
  }

  cachedFulfillmentEnv = bucket;
  return { ...bucket };
}

function describeRecord(record: FulfillmentRecord) {
  const outputs = record.outputs?.length ?? 0;
  return {
    email: record.intake.email,
    tier: record.intake.tier,
    fulfillmentType: record.intake.fulfillmentType,
    outputs,
    hasBlueprint: Boolean(record.blueprint?.docUrl),
    hasSchedule: Boolean(record.schedule?.scheduleFolderUrl),
    hasIcons: Boolean(record.icons?.bundleFolderUrl),
  };
}

async function syncBrain(record: FulfillmentRecord) {
  const friendlyTier = record.intake.tier.toUpperCase();
  const displayName = record.intake.customer?.name || record.intake.email;
  const summaryOutputs = record.outputs?.map((output) => ({
    label: output.label,
    url: output.url,
    type: output.type,
  }));
  try {
    await updateBrain(
      {
        message: `✨ Delivered ${friendlyTier} reading for ${displayName}`,
        tiers: [record.intake.tier],
        updates: {
          fulfillment: {
            lastDeliveredAt: new Date().toISOString(),
            lastCustomer: displayName,
            lastEmail: record.intake.email,
            lastTier: record.intake.tier,
            outputs: summaryOutputs,
          },
        },
      },
      'fulfillment'
    );
    console.info('[reading.trigger] Brain sync complete', {
      email: record.intake.email,
      tier: record.intake.tier,
    });
  } catch (err) {
    console.warn('[reading.trigger] Brain sync failed', err);
  }
}

function resolveTier(metadata: TriggerReadingLineItem['metadata'], productId?: string | null) {
  const metadataTier = parseTier(firstMetadataValue(metadata, TIER_KEYS as readonly TierKey[]));
  const mappedTier = resolveTierFromProduct(productId);
  return metadataTier || mappedTier;
}

function isAddon(metadata: TriggerReadingLineItem['metadata']): boolean {
  const raw = firstMetadataValue(metadata, ADDON_KEYS as readonly AddOnKey[]);
  return Boolean(parseBoolean(raw));
}

// TODO: handle subscription renewals (invoices) so repeat deliveries run automatically.
export async function triggerReading(payload: TriggerReadingPayload): Promise<FulfillmentRecord[]> {
  if (!payload.sessionId) {
    throw new Error('triggerReading requires a Stripe checkout session id');
  }

  console.info('[reading.trigger] Received checkout fulfillment request', {
    sessionId: payload.sessionId,
    email: payload.email,
    lineItems: payload.lineItems?.length || 0,
  });
  const fulfillmentEnv = await ensureFulfillmentEnv();
  const records: FulfillmentRecord[] = [];
  const lineItems = payload.lineItems || [];

  for (const item of lineItems) {
    const tier = resolveTier(item.metadata, item.productId);
    const addon = isAddon(item.metadata);
    const lineContext = {
      sessionId: payload.sessionId,
      productId: item.productId,
      priceId: item.priceId,
      tier,
      email: payload.email,
      addon,
    };

    if (addon) {
      console.info('[reading.trigger] Skipping add-on line item', lineContext);
      continue;
    }

    if (!tier) {
      console.warn('[reading.trigger] Unable to map product to reading tier', {
        ...lineContext,
        description: item.description,
      });
      continue;
    }

    const start = Date.now();
    try {
      console.info('[reading.trigger] Launching fulfillment pipeline', lineContext);
      const record = await runOrder(
        { kind: 'stripe-session', sessionId: payload.sessionId, productId: item.productId, tierHint: tier },
        {
          env: fulfillmentEnv,
          order: {
            tier,
            productId: item.productId,
            priceId: item.priceId,
            description: item.description,
            isAddon: addon,
            quantity: item.quantity,
          },
        }
      );
      const durationMs = Date.now() - start;
      console.info('[reading.trigger] Fulfillment pipeline complete', {
        ...lineContext,
        durationMs,
        summary: describeRecord(record),
      });
      await syncBrain(record);
      records.push(record);
    } catch (err) {
      console.error('[reading.trigger] Fulfillment pipeline failed', {
        ...lineContext,
        error: err instanceof Error ? err.message : err,
      });
      throw err;
    }
  }

  if (!records.length) {
    console.warn('[reading.trigger] No qualifying soul reading line items found', {
      sessionId: payload.sessionId,
      lineItems: lineItems.length,
    });
  }

  return records;
}
