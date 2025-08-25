import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const resourceId = req.headers.get('x-goog-resource-id');
  if (resourceId) {
    try {
      await fetch(`${process.env.API_BASE ?? ''}/api/ingest/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: resourceId }),
      });
    } catch {}
  }
  return NextResponse.json({ ok: true });
}
