export type ReadingTier = 'mini' | 'lite' | 'full';

export interface ProductDefinition {
  /**
   * Internal tier identifier used by the fulfillment pipeline.
   */
  tier: ReadingTier;
  /**
   * Human-readable label so logs are easier to read while this stays in place.
   */
  label: string;
}

/**
 * Temporary mapping from Stripe product identifiers to the internal
 * fulfillment tiers. These identifiers are placeholders – update them with the
 * production product IDs once they are finalized in Stripe.
 */
export const PRODUCT_MAP: Record<string, ProductDefinition> = {
  prod_full_soul_blueprint: {
    tier: 'full',
    label: 'Full Soul Blueprint',
  },
  prod_lite_soul_blueprint: {
    tier: 'lite',
    label: 'Lite Soul Blueprint',
  },
  prod_mini_soul_blueprint: {
    tier: 'mini',
    label: 'Mini Soul Reading',
  },
};

export function resolveTierFromProduct(productId?: string | null): ReadingTier | undefined {
  if (!productId) return undefined;
  const entry = PRODUCT_MAP[productId];
  return entry?.tier;
}
