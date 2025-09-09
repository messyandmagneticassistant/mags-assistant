import Stripe from 'stripe';
import { catalog, ProductInfo, PriceInfo } from './products';

/**
 * Placeholder hook for Maggie's future market analysis. Given a price, return a
 * suggested unit amount based on external signals (average market price,
 * demand, etc). Returning `null` means no change suggested.
 */
export function marketAdjust(_price: PriceInfo): { suggested: number } | null {
  // TODO: implement dynamic market-based pricing adjustments
  return null;
}

export interface ReconcileSummary {
  created: string[];
  updated: string[];
  missing: string[];
  orphaned: string[];
}

function env(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env[key]) return process.env[key];
  return undefined;
}

export async function reconcile(): Promise<ReconcileSummary> {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_SECRET_KEY missing');
  const stripe = new Stripe(key, { apiVersion: '2023-10-16' });

  const stripeProducts = await stripe.products.list({ limit: 100 });
  const stripePrices = await stripe.prices.list({ limit: 100 });

  const productMap = new Map<string, Stripe.Product>();
  for (const p of stripeProducts.data) {
    const lookup = (p.lookup_key as string) || p.id;
    productMap.set(lookup, p);
  }
  const priceMap = new Map<string, Stripe.Price>();
  for (const pr of stripePrices.data) {
    const lookup = (pr.lookup_key as string) || pr.id;
    priceMap.set(lookup, pr);
  }

  const summary: ReconcileSummary = { created: [], updated: [], missing: [], orphaned: [] };

  for (const prod of catalog) {
    const sp = productMap.get(prod.lookup_key) || productMap.get(prod.id);
    if (!sp) {
      summary.missing.push(prod.lookup_key);
      continue;
    }
    if (sp.name !== prod.name) summary.updated.push(prod.lookup_key);

    for (const price of prod.prices) {
      const spPrice = priceMap.get(price.lookup_key) || priceMap.get(price.id);
      if (!spPrice) {
        summary.missing.push(price.lookup_key);
        continue;
      }
      const adj = marketAdjust(price);
      if (adj && spPrice.unit_amount !== adj.suggested) {
        summary.updated.push(price.lookup_key);
        continue;
      }
      if (spPrice.unit_amount !== price.unit_amount) summary.updated.push(price.lookup_key);
    }
  }

  for (const [lookup, sp] of productMap) {
    const lp = catalog.find((p) => p.lookup_key === lookup || p.id === sp.id);
    if (!lp) summary.orphaned.push(lookup);
  }
  for (const [lookup, pr] of priceMap) {
    const lp = catalog.some((p) => p.prices.some((pp) => pp.lookup_key === lookup || pp.id === pr.id));
    if (!lp) summary.orphaned.push(lookup);
  }

  return summary;
}

if (require.main === module) {
  reconcile().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

