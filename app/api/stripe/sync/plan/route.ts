import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '../../../../../lib/auth';
import { planStripeSync } from '../../../../../lib/stripe-sync';
import { env } from '../../../../../lib/env.js';

function checkWorker(req: NextRequest) {
  const key = req.headers.get('x-worker-key');
  return key && env.WORKER_KEY && key === env.WORKER_KEY;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req) && !checkWorker(req)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  try {
    const plan = await planStripeSync();
    return NextResponse.json(plan);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'plan-failed' }, { status: 500 });
  }
}
