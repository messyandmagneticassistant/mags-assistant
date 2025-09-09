import Stripe from "stripe";
import { DEFAULT_PRODUCTS } from "../../config/products";

const sk = process.env.STRIPE_SECRET_KEY!;
const stripe = new Stripe(sk, { apiVersion: "2024-06-20" });

async function upsertProduct(key: string, name: string, description: string) {
  const id = `prod_${key}`;
  let product = await stripe.products.retrieve(id).catch(() => null);
  if (!product) product = await stripe.products.create({ id, name, description, active: true });
  else if (product.name !== name || product.description !== description || !product.active)
    product = await stripe.products.update(id, { name, description, active: true });
  return product;
}

async function ensurePrice(productId: string, usd: number) {
  if (usd <= 0) return null; // donation uses custom amount in checkout
  const unit_amount = Math.round(usd * 100);
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
  const found = prices.data.find(p => p.unit_amount === unit_amount && p.currency === "usd");
  if (found) return found;
  // deactivate old prices so we have a single live price
  await Promise.all(prices.data.map(p => stripe.prices.update(p.id, { active: false })));
  return await stripe.prices.create({ product: productId, currency: "usd", unit_amount });
}

async function main() {
  // Optional dynamic override from KV (worker will manage). If not present, use defaults.
  // Codex: if you can easily read `pricing:live` from Worker KV, merge overrides here.

  for (const p of DEFAULT_PRODUCTS) {
    const prod = await upsertProduct(p.key, p.name, p.description);
    const price = await ensurePrice(prod.id, p.defaultPriceUsd);
    console.log(`✅ ${p.name} -> ${prod.id}${price ? " @ $" + (price.unit_amount! / 100) : " (variable)"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
