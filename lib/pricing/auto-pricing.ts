import pricing from '../../fixtures/pricing-fixture.json';

export type Tier = 'mini' | 'lite' | 'full' | 'realignment';

export interface PricingOptions {
  tier: Tier;
  count?: number; // number of people
  addons?: string[]; // addon keys e.g. child, magnet
  depth?: 'base' | 'deep';
  system?: boolean; // include rhythm system
}

export interface PriceBreakdown {
  total: number;
  perPerson: number;
  breakdown: {
    base: number;
    addons: Record<string, number>;
    discounts: Record<string, number>;
  };
}

function getAddonPrice(key: string): number {
  const addon: any = (pricing as any).addons?.[key];
  if (!addon) return 0;
  if (addon.promo !== undefined) return addon.promo;
  return addon.price ?? 0;
}

/**
 * Estimate price for a reading tier with optional modifiers.
 * The algorithm pulls baseline values from pricing-fixture.json
 * and applies family, depth and promotion logic.
 */
export function estimatePrice(opts: PricingOptions): PriceBreakdown {
  const count = opts.count && opts.count > 0 ? opts.count : 1;
  const baseTier: any = (pricing as any).tiers[opts.tier];
  let base = baseTier?.base ?? 0;

  // depth modifier
  const depthMods: any = (pricing as any).depthModifiers || {};
  const depthKey = opts.depth || 'base';
  base *= depthMods[depthKey] ?? 1;

  // system inclusion cost
  if (opts.system) {
    const sysMods: any = (pricing as any).systemModifiers || {};
    base += sysMods.include ?? 0;
  }

  const breakdownAddons: Record<string, number> = {};
  const breakdownDiscounts: Record<string, number> = {};

  // family pricing
  let total = base;
  if (count > 1) {
    const family: any = (pricing as any).family?.[opts.tier];
    const addPrice = family?.additional ?? base;
    total += addPrice * (count - 1);
  }

  // addons
  for (const addon of opts.addons || []) {
    if (addon === 'magnet') {
      breakdownDiscounts['magnetBundle'] = -((pricing as any).addons?.magnetBundle?.discount ?? 0);
      total += breakdownDiscounts['magnetBundle'];
    } else {
      const p = getAddonPrice(addon) * count;
      breakdownAddons[addon] = p;
      total += p;
    }
  }

  const perPerson = total / count;
  return { total, perPerson, breakdown: { base, addons: breakdownAddons, discounts: breakdownDiscounts } };
}

export default estimatePrice;
