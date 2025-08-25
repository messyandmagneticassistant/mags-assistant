import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { notion } from './notion.js';

const LAST_IDS_PATH = join('docs', '.last-notion-ids.json');

function getText(prop) {
  return prop?.[0]?.plain_text || '';
}

export async function ensureProfileDb({ notion: client = notion, hqPageId }) {
  if (!client || !hqPageId) return null;
  const envId = process.env.NOTION_PROFILE_DB_ID;
  if (envId) {
    try {
      await client.databases.retrieve({ database_id: envId });
      return envId;
    } catch {}
  }
  const search = await client.search({
    query: 'Profile',
    filter: { property: 'object', value: 'database' },
    page_size: 50,
  });
  const existing = search.results.find(
    (d) => d.parent?.page_id === hqPageId && getText(d.title) === 'Profile'
  );
  if (existing) {
    await persistId(existing.id);
    return existing.id;
  }
  const db = await client.databases.create({
    parent: { page_id: hqPageId },
    title: [{ type: 'text', text: { content: 'Profile' } }],
    properties: {
      Key: { title: {} },
      Value: { rich_text: {} },
      Category: { select: {} },
      Visibility: {
        select: {
          options: [
            { name: 'internal', color: 'blue' },
            { name: 'shareable', color: 'green' },
          ],
        },
      },
      Updated: { last_edited_time: {} },
    },
  });
  await persistId(db.id);
  return db.id;
}

async function persistId(id) {
  const payload = { profileDbId: id };
  try {
    let existing = {};
    try {
      const raw = await fs.readFile(LAST_IDS_PATH, 'utf8');
      existing = JSON.parse(raw);
    } catch {}
    const data = { ...existing, ...payload };
    await fs.mkdir(dirname(LAST_IDS_PATH), { recursive: true });
    await fs.writeFile(LAST_IDS_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('persistId error', e);
  }
}
