// TODO: draft donor auto-response email endpoint
// TODO: confirm Stripe donor buttons are in live mode
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as any;
  if (process.env.NODE_ENV !== 'production') {
    return Response.json({ ok: true, message: 'email reply stub', body });
  }
  return Response.json({ ok: true });
}
