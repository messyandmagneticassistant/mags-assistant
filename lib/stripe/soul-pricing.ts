import { estimatePrice, Tier } from '../pricing/auto-pricing';

interface SoulProductInfo {
  tier: Tier;
  price?: number;
  manualPrice?: boolean;
}

export function getSoulProductPrice(info: SoulProductInfo): { price: number; expected: number } {
  const expected = estimatePrice({ tier: info.tier }).total;
  const price = info.manualPrice && info.price !== undefined ? info.price : expected;
  return { price, expected };
}

export { estimatePrice, Tier };
