import { notion, requireEnv } from '../notion.js';

async function createRun(command) {
  const db = process.env.NOTION_DB_RUNS_ID;
  if (!db) return null;
  const page = await notion.pages.create({
    parent: { database_id: db },
    properties: {
      Name: { title: [{ text: { content: command.slice(0, 50) } }] },
      Status: { status: { name: 'Running' } },
      Command: { rich_text: [{ text: { content: command } }] },
      Started: { date: { start: new Date().toISOString() } },
    },
  });
  return page.id;
}

async function appendRun(id, text) {
  if (!id) return;
  const page = await notion.pages.retrieve({ page_id: id });
  const prev = page.properties?.Result?.rich_text?.map(r => r.plain_text).join('\n') || '';
  const combined = prev ? `${prev}\n${text}` : text;
  await notion.pages.update({
    page_id: id,
    properties: {
      Result: { rich_text: [{ text: { content: combined } }] },
    },
  });
}

async function finishRun(id, ok) {
  if (!id) return;
  await notion.pages.update({
    page_id: id,
    properties: {
      Status: { status: { name: ok ? 'Success' : 'Failed' } },
      Ended: { date: { start: new Date().toISOString() } },
    },
  });
}

async function ensureDonor({ name, amount, frequency }) {
  const db = requireEnv('NOTION_DB_DONORS_ID');
  await notion.pages.create({
    parent: { database_id: db },
    properties: {
      Name: { title: [{ text: { content: name } }] },
      Amount: { number: amount },
      Frequency: { select: { name: frequency } },
      Status: { status: { name: 'pledged' } },
    },
  });
}

async function createSubpage({ title }) {
  const hq = requireEnv('NOTION_HQ_PAGE_ID');
  await notion.pages.create({
    parent: { page_id: hq },
    properties: { title: [{ type: 'text', text: { content: title } }] },
  });
}

export async function runPlan(plan, { text }) {
  const runId = await createRun(text);
  try {
    for (const step of plan.steps) {
      if (step.tool === 'notion' && step.action === 'createDonor') {
        await ensureDonor(step.args);
        await appendRun(runId, `Donor ${step.args.name} added`);
      } else if (step.tool === 'notion' && step.action === 'hqSubpage') {
        await createSubpage(step.args);
        await appendRun(runId, `Subpage ${step.args.title} created`);
      } else {
        await appendRun(runId, `Unknown step ${step.action}`);
      }
    }
    await finishRun(runId, true);
    return { runId };
  } catch (e) {
    await appendRun(runId, `Error: ${e.message}`);
    await finishRun(runId, false);
    throw e;
  }
}
