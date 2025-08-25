import { Client } from '@notionhq/client';
import { validateStatementDescriptor } from './stripe-admin';
import { getConfig } from '../utils/config';

let notion: Client | null = null;
let DB: string;

async function ensure() {
  if (!notion) {
    const cfg = await getConfig('notion');
    if (!cfg.token || !cfg.queueDb) {
      throw new Error('Notion configuration missing');
    }
    notion = new Client({ auth: cfg.token });
    DB = cfg.queueDb;
  }
}

export interface DesiredProduct {
  id: string;
  name: string;
  description: string;
  type: string;
  unit_amount: number;
  currency: string;
  interval?: string;
  active: boolean;
  statement_descriptor: string;
  tax_behavior: string;
  tax_code?: string;
  metadata: Record<string, string>;
  imageFolder?: string;
  stripeProductId?: string;
  stripePriceId?: string;
}

export async function fetchDesiredStripeProducts(dbId: string) {
  await ensure();
  const notionClient = notion!;
  const items: DesiredProduct[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionClient.databases.query({ database_id: dbId, start_cursor: cursor });
    for (const page of res.results as any[]) {
      const props: any = page.properties || {};
      const getProp = (name: string) => {
        const entry = Object.entries(props).find(([k]) => k.toLowerCase() === name.toLowerCase());
        return entry ? entry[1] : undefined;
      };
      const text = (name: string) => {
        const p = getProp(name);
        if (!p) return '';
        if (p.type === 'title') return (p.title?.[0]?.plain_text || '').trim();
        if (p.type === 'rich_text')
          return (p.rich_text || []).map((t: any) => t.plain_text).join('').trim();
        if (p.type === 'select') return (p.select?.name || '').trim();
        if (p.type === 'url') return (p.url || '').trim();
        if (p.type === 'multi_select')
          return (p.multi_select || []).map((s: any) => s.name).join(',');
        return '';
      };
      const number = (name: string) => {
        const p = getProp(name);
        return typeof p?.number === 'number' ? p.number : undefined;
      };
      const checkbox = (name: string) => {
        const p = getProp(name);
        return !!p?.checkbox;
      };

      const name = text('Name');
      if (!name) continue;
      const priceRaw = number('Price') ?? number('Amount') ?? 0;
      let unit_amount = priceRaw;
      if (unit_amount < 1000) unit_amount = Math.round(unit_amount * 100);
      const currency = (text('Currency') || 'usd').toLowerCase();
      const interval = text('Interval') || undefined;
      const descriptorRaw = text('Statement Descriptor') || 'MESSY MAGNETIC';
      let metadata: Record<string, string> = {};
      const metaRaw = text('Metadata');
      if (metaRaw) {
        try {
          metadata = JSON.parse(metaRaw);
        } catch {
          metadata = Object.fromEntries(
            metaRaw
              .split(/[\n,]/)
              .map((line) => {
                const [k, ...rest] = line.split(':');
                if (!k || !rest.length) return [] as any;
                return [k.trim(), rest.join(':').trim()];
              })
              .filter((kv) => kv[0])
          );
        }
      }
      items.push({
        id: page.id,
        name: name.trim(),
        description: text('Description').trim(),
        type: text('Type').toLowerCase() || 'one-time',
        unit_amount,
        currency,
        interval: interval ? interval.toLowerCase() : undefined,
        active: checkbox('Active'),
        statement_descriptor: validateStatementDescriptor(descriptorRaw),
        tax_behavior: (text('Tax Behavior') || 'unspecified').toLowerCase(),
        tax_code: text('Tax Code') || undefined,
        metadata,
        imageFolder: text('Image Folder') || undefined,
        stripeProductId: text('Stripe Product ID') || undefined,
        stripePriceId: text('Stripe Price ID') || undefined,
      });
    }
    cursor = res.has_more ? res.next_cursor || undefined : undefined;
  } while (cursor);
  return items;
}

type NotionPage = any;

export async function enqueueTask(input: {
  task: string;
  type?: string;
  data?: any;
  runAt?: string | Date;
  priority?: 'Low' | 'Normal' | 'High';
}) {
  await ensure();
  const notionClient = notion!;
  const props: any = {
    Task: { title: [{ text: { content: input.task } }] },
    Status: { select: { name: 'Queued' } },
  };
  if (input.type) props['Type'] = { select: { name: input.type } };
  if (input.data)
    props['Data'] = {
      rich_text: [
        { text: { content: JSON.stringify(input.data).slice(0, 2000) } },
      ],
    };
  if (input.runAt)
    props['Run At'] = {
      date: { start: new Date(input.runAt).toISOString() },
    };
  if (input.priority) props['Priority'] = { select: { name: input.priority } };

  const page = await notionClient.pages.create({
    parent: { database_id: DB },
    properties: props,
  });
  return page;
}

export async function claimNextTask(): Promise<NotionPage | null> {
  await ensure();
  const notionClient = notion!;
  const res = await notionClient.databases.query({
    database_id: DB,
    filter: {
      and: [
        { property: 'Status', select: { equals: 'Queued' } },
        {
          or: [
            { property: 'Run At', date: { is_empty: true } },
            {
              property: 'Run At',
              date: { on_or_before: new Date().toISOString() },
            },
          ],
        },
      ],
    },
    sorts: [
      { property: 'Priority', direction: 'descending' },
      { property: 'Run At', direction: 'ascending' },
    ],
    page_size: 1,
  });
  if (!res.results.length) return null;

  const page = res.results[0];
  await notionClient.pages.update({
    page_id: page.id,
    properties: {
      Status: { select: { name: 'Running' } },
      'Ran At': { date: { start: new Date().toISOString() } },
    },
  });
  return page;
}

export async function completeTask(pageId: string) {
  await ensure();
  const notionClient = notion!;
  await notionClient.pages.update({
    page_id: pageId,
    properties: { Status: { select: { name: 'Done' } } },
  });
}

export async function failTask(pageId: string, message: string) {
  await ensure();
  const notionClient = notion!;
  await notionClient.pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: 'Failed' } },
      'Last Error': {
        rich_text: [
          { text: { content: message.slice(0, 1900) } },
        ],
      },
    },
  });
}

export function readTask(page: any) {
  const props: any = page.properties;
  const val = (key: string) => props[key];
  const text = (key: string) => (val(key)?.rich_text?.[0]?.plain_text ?? '').trim();
  const select = (key: string) => val(key)?.select?.name ?? null;
  const title = (val('Task')?.title?.[0]?.plain_text ?? '').trim();

  let data: any = undefined;
  try {
    data = text('Data') ? JSON.parse(text('Data')) : undefined;
  } catch {}

  return {
    id: page.id,
    task: title,
    type: select('Type') ?? 'ops',
    data,
  };
}
