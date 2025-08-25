// TODO: implement grant/donor responder automation
// TODO: connect Notion donor page and grants form to Stripe via webhook or Make.com
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as any;
  if (process.env.NODE_ENV !== 'production') {
    return Response.json({ ok: true, message: 'grant responder stub', body });
  }
  return Response.json({ ok: true });
}
