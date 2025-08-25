import { Client } from '@notionhq/client';
import { randomUUID } from 'crypto';

export const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB = process.env.NOTION_QUEUE_DB_ID;

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const rt = (s) => ({ rich_text: [{ text: { content: s } }] });
const getText = (prop) => prop?.rich_text?.[0]?.plain_text || '';

export async function ensureQueueDb({ parentPageId }) {
  const title = 'Maggie Job Queue';
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
      'Job Name': { title: {} },
      Status: {
        select: {
          options: [
            { name: 'Pending', color: 'yellow' },
            { name: 'In Progress', color: 'blue' },
            { name: 'Done', color: 'green' },
            { name: 'Failed', color: 'red' },
          ],
        },
      },
      Parameters: { rich_text: {} },
      'Requested By': { people: {} },
      'Created Date': { created_time: {} },
      'Result / Notes': { rich_text: {} },
    },
  });
  return { databaseId: db.id };
}

export async function enqueueJob({
  databaseId,
  name,
  parameters,
  requestedByEmail,
}) {
  let people = [];
  if (requestedByEmail) {
    try {
      const users = await notion.users.list({ page_size: 100 });
      const user = users.results.find(
        (u) => u.type === 'person' && u.person?.email === requestedByEmail
      );
      if (user) people.push({ id: user.id });
    } catch {}
  }
  const props = {
    'Job Name': { title: [{ type: 'text', text: { content: name } }] },
    Status: { select: { name: 'Pending' } },
    Parameters: { rich_text: [{ type: 'text', text: { content: parameters } }] },
    ...(people.length ? { 'Requested By': { people } } : {}),
  };
  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: props,
  });
  return { id: page.id };
}

export async function enqueueTask({ jobId, payload }) {
  const props = {
    Title: { title: [{ type: 'text', text: { content: `Task ${jobId}` } }] },
    JobId: rt(jobId),
    Payload: {
      rich_text: [
        {
          type: 'text',
          text: { content: JSON.stringify(payload).slice(0, 1900) },
        },
      ],
    },
    Status: { select: { name: 'Queued' } },
  };
  const page = await notion.pages.create({
    parent: { database_id: DB },
    properties: props,
  });
  return page;
}

export async function claimNextTask() {
  const res = await notion.databases.query({
    database_id: DB,
    filter: {
      and: [
        { property: 'Status', select: { equals: 'Queued' } },
        { property: 'Locked', checkbox: { equals: false } },
        {
          or: [
            { property: 'Run At', date: { is_empty: true } },
            {
              property: 'Run At',
              date: { on_or_before: new Date().toISOString() },
            },
          ],
        },
      ],
    },
    sorts: [{ property: 'Run At', direction: 'ascending' }],
    page_size: 1,
  });
  if (!res.results.length) return null;
  const page = res.results[0];
  const props = page.properties;
  const attempts = props.Attempts?.number ?? 0;
  const existing = getText(props.JobId);
  const jobId = existing || randomUUID();
  await notion.pages.update({
    page_id: page.id,
    properties: {
      Status: { select: { name: 'Running' } },
      Locked: { checkbox: true },
      Attempts: { number: attempts + 1 },
      ...(existing ? {} : { JobId: rt(jobId) }),
    },
  });
  return page;
}

export function readTask(page) {
  const props = page.properties || {};
  const jobId = getText(props.JobId) || page.id;
  let payload = {};
  try {
    const raw = getText(props.Payload);
    payload = raw ? JSON.parse(raw) : {};
  } catch {}
  return { id: jobId, payload };
}

async function findByJobId(jobId) {
  const res = await notion.databases.query({
    database_id: DB,
    filter: { property: 'JobId', rich_text: { equals: jobId } },
    page_size: 1,
  });
  return res.results[0];
}

export async function completeTask(jobId) {
  const page = await findByJobId(jobId);
  if (!page) return;
  await notion.pages.update({
    page_id: page.id,
    properties: {
      Status: { select: { name: 'Done' } },
      Locked: { checkbox: false },
    },
  });
}

export async function failTask(jobId, error) {
  const page = await findByJobId(jobId);
  if (!page) return;
  const errStr = String(error).slice(0, 1900);
  await notion.pages.update({
    page_id: page.id,
    properties: {
      Status: { select: { name: 'Failed' } },
      Locked: { checkbox: false },
      Error: rt(errStr),
    },
  });
}

export async function queueHealth() {
  requireEnv('NOTION_TOKEN');
  requireEnv('NOTION_QUEUE_DB_ID');
  await notion.databases.retrieve({ database_id: DB });
  return true;
}
