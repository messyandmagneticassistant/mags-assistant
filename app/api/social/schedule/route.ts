import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const missing: string[] = [];
  if (!process.env.BUFFER_ACCESS_TOKEN) missing.push('BUFFER_ACCESS_TOKEN');
  if (!process.env.BUFFER_PROFILE_ID) missing.push('BUFFER_PROFILE_ID');

  if (missing.length) {
    return NextResponse.json({ ok: false, missing }, { status: 501 });
  }

  try {
    const { platform, caption, fileUrl, scheduledAt } = await req.json();
    const res = await fetch('https://api.bufferapp.com/1/updates/create.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: process.env.BUFFER_ACCESS_TOKEN,
        profile_ids: [process.env.BUFFER_PROFILE_ID],
        text: caption,
        media: { link: fileUrl },
        scheduled_at: scheduledAt,
      }),
    });
    const data = await res.json();
    return NextResponse.json({ ok: true, response: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
