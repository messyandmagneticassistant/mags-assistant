import { NextResponse } from 'next/server';
import { runMaggieWorkflow } from '../../../../runMaggie';

export const runtime = 'nodejs';

export async function POST() {
  try {
    await runMaggieWorkflow();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/maggie/tiktok-repair] error', err);
    return NextResponse.json({ ok: false, error: 'repair_failed' }, { status: 500 });
  }
}
