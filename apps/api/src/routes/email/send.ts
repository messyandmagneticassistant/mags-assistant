import { NextRequest, NextResponse } from "next/server";
import { sendApprovedDrafts } from "../../../lib/email";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const result = await sendApprovedDrafts();
  const status = result.ok === false ? 501 : 200;
  return NextResponse.json(result, { status });
}
