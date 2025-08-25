import { getStripe } from './clients/stripe';
import { getNotion } from './clients/notion';
import { getOpenAI } from './clients/openai';
import { requireEnv } from './env.js';

export type SyncMode = 'audit' | 'fix' | 'full';

const NOTION_FIELDS: Record<string, any> = {
  Description: { rich_text: {} },
  Type: { select: {} },
  'Billing Interval': { select: {} },
  Amount: { number: { format: 'number' } },
  Status: { status: {} },
  'Stripe Product ID': { rich_text: {} },
  'Stripe Price ID': { rich_text: {} },
  'Image URL': { url: {} },
  'Category/Tags': { multi_select: {} },
  Notes: { rich_text: {} },
};

async function ensureSchema(notion: any, dbId: string) {
  const db = await notion.databases.retrieve({ database_id: dbId });
  const update: any = { properties: {} };
  for (const [name, def] of Object.entries(NOTION_FIELDS)) {
    if (!db.properties[name]) {
      update.properties[name] = def;
    }
  }
  if (Object.keys(update.properties).length) {
    await notion.databases.update({ database_id: dbId, ...update });
  }
}

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

export async function audit() {
  const stripe = await getStripe();
  const notion = await getNotion();
  const dbId = requireEnv('PRODUCTS_DB_ID');
  await ensureSchema(notion, dbId);

  const stripeProducts = await stripe.products.list({ limit: 100, expand: ['data.default_price'] });
  const notionPages: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor });
    notionPages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  const notionById: Record<string, any> = {};
  const notionByName: Record<string, any> = {};
  for (const p of notionPages) {
    const name = p.properties?.Name?.title?.[0]?.plain_text ?? '';
    const pid = p.properties?.['Stripe Product ID']?.rich_text?.[0]?.plain_text ?? '';
    if (pid) notionById[pid] = p;
    if (name) notionByName[normalizeName(name)] = p;
  }

  const missingInNotion: any[] = [];
  const mismatches: any[] = [];
  for (const prod of stripeProducts.data) {
    const match = notionById[prod.id] || notionByName[normalizeName(prod.name)];
    if (!match) {
      missingInNotion.push({ id: prod.id, name: prod.name });
      continue;
    }
    const desc = match.properties?.Description?.rich_text?.[0]?.plain_text ?? '';
    if (desc !== (prod.description || '')) {
      mismatches.push({ id: prod.id, field: 'description', stripe: prod.description, notion: desc });
    }
  }

  const missingInStripe: any[] = [];
  for (const p of notionPages) {
    const pid = p.properties?.['Stripe Product ID']?.rich_text?.[0]?.plain_text;
    const name = p.properties?.Name?.title?.[0]?.plain_text ?? '';
    if (pid) continue;
    if (!stripeProducts.data.find((sp) => normalizeName(sp.name) === normalizeName(name))) {
      missingInStripe.push({ id: p.id, name });
    }
  }

  const duplicates: string[] = [];
  const seen: Record<string, number> = {};
  for (const p of notionPages) {
    const pid = p.properties?.['Stripe Product ID']?.rich_text?.[0]?.plain_text;
    if (pid) {
      seen[pid] = (seen[pid] || 0) + 1;
    }
  }
  for (const [pid, count] of Object.entries(seen)) {
    if (count > 1) duplicates.push(pid);
  }

  return { ok: true, report: { missingInStripe, missingInNotion, mismatches, duplicates } };
}

async function createOrUpdateImage(stripe: any, product: any, notion: any, pageId: string) {
  const notionUrl = product.properties?.['Image URL']?.url ?? '';
  const stripeImage = product.stripe?.images?.[0];
  if (!notionUrl && stripeImage) {
    await notion.pages.update({ page_id: pageId, properties: { 'Image URL': { url: stripeImage } } });
    return;
  }
  if (!notionUrl && !stripeImage && process.env.OPENAI_API_KEY) {
    const openai = getOpenAI();
    const img = await openai.images.generate({ prompt: 'pale pastels, thin cursive serif, florals, leaves, soft farmhouse aesthetic', n: 1, size: '512x512' });
    const url = img.data[0]?.url;
    if (url) {
      await stripe.products.update(product.stripe.id, { images: [url] });
      await notion.pages.update({ page_id: pageId, properties: { 'Image URL': { url } } });
    }
  }
}

async function createPrice(stripe: any, prodId: string, amount: number, interval?: string) {
  if (interval) {
    return stripe.prices.create({ product: prodId, unit_amount: amount, currency: 'usd', recurring: { interval } });
  }
  return stripe.prices.create({ product: prodId, unit_amount: amount, currency: 'usd' });
}

export async function fix(opts: { rowId?: string } = {}) {
  const stripe = await getStripe();
  const notion = await getNotion();
  const dbId = requireEnv('PRODUCTS_DB_ID');
  await ensureSchema(notion, dbId);
  const filter = opts.rowId ? { filter: { property: 'id', value: opts.rowId } } : {};
  const res = await notion.databases.query({ database_id: dbId });
  const pages = res.results as any[];
  const created: string[] = [];
  const updated: string[] = [];
  for (const p of pages) {
    if (opts.rowId && p.id !== opts.rowId) continue;
    const status = p.properties?.Status?.status?.name ?? '';
    const name = p.properties?.Name?.title?.[0]?.plain_text ?? '';
    const desc = p.properties?.Description?.rich_text?.[0]?.plain_text ?? '';
    const type = p.properties?.Type?.select?.name ?? '';
    const interval = p.properties?.['Billing Interval']?.select?.name ?? undefined;
    const amount = p.properties?.Amount?.number ?? 0;
    const prodId = p.properties?.['Stripe Product ID']?.rich_text?.[0]?.plain_text ?? '';
    const priceId = p.properties?.['Stripe Price ID']?.rich_text?.[0]?.plain_text ?? '';

    if (status === 'Ready to Add' && !prodId) {
      const prod = await stripe.products.create({ name, description: desc, metadata: { type, status } });
      const price = await createPrice(stripe, prod.id, amount, type === 'Recurring' ? interval : undefined);
      await stripe.products.update(prod.id, { default_price: price.id });
      await notion.pages.update({
        page_id: p.id,
        properties: {
          Status: { status: { name: 'Added in Stripe' } },
          'Stripe Product ID': { rich_text: [{ text: { content: prod.id } }] },
          'Stripe Price ID': { rich_text: [{ text: { content: price.id } }] },
        },
      });
      created.push(prod.id);
      await createOrUpdateImage(stripe, { stripe: prod, properties: p.properties }, notion, p.id);
    } else if (status === 'Needs Edit' && prodId) {
      await stripe.products.update(prodId, { name, description: desc, metadata: { type, status } });
      if (priceId) {
        const current = await stripe.prices.retrieve(priceId);
        if (current.unit_amount !== amount || (type === 'Recurring' && current.recurring?.interval !== interval)) {
          const price = await createPrice(stripe, prodId, amount, type === 'Recurring' ? interval : undefined);
          await stripe.products.update(prodId, { default_price: price.id });
          await stripe.prices.update(priceId, { active: false });
          await notion.pages.update({
            page_id: p.id,
            properties: { 'Stripe Price ID': { rich_text: [{ text: { content: price.id } }] }, Status: { status: { name: 'Added in Stripe' } } },
          });
        }
      }
      updated.push(prodId);
      await createOrUpdateImage(stripe, { stripe: { id: prodId, images: [] }, properties: p.properties }, notion, p.id);
    }
  }
  return { ok: true, created, updated };
}

export async function sync(opts: { mode: SyncMode; dry: boolean; row?: string }) {
  const { mode, dry, row } = opts;
  const auditRes = await audit();
  if (dry || mode === 'audit') {
    await logRun(mode, dry, auditRes);
    return auditRes;
  }
  const fixRes = await fix({ rowId: row });
  const result = { ...auditRes, ...fixRes };
  await logRun(mode, dry, result);
  return result;
}

async function logRun(mode: SyncMode, dry: boolean, result: any) {
  const runsDb = process.env.NOTION_DB_RUNS_ID;
  if (!runsDb) return;
  const notion = await getNotion();
  const created = Array.isArray(result.created) ? result.created.length : 0;
  const updated = Array.isArray(result.updated) ? result.updated.length : 0;
  try {
    await notion.pages.create({
      parent: { database_id: runsDb },
      properties: {
        Name: { title: [{ text: { content: `Stripe sync ${mode}` } }] },
        'Dry Run': { rich_text: [{ text: { content: dry ? 'yes' : 'no' } }] },
        Created: { number: created },
        Updated: { number: updated },
      },
    });
  } catch {
    // ignore logging failures
  }
}
