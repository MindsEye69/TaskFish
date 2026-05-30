import { NextResponse } from "next/server";
import { loadJson } from "../../api-helper";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(loadJson("process_cache.json"));
}
