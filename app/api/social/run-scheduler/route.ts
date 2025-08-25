import { NextResponse } from 'next/server';
import { getPostingWindows } from '../../../../lib/scheduling';

export async function POST() {
  const windows = getPostingWindows();
  // Normally pick drafts and schedule them; here just return windows
  return NextResponse.json({ ok: true, windows: windows.map(w => w.toISOString()) });
}
