import { env } from '../../../../lib/env.js';

export const runtime = 'nodejs';

export async function GET() {
  if (!env.NOTION_TOKEN)
    return Response.json({ ok: false, reason: 'missing NOTION_TOKEN' });
  try {
    const r = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
      },
    });
    return Response.json({ ok: r.ok, reason: r.ok ? undefined : `status ${r.status}` });
  } catch (e: any) {
    return Response.json({ ok: false, reason: e.message });
  }
}

