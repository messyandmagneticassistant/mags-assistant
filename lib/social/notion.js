import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export async function ensureSocialDb({ parentPageId }) {
  const title = 'MM Social Queue';
  const search = await notion.search({
    query: title,
    filter: { property: 'object', value: 'database' },
    page_size: 50,
  });
  const existing = search.results.find(
    (d) => d.parent?.page_id === parentPageId && d.title?.[0]?.plain_text === title
  );
  if (existing) return { databaseId: existing.id };
  const db = await notion.databases.create({
    parent: { page_id: parentPageId },
    title: [{ type: 'text', text: { content: title } }],
    properties: {
      Title: { title: {} },
      Platform: {
        select: {
          options: [
            { name: 'X' },
            { name: 'Instagram' },
            { name: 'TikTok' },
            { name: 'YouTube' },
            { name: 'Pinterest' },
            { name: 'LinkedIn' },
          ],
        },
      },
      Status: {
        status: {
          options: [
            { name: 'Draft' },
            { name: 'Ready' },
            { name: 'Scheduled' },
            { name: 'Posted' },
            { name: 'Failed' },
          ],
        },
      },
      'Scheduled At': { date: {} },
      Caption: { rich_text: {} },
      LinkURL: { url: {} },
      AssetURL: { url: {} },
      ResultLog: { rich_text: {} },
    },
  });
  return { databaseId: db.id };
}
