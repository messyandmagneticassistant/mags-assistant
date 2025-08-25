import { env } from '../../../../lib/env.js';

export const runtime = 'nodejs';

export async function GET() {
  if (!env.TELEGRAM_BOT_TOKEN)
    return Response.json({ ok: false, reason: 'missing TELEGRAM_BOT_TOKEN' });
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`
    );
    return Response.json({ ok: r.ok, reason: r.ok ? undefined : `status ${r.status}` });
  } catch (e: any) {
    return Response.json({ ok: false, reason: e.message });
  }
}

