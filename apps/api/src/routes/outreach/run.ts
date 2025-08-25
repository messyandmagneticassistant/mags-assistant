import { NextRequest, NextResponse } from "next/server";
import { runOutreach } from "../../../lib/outreach";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const result = await runOutreach();
  return NextResponse.json(result);
}
