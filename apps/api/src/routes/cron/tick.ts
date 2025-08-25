import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { runTasks } from "../../../lib/tasks";

export const dynamic = "force-dynamic"; // keep it serverless-friendly

function authorized(req: NextRequest) {
  const key = process.env.CRON_SECRET;
  if (!key) return true;
  const h = req.headers.get("authorization");
  const url = new URL(req.url);
  return (h === `Bearer ${key}`) || (url.searchParams.get("key") === key);
}

async function notify(text: string) {
  try {
    await fetch(`${process.env.API_BASE ?? ''}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch {}
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const only = url.searchParams.getAll("only"); // e.g. ?only=notion.sync_hq&only=social.refresh_planner

  if (dry) {
    return NextResponse.json({ ok: true, dry: true, wouldRun: only.length ? only : Object.keys((await import("../../../lib/tasks")).tasks) });
  }

  const results = await runTasks(only.length ? only : undefined);
  for (const r of results) {
    await notify(`mags-cron: ${r.name} ${r.ok ? 'ok' : 'failed'}${r.msg ? ': ' + r.msg : ''}`);
  }
  const ok = results.every(r => r.ok);
  return NextResponse.json({ ok, ran: results });
}
