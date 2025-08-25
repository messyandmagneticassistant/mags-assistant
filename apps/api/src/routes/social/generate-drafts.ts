import { NextRequest, NextResponse } from "next/server";
import { generateDraftsFromDrive } from "../../../lib/social";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const result = await generateDraftsFromDrive();
  const status = result.ok === false ? 501 : 200;
  return NextResponse.json(result, { status });
}
