export interface OrderRecord {
  id: string;
  email: string;
  tier: string;
  status: string;
  driveDoc?: string;
  pdfLink?: string;
}

function notionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };
}

export async function logOrder(env: any, order: OrderRecord) {
  const token = env.NOTION_TOKEN || env.NOTION_API_KEY;
  const db = env.NOTION_DB_ORDERS;
  if (!token || !db) return;
  const body = {
    parent: { database_id: db },
    properties: {
      'Order ID': { title: [{ text: { content: order.id } }] },
      Email: { email: order.email },
      Tier: { select: { name: order.tier } },
      Status: { status: { name: order.status } },
      DriveDoc: order.driveDoc ? { url: `https://docs.google.com/document/d/${order.driveDoc}` } : undefined,
      PDFLink: order.pdfLink ? { url: order.pdfLink } : undefined,
    },
  };
  await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify(body),
  });
}

export async function updateOrderStatus(env: any, pageId: string, status: string, extras: Partial<OrderRecord> = {}) {
  const token = env.NOTION_TOKEN || env.NOTION_API_KEY;
  if (!token) return;
  const props: any = {
    Status: { status: { name: status } },
  };
  if (extras.driveDoc) {
    props.DriveDoc = { url: `https://docs.google.com/document/d/${extras.driveDoc}` };
  }
  if (extras.pdfLink) {
    props.PDFLink = { url: extras.pdfLink };
  }
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(token),
    body: JSON.stringify({ properties: props }),
  });
}
