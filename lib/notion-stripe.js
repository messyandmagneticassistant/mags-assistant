import { notion } from './notion.js';
import { env } from './env.js';

const schema = [
  { name: 'Name', type: 'title', def: { title: {} } },
  { name: 'Description', type: 'rich_text', def: { rich_text: {} } },
  {
    name: 'Type',
    type: 'select',
    def: { select: { options: [{ name: 'one-time' }, { name: 'recurring' }, { name: 'donation' }] } },
  },
  { name: 'Price', type: 'number', def: { number: { format: 'dollar' } } },
  {
    name: 'Currency',
    type: 'select',
    def: { select: { options: [{ name: 'USD' }, { name: 'EUR' }, { name: 'GBP' }] } },
  },
  {
    name: 'Interval',
    type: 'select',
    def: { select: { options: [{ name: 'day' }, { name: 'week' }, { name: 'month' }, { name: 'year' }] } },
  },
  { name: 'Active', type: 'checkbox', def: { checkbox: {} } },
  { name: 'Statement Descriptor', type: 'rich_text', def: { rich_text: {} } },
  {
    name: 'Tax Behavior',
    type: 'select',
    def: { select: { options: [{ name: 'inclusive' }, { name: 'exclusive' }, { name: 'unspecified' }] } },
  },
  { name: 'Tax Code', type: 'rich_text', def: { rich_text: {} } },
  { name: 'Metadata', type: 'rich_text', def: { rich_text: {} } },
  { name: 'Image Folder', type: 'rich_text', def: { rich_text: {} } },
  { name: 'Stripe Product ID', type: 'rich_text', def: { rich_text: {} } },
  { name: 'Stripe Price ID', type: 'rich_text', def: { rich_text: {} } },
  { name: 'Date Updated', type: 'date', def: { date: {} } },
  {
    name: 'Status',
    type: 'select',
    def: {
      select: {
        options: [
          { name: 'To Do' },
          { name: 'In Progress' },
          { name: 'Ready to Add' },
          { name: 'Added in Stripe' },
          { name: 'Needs Edit' },
        ],
      },
    },
  },
];

function findProp(props, name) {
  if (props[name]) return { key: name, prop: props[name] };
  const fixed = `${name} (fixed)`;
  if (props[fixed]) return { key: fixed, prop: props[fixed] };
  return { key: null, prop: null };
}

function getText(prop) {
  return prop?.rich_text?.[0]?.plain_text || '';
}

export async function ensureStripeSchema() {
  const databaseId = env.NOTION_STRIPE_DB_ID;
  if (!databaseId) throw new Error('Missing NOTION_STRIPE_DB_ID');
  const db = await notion.databases.retrieve({ database_id: databaseId });
  const props = db.properties || {};
  const created = [];
  const changed = [];

  for (const s of schema) {
    const existing = props[s.name];
    if (!existing) {
      await notion.databases.update({
        database_id: databaseId,
        properties: { [s.name]: s.def },
      });
      created.push(s.name);
    } else if (existing.type !== s.type) {
      const legacyName = `${s.name} (legacy)`;
      await notion.databases.update({
        database_id: databaseId,
        properties: { [existing.id]: { name: legacyName } },
      });
      const fixedName = `${s.name} (fixed)`;
      await notion.databases.update({
        database_id: databaseId,
        properties: { [fixedName]: s.def },
      });
      changed.push(s.name);
    }
  }

  return { createdProperties: created, changedProperties: changed };
}

export async function backfillDefaults() {
  const databaseId = env.NOTION_STRIPE_DB_ID;
  if (!databaseId) throw new Error('Missing NOTION_STRIPE_DB_ID');

  const stats = { pages: 0, currency: 0, active: 0, status: 0, type: 0, dateUpdated: 0 };
  let cursor = undefined;

  while (true) {
    const res = await notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      start_cursor: cursor,
    });
    for (const page of res.results) {
      const p = page.properties || {};
      const updates = {};

      const { key: currencyKey } = findProp(p, 'Currency');
      const { key: activeKey, prop: activeProp } = findProp(p, 'Active');
      const { key: statusKey } = findProp(p, 'Status');
      const { key: typeKey } = findProp(p, 'Type');
      const { key: intervalKey } = findProp(p, 'Interval');
      const { key: productKey } = findProp(p, 'Stripe Product ID');
      const { key: priceKey } = findProp(p, 'Stripe Price ID');
      const { key: dateKey } = findProp(p, 'Date Updated');

      if (currencyKey && !p[currencyKey]?.select) {
        updates[currencyKey] = { select: { name: 'USD' } };
        stats.currency++;
      }
      if (activeKey && activeProp && activeProp.checkbox === undefined) {
        updates[activeKey] = { checkbox: true };
        stats.active++;
      }
      const hasStripe = getText(p[productKey]) || getText(p[priceKey]);
      if (statusKey && !p[statusKey]?.select && hasStripe) {
        updates[statusKey] = { select: { name: 'Added in Stripe' } };
        stats.status++;
      }
      const intervalVal = p[intervalKey]?.select?.name;
      if (typeKey && !p[typeKey]?.select) {
        updates[typeKey] = {
          select: { name: intervalVal ? 'recurring' : 'one-time' },
        };
        stats.type++;
      }
      if (dateKey && !p[dateKey]?.date?.start) {
        updates[dateKey] = { date: { start: new Date().toISOString() } };
        stats.dateUpdated++;
      }

      if (Object.keys(updates).length) {
        await notion.pages.update({ page_id: page.id, properties: updates });
        stats.pages++;
      }
    }
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  return { updated: stats };
}

export { schema as stripeSchema };
