import { catalog, Product } from './products';

interface StripeProduct {
  id: string;
  name: string;
  lookup_key?: string;
  default_price?: { id: string; unit_amount?: number } | string | null;
}

function mapCatalogByKey() {
  const map = new Map<string, Product>();
  for (const p of catalog) {
    map.set(p.id, p);
    map.set(p.lookup_key, p);
    map.set(p.priceId, p);
  }
  return map;
}

export async function reconcile(): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');

  const resp = await fetch('https://api.stripe.com/v1/products?expand[]=data.default_price', {
    headers: { Authorization: `Bearer ${key}` },
  });
  const data = await resp.json();
  const existing: StripeProduct[] = data.data || [];

  const map = mapCatalogByKey();
  const seen = new Set<Product>();
  const missing: Product[] = [];
  const mismatched: any[] = [];

  for (const sp of existing) {
    const key = sp.lookup_key || sp.id;
    const local = key ? map.get(key) : undefined;
    if (local) {
      seen.add(local);
      const amt = typeof sp.default_price === 'object' && sp.default_price
        ? sp.default_price.unit_amount
        : undefined;
      if (amt !== undefined && amt !== local.amount) {
        mismatched.push({ lookup: key, stripe: amt, local: local.amount });
      }
    }
  }
  for (const p of catalog) {
    if (!seen.has(p)) missing.push(p);
  }
  const summary = { existing: existing.length, catalog: catalog.length, missing, mismatched };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (typeof require !== 'undefined' && require.main === module) {
  reconcile().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
