import { Client } from '@notionhq/client';

let cache: { data: Record<string, any>; ts: number } = { data: {}, ts: 0 };

export async function ensureProfileDb(env: any) {
  if (env.PROFILE_DB_ID) return env.PROFILE_DB_ID;
  if (!env.NOTION_TOKEN || !env.NOTION_HQ_PAGE_ID) return null;
  const notion = new Client({ auth: env.NOTION_TOKEN });
  try {
    const search = await notion.search({
      query: 'Profile',
      filter: { property: 'object', value: 'database' },
    });
    const existing: any = (search.results || []).find(
      (r: any) => r?.parent?.page_id === env.NOTION_HQ_PAGE_ID
    );
    if (existing) {
      env.PROFILE_DB_ID = existing.id;
      return existing.id;
    }
    const db = await notion.databases.create({
      parent: { page_id: env.NOTION_HQ_PAGE_ID },
      title: [{ type: 'text', text: { content: 'Profile' } }],
      properties: {
        Key: { title: {} },
        Value: { rich_text: {} },
        Category: { select: { options: [] } },
        Visibility: {
          select: { options: [{ name: 'internal' }, { name: 'shareable' }] },
        },
        Updated: { date: {} },
      },
    });
    env.PROFILE_DB_ID = db.id;
    return db.id;
  } catch (e) {
    console.warn('ensureProfileDb failed', e);
    return null;
  }
}

async function fetchProfile(env: any) {
  const dbId = env.PROFILE_DB_ID;
  if (!dbId || !env.NOTION_TOKEN) return {};
  const notion = new Client({ auth: env.NOTION_TOKEN });
  const res = await notion.databases.query({ database_id: dbId, page_size: 100 });
  const map: Record<string, { value: string; visibility: string }> = {};
  for (const page of res.results as any[]) {
    const key = page.properties?.Key?.title?.[0]?.plain_text || '';
    if (!key) continue;
    const value = (page.properties?.Value?.rich_text || [])
      .map((t: any) => t.plain_text)
      .join('');
    const visibility = page.properties?.Visibility?.select?.name || 'internal';
    map[key] = { value, visibility };
  }
  return map;
}

export async function getProfileMap(env: any) {
  if (cache.data && Date.now() - cache.ts < 60_000) return cache.data;
  const map = await fetchProfile(env);
  cache = { data: map, ts: Date.now() };
  return map;
}

export async function getShareableProfile(env: any) {
  const map = await getProfileMap(env);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if ((v as any).visibility === 'shareable') out[k] = (v as any).value;
  }
  return out;
}

export function maskEmail(email: string) {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  if (user.length <= 2) return `${user[0]}****@${domain}`;
  return `${user[0]}****${user[user.length - 1]}@${domain}`;
}

export function buildExportPacket(map: Record<string, string>, opts?: { includePII?: boolean }) {
  const includePII = opts?.includePII;
  const packet: any = {
    project: {
      name: map.project_name || '',
      description: map.project_description || '',
      location: {
        state: map.project_state || '',
        county: map.project_county || '',
        acreage: map.project_acreage || '',
      },
    },
    org: {
      nonprofit_status: map.org_nonprofit_status || '',
      donate_url: map.org_donate_url || '',
    },
    founder: {
      name: map.founder_name || '',
      email: map.founder_email || '',
    },
    timestamp: new Date().toISOString(),
    keys_included: Object.keys(map),
  };
  if (!includePII) packet.founder.email = maskEmail(packet.founder.email);
  return packet;
}
