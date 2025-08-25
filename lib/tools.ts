import { getStripe } from './clients/stripe';
import { getNotion } from './clients/notion';
import { getConfig } from '../utils/config';

export async function syncStripeNotion({ mode }: { mode: 'pull' | 'push' | 'twoWay' }) {
  // TODO: implement actual sync
  return { ok: true, mode };
}

export async function genProductImage({ productId, promptOverride }: { productId: string; promptOverride?: string }) {
  // TODO: call DALL·E and upload to Stripe + Notion
  return { ok: true, productId, prompt: promptOverride };
}

export async function auditStripe({ fix, scope }: { fix?: boolean; scope?: 'all' | 'changed' | 'missing' }) {
  // TODO: audit Stripe products
  return { ok: true, fix: !!fix, scope: scope ?? 'all' };
}

export async function createNotionTask({ title, details, status }: { title: string; details: string; status?: string }) {
  const notion = await getNotion();
  const { queueDb } = await getConfig('notion');
  await notion.pages.create({
    parent: { database_id: queueDb },
    properties: {
      Task: { title: [{ text: { content: title } }] },
      Status: { select: { name: status || 'Draft' } },
      Details: { rich_text: [{ text: { content: details } }] },
    },
  });
  return { ok: true };
}

export async function notify({ level, title, message, links }: { level: string; title: string; message: string; links?: any[] }) {
  const text = `[${level}] ${title}: ${message}${links?.length ? ' ' + links.join(' ') : ''}`;
  await fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return { ok: true };
}
