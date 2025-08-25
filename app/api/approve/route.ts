import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@notionhq/client';
import { getConfig } from '../../../utils/config';

async function runWorker(kind: string, actionId: string) {
  const base = process.env.API_BASE ?? '';
  try {
    if (kind === 'sendOutreach') {
      await fetch(`${base}/api/outreach/run`, { method: 'POST' });
    } else if (kind === 'followUp') {
      await fetch(`${base}/api/outreach/seed`, { method: 'POST' });
    } else if (kind === 'content') {
      // handled by run status update
    }
  } catch {}
}

export async function POST(req: NextRequest) {
  try {
    const { actionId, runId, kind, decision } = await req.json();
    if (!actionId || !runId || !kind) {
      return NextResponse.json({ ok: false, error: 'missing-fields' }, { status: 400 });
    }

    const notionCfg = await getConfig('notion');
    const notionToken = notionCfg.token;
    const runsDb = notionCfg.queueDb;
    if (!notionToken || !runsDb) {
      return NextResponse.json({ ok: false, error: 'notion-missing' }, { status: 500 });
    }
    const notion = new Client({ auth: notionToken });
    const page = await notion.pages.retrieve({ page_id: runId });
    const status = page.properties?.Status?.status?.name ?? '';
    if (status === 'Approved' || status === 'Rejected') {
      return NextResponse.json({ ok: true, already: status });
    }

    if (decision === 'approve') {
      await runWorker(kind, actionId);
      await notion.pages.update({
        page_id: runId,
        properties: {
          Status: { status: { name: kind === 'content' ? 'Content Approved' : 'Approved' } },
        },
      });
    } else {
      await notion.pages.update({
        page_id: runId,
        properties: { Status: { status: { name: 'Rejected' } } },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'approve-failed' }, { status: 500 });
  }
}
