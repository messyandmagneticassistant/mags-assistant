export interface Donation {
  name: string;
  email: string;
  amount: number;
  intent?: string;
}

function getHeaders(env: any) {
  const key = env?.NOTION_API_KEY || process.env.NOTION_API_KEY;
  return {
    Authorization: `Bearer ${key}`,
    'Notion-Version': '2022-06-28',
    'content-type': 'application/json',
  };
}

export async function recordDonation(d: Donation, env?: any) {
  const db = env?.NOTION_DB_ID || process.env.NOTION_DB_ID;
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: getHeaders(env),
    body: JSON.stringify({
      parent: { database_id: db },
      properties: {
        Name: { title: [{ text: { content: d.name } }] },
        Email: { email: d.email },
        Amount: { number: d.amount },
        Intent: { rich_text: [{ text: { content: d.intent || '' } }] },
      },
    }),
  });
  return res.json();
}

export async function listRecentDonations(limit = 10, env?: any) {
  const db = env?.NOTION_DB_ID || process.env.NOTION_DB_ID;
  const res = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
    method: 'POST',
    headers: getHeaders(env),
    body: JSON.stringify({ page_size: limit, sorts: [{ timestamp: 'created_time', direction: 'descending' }] }),
  });
  return res.json();
}
