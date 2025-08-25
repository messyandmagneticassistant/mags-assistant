import { NextRequest, NextResponse } from 'next/server';
import { resendReading } from '../../../../lib/fulfillment';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await resendReading({
      personId: body.personId,
      method: body.method,
      force: body.force,
      reason: body.reason,
    });
    return NextResponse.json({ ok: result.ok, method: result.method });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
