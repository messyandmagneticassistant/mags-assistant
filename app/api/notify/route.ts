import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '../../utils/config';

export async function POST(req: NextRequest) {
  try {
    const { text = '', html, proposal } = await req.json();
    const { botToken: tgToken, chatId: tgChat } = await getConfig('telegram');
    const resendKey = process.env.RESEND_API_KEY;
    const notifyEmail = process.env.NOTIFY_EMAIL;

    const tasks: Promise<any>[] = [];
    const plain = text || (html ? html.replace(/<[^>]+>/g, '').slice(0, 4000) : '');

    if (tgToken && tgChat) {
      const body: any = { chat_id: tgChat, text: plain };
      if (proposal && proposal.actionId && proposal.runId && proposal.kind) {
        const approve = {
          ...proposal,
          decision: 'approve',
        };
        const decline = {
          ...proposal,
          decision: 'decline',
        };
        body.reply_markup = {
          inline_keyboard: [
            [
              { text: 'Approve', callback_data: JSON.stringify(approve) },
              { text: 'Decline', callback_data: JSON.stringify(decline) },
            ],
          ],
        };
      }
      tasks.push(
        fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      );
    }

    if (resendKey && notifyEmail) {
      tasks.push(fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendKey}`
        },
        body: JSON.stringify({
          from: 'Maggie from Messy & Magnetic\u2122 <maggie@messyandmagnetic.com>',
          to: [notifyEmail],
          subject: 'Mags Notification',
          html: html ?? `<pre>${plain}</pre>`
        })
      }));
    }

    await Promise.all(tasks);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'notify-failed' }, { status: 500 });
  }
}
