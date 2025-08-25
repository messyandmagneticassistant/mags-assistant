import { NextRequest, NextResponse } from "next/server";
import { gmailEnabled } from "../../../lib/email";
import { tiktokEnabled } from "../../../lib/social";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const enabled = {
    gmail: gmailEnabled(),
    resend: !!process.env.RESEND_API_KEY,
    tiktok: tiktokEnabled(),
  };
  return NextResponse.json({ ok: true, enabled });
}
