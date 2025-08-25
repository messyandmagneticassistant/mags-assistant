import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '../../../../../lib/auth';
import { runStripeSync } from '../../../../../lib/stripe-sync';
import { env } from '../../../../../lib/env.js';

function checkWorker(req: NextRequest) {
  const key = req.headers.get('x-worker-key');
  return key && env.WORKER_KEY && key === env.WORKER_KEY;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req) && !checkWorker(req)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === 'true' || url.searchParams.get('dry') === '1';
  let body: any = {};
  try {
    body = await req.json();
  } catch {}
  try {
    const result = await runStripeSync({ dry, names: body.names });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'run-failed' }, { status: 500 });
  }
}
