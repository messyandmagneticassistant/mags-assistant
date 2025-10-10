import Stripe from 'stripe';

export interface ReadingPayload {
  email: string;
  name: string;
  metadata: Record<string, string | boolean | null>;
  sessionId: string;
  purchasedAt: string;
}

const normalizeBoolean = (value: string | null | undefined): boolean | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return undefined;
};

const pickTier = (metadata: Stripe.Metadata | null | undefined): string | null => {
  if (!metadata) return null;
  return (
    metadata.reading_tier ??
    metadata.tier ??
    metadata.level ??
    metadata['reading-tier'] ??
    null
  );
};

const mergeMetadata = (
  priceMetadata: Stripe.Metadata | null | undefined,
  productMetadata: Stripe.Metadata | null | undefined
): Stripe.Metadata => {
  return {
    ...(priceMetadata ?? {}),
    ...(productMetadata ?? {}),
  };
};

export function parseReadingFromSession(
  session: Stripe.Checkout.Session,
  lineItems: Stripe.LineItem[]
): ReadingPayload[] {
  const email =
    session.customer_details?.email ??
    (typeof session.customer_email === 'string' ? session.customer_email : '') ??
    '';
  const name = session.customer_details?.name ?? '';
  const purchasedAt = new Date(
    ((session.created ?? Math.floor(Date.now() / 1000)) as number) * 1000
  ).toISOString();
  const sessionId = session.id ?? '';

  return lineItems.map((item) => {
    const price = item.price;
    const product = price?.product && typeof price.product !== 'string' ? price.product : undefined;
    const mergedMetadata = mergeMetadata(price?.metadata, product?.metadata);

    const metadata: Record<string, string | boolean | null> = {};

    const tier = pickTier(mergedMetadata);
    if (tier) metadata.tier = tier;

    const isAddonValue =
      mergedMetadata.is_addon ??
      mergedMetadata.addon ??
      mergedMetadata.isAddon ??
      mergedMetadata['is-addon'];
    const parsedIsAddon = normalizeBoolean(isAddonValue);
    if (parsedIsAddon !== undefined) {
      metadata.is_addon = parsedIsAddon;
    } else if (!('is_addon' in metadata)) {
      metadata.is_addon = false;
    }

    const childFriendlyValue =
      mergedMetadata.child_friendly ??
      mergedMetadata.childFriendly ??
      mergedMetadata['child-friendly'];
    const parsedChildFriendly = normalizeBoolean(childFriendlyValue);
    if (parsedChildFriendly !== undefined) {
      metadata.child_friendly = parsedChildFriendly;
    } else if (!('child_friendly' in metadata)) {
      metadata.child_friendly = false;
    }

    for (const [key, value] of Object.entries(mergedMetadata)) {
      if (
        [
          'reading_tier',
          'tier',
          'level',
          'reading-tier',
          'is_addon',
          'addon',
          'isAddon',
          'is-addon',
          'child_friendly',
          'childFriendly',
          'child-friendly',
        ].includes(key)
      ) {
        continue;
      }
      if (value !== null && value !== undefined) {
        metadata[key] = value;
      }
    }

    return {
      email,
      name,
      metadata,
      sessionId,
      purchasedAt,
    };
  });
}
