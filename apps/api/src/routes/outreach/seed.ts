import { NextRequest, NextResponse } from "next/server";
import { seedOutreach } from "../../../lib/outreach";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const result = await seedOutreach();
  return NextResponse.json(result);
}
