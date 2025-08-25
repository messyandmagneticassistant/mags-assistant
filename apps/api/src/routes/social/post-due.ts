import { NextRequest, NextResponse } from "next/server";
import { postDueClips } from "../../../lib/social";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const result = await postDueClips();
  const status = result.ok === false ? 501 : 200;
  return NextResponse.json(result, { status });
}
