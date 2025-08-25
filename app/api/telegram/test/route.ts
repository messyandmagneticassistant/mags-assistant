import { tgSend } from '../../../../lib/telegram';
import { getConfig } from '../../../../utils/config';

export const runtime = 'nodejs';

export async function GET() {
  const cfg = await getConfig('telegram');
  if (!cfg.botToken || !cfg.chatId) {
    return Response.json({ ok:false, missing:['telegram.botToken','telegram.chatId'] });
  }
  const msg = `✅ Telegram test @ ${new Date().toISOString()}`;
  const out = await tgSend(msg);
  return Response.json(out);
}
