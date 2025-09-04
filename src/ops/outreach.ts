import { sendReply } from './email';

async function getTemplate(templateId: string, env: any) {
  if (env.NOTION_API_KEY && env.NOTION_DB_ID) {
    try {
      const r = await fetch(`https://api.notion.com/v1/blocks/${templateId}/children`, {
        headers: {
          'Notion-Version': '2022-06-28',
          Authorization: `Bearer ${env.NOTION_API_KEY}`,
        },
      });
      const data = await r.json();
      const text = data.results?.map((b: any) => b.paragraph?.text?.map((t: any) => t.plain_text).join('')).join('\n');
      if (text) return text;
    } catch {}
  }
  const fs = await import('node:fs');
  try {
    return fs.readFileSync(`templates/outreach/${templateId}.md`, 'utf8');
  } catch {
    return '';
  }
}

export async function renderTemplate(templateId: string, context: any, env: any) {
  let tpl = await getTemplate(templateId, env);
  for (const [k, v] of Object.entries(context || {})) {
    tpl = tpl.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
  }
  return tpl;
}

export async function handle(job: any, env: any) {
  const lead = await env.BRAIN.get(`leads:${job.leadId}`, { type: 'json' });
  if (!lead) return;
  const body = await renderTemplate(job.templateId, lead, env);
  const res = await sendReply(env, { to: lead.email, subject: 'Hello', text: body });
  lead.lastResult = res.ok ? 'sent' : 'error';
  lead.lastSent = Date.now();
  await env.BRAIN.put(`leads:${job.leadId}`, JSON.stringify(lead));
}
