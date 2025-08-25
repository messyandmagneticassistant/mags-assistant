import { NextRequest, NextResponse } from "next/server";
import { scheduleClip } from "../../../lib/social";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const result = await scheduleClip();
  return NextResponse.json(result);
}
