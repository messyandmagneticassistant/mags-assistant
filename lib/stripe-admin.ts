import { getStripe } from './clients/stripe.js';

export async function getAllStripeProducts() {
  const stripe = await getStripe();
  const items: any[] = [];
  let starting_after: string | undefined;
  do {
    const res = await stripe.products.list({ limit: 100, starting_after });
    items.push(...res.data);
    starting_after = res.has_more ? res.data[res.data.length - 1].id : undefined;
  } while (starting_after);
  return items;
}

export async function getAllStripePrices() {
  const stripe = await getStripe();
  const items: any[] = [];
  let starting_after: string | undefined;
  do {
    const res = await stripe.prices.list({ limit: 100, starting_after });
    items.push(...res.data);
    starting_after = res.has_more ? res.data[res.data.length - 1].id : undefined;
  } while (starting_after);
  return items;
}

export function validateStatementDescriptor(str: string) {
  return str
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .slice(0, 22)
    .trim();
}

export async function ensureProduct(spec: {
  id?: string;
  name: string;
  description?: string;
  active?: boolean;
  statement_descriptor?: string;
  metadata?: Record<string, any>;
  tax_code?: string;
}) {
  const stripe = await getStripe();
  let product: any = null;
  if (spec.id) {
    try {
      product = await stripe.products.retrieve(spec.id);
    } catch {}
  }
  if (!product) {
    const list = await stripe.products.list({ limit: 100 });
    product = list.data.find((p: any) => p.name === spec.name) || null;
  }
  if (!product) {
    product = await stripe.products.create({
      name: spec.name,
      description: spec.description,
      active: spec.active,
      statement_descriptor: spec.statement_descriptor,
      metadata: spec.metadata,
      tax_code: spec.tax_code,
    });
  } else {
    await stripe.products.update(product.id, {
      name: spec.name,
      description: spec.description,
      active: spec.active,
      statement_descriptor: spec.statement_descriptor,
      metadata: spec.metadata,
      tax_code: spec.tax_code,
    });
    product = await stripe.products.retrieve(product.id);
  }
  return product;
}

export async function ensurePrice(
  productId: string,
  priceSpec: {
    unit_amount: number;
    currency: string;
    interval?: string;
    tax_behavior?: string;
  }
) {
  const stripe = await getStripe();
  const list = await stripe.prices.list({ product: productId, limit: 100 });
  const existing = list.data.find(
    (p: any) =>
      p.unit_amount === priceSpec.unit_amount &&
      p.currency === priceSpec.currency &&
      ((priceSpec.interval && p.recurring?.interval === priceSpec.interval) ||
        (!priceSpec.interval && !p.recurring)) &&
      (p.tax_behavior === priceSpec.tax_behavior ||
        (!p.tax_behavior && !priceSpec.tax_behavior))
  );
  if (existing) return existing;
  const params: any = {
    product: productId,
    unit_amount: priceSpec.unit_amount,
    currency: priceSpec.currency,
  };
  if (priceSpec.interval) params.recurring = { interval: priceSpec.interval };
  if (priceSpec.tax_behavior) params.tax_behavior = priceSpec.tax_behavior;
  return await stripe.prices.create(params);
}

export async function setDefaultPrice(productId: string, priceId: string) {
  const stripe = await getStripe();
  const prod = await stripe.products.retrieve(productId);
  if (prod.default_price !== priceId) {
    await stripe.products.update(productId, { default_price: priceId });
  }
}

export async function attachImage(productId: string, file: string | Buffer) {
  const stripe = await getStripe();
  let data: Buffer;
  let filename = 'image.jpg';
  if (typeof file === 'string') {
    const res = await fetch(file);
    const arr = await res.arrayBuffer();
    data = Buffer.from(arr);
    const parts = file.split('/');
    filename = parts[parts.length - 1] || filename;
  } else {
    data = file;
  }
  const uploaded = await stripe.files.create({
    purpose: 'product_image',
    file: { data, name: filename, type: 'application/octet-stream' } as any,
  });
  await stripe.products.update(productId, { images: [uploaded.id] });
  return uploaded;
}
