export interface Product {
  id: string;
  lookup_key: string;
  name: string;
  priceId: string;
  amount: number; // in cents
}

export const catalog: Product[] = [
  {
    id: "prod_soul_blueprint",
    lookup_key: "soul_blueprint",
    name: "Soul Blueprint",
    priceId: "price_soul_blueprint",
    amount: 9900,
  },
  {
    id: "prod_donation",
    lookup_key: "donation",
    name: "Support Donation",
    priceId: "price_donation",
    amount: 5000,
  },
];

export function findProduct(key: string): Product | undefined {
  return catalog.find(
    (p) => p.id === key || p.lookup_key === key || p.priceId === key
  );
}
