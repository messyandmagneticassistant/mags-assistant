function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPost({ env, request }: { env: any; request: Request }) {
  const url = new URL(request.url);
  if (url.pathname !== '/diag/email/test') return json({ ok: false }, 404);
  const body = (await request.json().catch(() => ({}))) as Record<string, any>;
  const to = body.to;
  if (!to) return json({ ok: false, error: 'missing to' }, 400);
  try {
    // @ts-ignore - email helper is shared with the Node runtime
    const { sendEmail } = await import('../../utils/' + 'email');
    const res = await sendEmail({ to, subject: body.subject || 'Test Email', text: body.text || 'hello' }, env);
    return json({ ok: true, id: res.id });
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 500);
  }
}
