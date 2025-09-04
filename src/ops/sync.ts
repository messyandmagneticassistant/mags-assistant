export async function notionUpsert(env: any, body: any) {
  if (!env.NOTION_API_KEY || !env.NOTION_DB_ID) return { ok: false };
  const url = body.pageId
    ? `https://api.notion.com/v1/pages/${body.pageId}`
    : 'https://api.notion.com/v1/pages';
  const method = body.pageId ? 'patch' : 'post';
  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers: {
      'Notion-Version': '2022-06-28',
      Authorization: `Bearer ${env.NOTION_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ parent: { database_id: env.NOTION_DB_ID }, properties: body.props || {} }),
  });
  return { ok: res.ok };
}

export async function driveUpload(env: any, body: any) {
  const url = env.APPS_SCRIPT_WEBAPP_URL;
  if (!url) return { ok: false };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'driveUpload', ...body }),
  });
  return { ok: res.ok };
}
