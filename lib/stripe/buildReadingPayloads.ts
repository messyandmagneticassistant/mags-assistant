import type Stripe from 'stripe';

import { TriggerReadingPayload } from './reading';

const TIER_KEYS = ['reading_tier', 'tier', 'level', 'reading-tier'] as const;
const ADDON_KEYS = ['is_addon', 'addon', 'isAddon', 'is-addon'] as const;
const CHILD_KEYS = ['child_friendly', 'childFriendly', 'child-friendly'] as const;
const SPECIAL_METADATA_KEYS = new Set<string>([
  ...TIER_KEYS,
  ...ADDON_KEYS,
  ...CHILD_KEYS,
]);

function parseBoolean(value: string | boolean | null | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return undefined;
}

function parseTier(value: string | null | undefined): 'full' | 'lite' | 'mini' | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'full' || normalized === 'lite' || normalized === 'mini') {
    return normalized;
  }
  return null;
}

function getMetadataValue(
  metadata: Stripe.Metadata | null | undefined,
  keys: readonly string[]
): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined && value !== null && `${value}`.length > 0) {
      return value;
    }
  }
  return null;
}

export function buildReadingPayloads(
  session: Stripe.Checkout.Session,
  lineItems: Stripe.LineItem[]
): TriggerReadingPayload[] {
  const email =
    session.customer_details?.email ||
    (typeof session.customer_email === 'string' ? session.customer_email : '') ||
    '';
  const name = session.customer_details?.name || '';
  const purchasedAt = new Date(((session.created ?? Date.now() / 1000) as number) * 1000).toISOString();
  const sessionId = session.id ?? '';

  const payloads: TriggerReadingPayload[] = [];

  for (const item of lineItems) {
    const price = item.price;
    if (!price) {
      continue;
    }

    const product = price.product;
    const productMetadata =
      product && typeof product !== 'string' ? (product.metadata ?? {}) : ({} as Stripe.Metadata);
    const priceMetadata = price.metadata ?? ({} as Stripe.Metadata);

    const tierValue =
      parseTier(getMetadataValue(priceMetadata, TIER_KEYS)) ??
      parseTier(getMetadataValue(productMetadata, TIER_KEYS));

    if (!tierValue) {
      continue;
    }

    const rawIsAddon =
      getMetadataValue(priceMetadata, ADDON_KEYS) ?? getMetadataValue(productMetadata, ADDON_KEYS);
    const parsedIsAddon = parseBoolean(rawIsAddon);

    const rawChildFriendly =
      getMetadataValue(priceMetadata, CHILD_KEYS) ?? getMetadataValue(productMetadata, CHILD_KEYS);
    const parsedChildFriendly = parseBoolean(rawChildFriendly);

    const combinedMetadata = { ...productMetadata, ...priceMetadata } as Record<string, string>;

    const metadata: TriggerReadingPayload['metadata'] = {
      tier: tierValue,
      is_addon: parsedIsAddon ?? false,
    };

    if (parsedChildFriendly !== undefined) {
      metadata.child_friendly = parsedChildFriendly;
    }

    for (const [key, value] of Object.entries(combinedMetadata)) {
      if (SPECIAL_METADATA_KEYS.has(key)) {
        continue;
      }
      if (value !== null && value !== undefined && `${value}`.length > 0) {
        metadata[key] = value;
      }
    }

    payloads.push({
      email,
      name,
      metadata,
      sessionId,
      purchasedAt,
    });
  }

  return payloads;
}
