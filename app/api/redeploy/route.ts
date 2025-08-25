import { NextRequest } from 'next/server';
import fetch from 'node-fetch';

export const runtime = 'nodejs';

const ONE_MIN = 60 * 1000;
let lastRun = 0;

export async function POST(req: NextRequest) {
  try {
    // Simple rate-limit to prevent spam
    const now = Date.now();
    if (now - lastRun < ONE_MIN) {
      return Response.json({ ok: false, error: 'Too many requests. Try again shortly.' }, { status: 429 });
    }

    const {
      owner,
      repo,
      workflow_file = 'vercel-redeploy.yml',
      ref = 'main',
      reason = 'Maggie requested a production redeploy',
    } = (await req.json().catch(() => ({})));

    if (!owner || !repo) {
      return Response.json({ ok: false, error: 'Missing owner/repo' }, { status: 400 });
    }

    const token = process.env.GITHUB_REDEPLOY_TOKEN;
    if (!token) {
      return Response.json({ ok: false, error: 'Missing GITHUB_REDEPLOY_TOKEN' }, { status: 500 });
    }

    // Trigger workflow_dispatch
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_file}/dispatches`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref, inputs: { reason } }),
    });

    lastRun = Date.now();

    if (r.status === 204) {
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        const tg =
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage` +
          `?chat_id=${process.env.TELEGRAM_CHAT_ID}` +
          `&text=${encodeURIComponent(`🔁 Redeploy requested: ${reason}`)}`;
        await fetch(tg);
      }
      return Response.json({ ok: true, message: 'Workflow dispatch sent.' });
    }

    const text = await r.text();
    return Response.json({ ok: false, error: `GitHub API error ${r.status}: ${text}` }, { status: 500 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ ok: false, error: 'Use POST' }, { status: 405 });
}
