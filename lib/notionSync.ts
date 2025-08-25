export async function updateNotionOrder() {
  const token = process.env.NOTION_TOKEN;
  const dbId = process.env.NOTION_ORDER_DB;
  if (!token || !dbId) {
    console.warn('Missing Notion env');
    return { count: 0 };
  }
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28'
    }
  });
  const json = await res.json().catch(() => ({}));
  const count = Array.isArray(json.results) ? json.results.length : 0;
  return { count };
}
