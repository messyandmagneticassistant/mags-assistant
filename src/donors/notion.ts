const API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function env(key: string, e?: any): string | undefined {
  if (e && e[key]) return e[key];
  if (typeof process !== 'undefined' && process.env[key]) return process.env[key];
  return undefined;
}

export interface DonationInput {
  name: string;
  email: string;
  amount: number;
  intent: string;
}

export async function recordDonation(input: DonationInput, e?: any): Promise<void> {
  const token = env('NOTION_API_KEY', e);
  const db = env('NOTION_DB_ID', e);
  if (!token || !db) throw new Error('Missing Notion config');
  await fetch(`${API_BASE}/pages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { database_id: db },
      properties: {
        Name: { title: [{ text: { content: input.name } }] },
        Email: { email: input.email },
        Amount: { number: input.amount },
        Intent: { rich_text: [{ text: { content: input.intent } }] },
        Created: { date: { start: new Date().toISOString() } },
      },
    }),
  });
}

export interface DonationSummary {
  name: string;
  amount: number;
  intent: string;
  createdAt: string;
}

export async function listRecentDonations(limit = 10, e?: any): Promise<DonationSummary[]> {
  const token = env('NOTION_API_KEY', e);
  const db = env('NOTION_DB_ID', e);
  if (!token || !db) throw new Error('Missing Notion config');
  const res = await fetch(`${API_BASE}/databases/${db}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({ page_size: limit, sorts: [{ property: 'Created', direction: 'descending' }] }),
  });
  const json: any = await res.json();
  return (json.results || []).map((p: any) => ({
    name: p.properties?.Name?.title?.[0]?.plain_text || '',
    amount: p.properties?.Amount?.number || 0,
    intent: p.properties?.Intent?.rich_text?.[0]?.plain_text || '',
    createdAt: p.properties?.Created?.date?.start || '',
  }));
}
