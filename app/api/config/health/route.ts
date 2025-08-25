import { NextResponse } from 'next/server';
import { getConfig } from '../../../utils/config';

export const runtime = 'nodejs';

export async function GET() {
  await getConfig('notion');
  return NextResponse.json({ ok: true });
}
