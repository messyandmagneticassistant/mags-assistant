import { env } from './env.js';
import { fetchDesiredStripeProducts, DesiredProduct } from './notion';
import {
  getAllStripeProducts,
  getAllStripePrices,
  ensureProduct,
  ensurePrice,
  setDefaultPrice,
  attachImage,
} from './stripe-admin';
import { findImageForProduct } from './images';

export interface PlanItem {
  name: string;
  id?: string;
  actions: string[];
  current?: any;
  desired: DesiredProduct;
}

export async function planStripeSync() {
  const dbId = env.NOTION_STRIPE_DB_ID;
  if (!dbId) throw new Error('NOTION_STRIPE_DB_ID missing');
  const desired = await fetchDesiredStripeProducts(dbId);
  const stripeProducts = await getAllStripeProducts();
  const stripePrices = await getAllStripePrices();
  const items: PlanItem[] = [];
  for (const d of desired) {
    const current = d.stripeProductId
      ? stripeProducts.find((p: any) => p.id === d.stripeProductId)
      : stripeProducts.find((p: any) => p.name === d.name);
    const actions: string[] = [];
    if (!current) {
      actions.push('CREATE_PRODUCT', 'CREATE_PRICE', 'ATTACH_IMAGE');
    } else {
      const needsUpdate =
        current.name !== d.name ||
        (current.description || '') !== d.description ||
        current.active !== d.active ||
        current.statement_descriptor !== d.statement_descriptor ||
        (d.tax_code && current.tax_code !== d.tax_code) ||
        JSON.stringify(current.metadata || {}) !== JSON.stringify(d.metadata || {});
      if (needsUpdate) actions.push('UPDATE_PRODUCT');
      const prices = stripePrices.filter((p: any) => p.product === current.id);
      const matchPrice = prices.find(
        (p: any) =>
          p.unit_amount === d.unit_amount &&
          p.currency === d.currency &&
          ((d.interval && p.recurring?.interval === d.interval) ||
            (!d.interval && !p.recurring)) &&
          (p.tax_behavior === d.tax_behavior || (!p.tax_behavior && !d.tax_behavior))
      );
      if (!matchPrice) actions.push('CREATE_PRICE');
      if (!current.images || !current.images.length) actions.push('ATTACH_IMAGE');
    }
    items.push({ name: d.name, id: current?.id, actions, current, desired: d });
  }
  const summary = {
    toCreate: items.filter((i) => i.actions.includes('CREATE_PRODUCT')).length,
    toUpdate: items.filter((i) => i.actions.includes('UPDATE_PRODUCT')).length,
    toPriceCreate: items.filter((i) => i.actions.includes('CREATE_PRICE')).length,
    toImageAttach: items.filter((i) => i.actions.includes('ATTACH_IMAGE')).length,
  };
  return { ok: true, summary, items };
}

export async function runStripeSync(opts: { dry?: boolean; names?: string[] } = {}) {
  const plan = await planStripeSync();
  if (opts.dry) return plan;
  for (const item of plan.items) {
    if (opts.names && !opts.names.includes(item.name)) continue;
    const d = item.desired;
    const product = await ensureProduct({
      id: d.stripeProductId || item.id,
      name: d.name,
      description: d.description,
      active: d.active,
      statement_descriptor: d.statement_descriptor,
      metadata: d.metadata,
      tax_code: d.tax_code,
    });
    const price = await ensurePrice(product.id, {
      unit_amount: d.unit_amount,
      currency: d.currency,
      interval: d.type === 'recurring' ? d.interval : undefined,
      tax_behavior: d.tax_behavior === 'unspecified' ? undefined : d.tax_behavior,
    });
    await setDefaultPrice(product.id, price.id);
    const img = await findImageForProduct({
      name: d.name,
      imageFolder: d.imageFolder,
      stripeProductId: product.id,
    });
    if (img) {
      await attachImage(product.id, img);
    }
  }
  return plan;
}
