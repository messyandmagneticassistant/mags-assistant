// Logs visible in Vercel → Project → Deployments → Function logs

import { NextRequest } from 'next/server';
import { getConfig } from '../../utils/config';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json({ status: 'ok' });
}

export async function POST(req: NextRequest) {
  const cfg = await getConfig('telegram');
  const BOT_TOKEN = cfg.botToken;
  const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

  async function sendMessage(chatId: number, text: string) {
    await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  }

  const update = await req.json().catch(() => ({} as any));
  console.log('tg:update', JSON.stringify(update).slice(0, 400));

  const msg = update?.message;
  const chatId = msg?.chat?.id as number | undefined;
  const text = (msg?.text as string | undefined)?.trim();

  const onlyChat = cfg.chatId ? Number(cfg.chatId) : null;
  if (!chatId) return new Response('ok', { status: 200 });
  if (onlyChat && chatId !== onlyChat) {
    await sendMessage(chatId, 'Sorry, this bot is locked to the owner.');
    return new Response('ok', { status: 200 });
  }

  if (text === '/start') await sendMessage(chatId, 'Mags online ✨ Type /ping or tell me what to do.');
  else if (text === '/ping') await sendMessage(chatId, 'pong ✅');
  else await sendMessage(chatId, "Got it! I’ll process this soon.");

  return new Response('ok', { status: 200 });
}
