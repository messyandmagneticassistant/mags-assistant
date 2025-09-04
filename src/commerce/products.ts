export interface PriceInfo {
  id: string;
  lookup_key: string;
  unit_amount: number;
  currency: string;
  checkoutUrl?: string;
}

export interface ProductInfo {
  id: string;
  name: string;
  lookup_key: string;
  prices: PriceInfo[];
}

/**
 * In-repo catalog of Stripe products and prices.
 * lookup_key ties the entry to Stripe's lookup_key field.
 * Replace placeholder IDs with real ones as needed.
 */
export const catalog: ProductInfo[] = [
  {
    id: 'prod_placeholder',
    name: 'Soul Blueprint',
    lookup_key: 'soul_blueprint',
    prices: [
      {
        id: 'price_placeholder',
        lookup_key: 'soul_blueprint',
        unit_amount: 0,
        currency: 'usd',
        checkoutUrl: '#'
      }
    ]
  }
];

export function findProductByLookup(lookup: string): ProductInfo | undefined {
  return catalog.find((p) => p.lookup_key === lookup);
}

export function listOfferings() {
  return catalog.map((p) => ({
    id: p.id,
    name: p.name,
    lookup_key: p.lookup_key,
    prices: p.prices.map((pr) => ({
      id: pr.id,
      lookup_key: pr.lookup_key,
      unit_amount: pr.unit_amount,
      currency: pr.currency,
      checkoutUrl: pr.checkoutUrl,
    })),
  }));
}

