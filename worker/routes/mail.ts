import { sendMail } from '../../src/mailer/resend';

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPost({ env, request }: { env: any; request: Request }) {
  const url = new URL(request.url);
  if (url.pathname !== '/mail/test') return json({ ok: false }, 404);
  if (request.headers.get('x-api-key') !== env.POST_THREAD_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const to = env.ALT_TIKTOK_EMAIL_2 || '';
  if (to) {
    await sendMail(env, to, 'Test email', 'hello from mags');
    return json({ ok: true, sent: true });
  }
  if (env.TELEGRAM_CHAT_ID) {
    return json({ ok: true, telegram: env.TELEGRAM_CHAT_ID });
  }
  return json({ ok: true, sent: false });
}
