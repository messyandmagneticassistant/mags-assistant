import { NextResponse } from 'next/server';

export async function POST() {
  // start drive watch and prepare environment
  try {
    await fetch(`${process.env.API_BASE ?? ''}/api/drive/watch`, { method: 'POST' });
  } catch {}
  return NextResponse.json({ ok: true });
}
