import type { Env } from '../worker';

/**
 * Aggregate yesterday's activity from KV and log to Notion.
 * Optionally sends a short email via Gmail API.
 */
export async function runDailyDigest(env: Env) {
  const date = new Date(Date.now() - 86400000).toISOString().slice(0, 10); // YYYY-MM-DD of yesterday

  const logs = (await env.POSTQ.get(`logs:${date}`, 'json').catch(() => null)) as any[] | null;
  const results = (await env.POSTQ.get(`queue:${date}`, 'json').catch(() => null)) as any[] | null;

  const categories = {
    'TikTok posts': 0,
    engagements: 0,
    'orders processed': 0,
    'readings delivered': 0,
    'outreach attempts': 0,
  } as Record<string, number>;

  const consume = (items: any[] | null) => {
    if (!items) return;
    for (const item of items) {
      const cat = String(item?.category || '').toLowerCase();
      if (cat.includes('tiktok')) categories['TikTok posts']++;
      else if (cat.includes('engagement')) categories.engagements++;
      else if (cat.includes('order')) categories['orders processed']++;
      else if (cat.includes('reading')) categories['readings delivered']++;
      else if (cat.includes('outreach')) categories['outreach attempts']++;
    }
  };

  consume(logs);
  consume(results);

  if (env.NOTION_API_KEY && env.NOTION_DB_LOGS) {
    const payload = {
      parent: { database_id: env.NOTION_DB_LOGS },
      properties: {
        Date: { title: [{ text: { content: date } }] },
        'TikTok Posts': { number: categories['TikTok posts'] },
        Engagements: { number: categories.engagements },
        'Orders Processed': { number: categories['orders processed'] },
        'Readings Delivered': { number: categories['readings delivered'] },
        'Outreach Attempts': { number: categories['outreach attempts'] },
      },
    };

    await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify(payload),
    });
  }

  if (env.GMAIL_TOKEN) {
    const summary =
      `TikTok: ${categories['TikTok posts']}\n` +
      `Engagements: ${categories.engagements}\n` +
      `Orders: ${categories['orders processed']}` +
      `\nReadings: ${categories['readings delivered']}` +
      `\nOutreach: ${categories['outreach attempts']}`;

    const raw = btoa(
      `Subject: Daily digest ${date}\n\n${summary}`
    ).replace(/\+/g, '-').replace(/\//g, '_');

    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GMAIL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
  }
}
