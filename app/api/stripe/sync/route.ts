import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '../../../../lib/auth';
import { sync } from '../../../../lib/stripeSync';

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') ?? 'audit') as any;
  const dry = url.searchParams.get('dry') !== '0';
  const row = url.searchParams.get('row') ?? undefined;
  try {
    const result = await sync({ mode, dry, row });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'sync-failed' }, { status: 500 });
  }
}
