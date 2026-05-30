import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return NextResponse.json({ available: false, models: [] });
    }

    const data = await res.json() as { models?: { name: string }[] };
    const models = (data.models ?? []).map((model) => model.name);
    return NextResponse.json({ available: models.length > 0, models });
  } catch {
    return NextResponse.json({ available: false, models: [] });
  }
}
