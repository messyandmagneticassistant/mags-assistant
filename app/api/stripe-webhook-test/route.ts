import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.text();
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}
