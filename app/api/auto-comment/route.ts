// TODO: implement auto-commenting logic
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as any;
  if (process.env.NODE_ENV !== 'production') {
    return Response.json({ ok: true, message: 'auto-comment stub', body });
  }
  return Response.json({ ok: true });
}
