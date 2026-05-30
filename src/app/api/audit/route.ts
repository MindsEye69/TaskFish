import { NextResponse } from "next/server";
import { loadJson, saveJson } from "../api-helper";

export const dynamic = "force-dynamic";

type AuditEvent = {
  id: string;
  ts: number;
  type: string;
  message: string;
  details?: unknown;
};

export async function GET() {
  const entries = loadJson("audit_log.json");
  return NextResponse.json({ events: Array.isArray(entries) ? entries : [] });
}

export async function POST(req: Request) {
  try {
    const { type, message, details = {} } = await req.json();
    if (!type || !message) {
      return NextResponse.json({ error: "Missing type or message" }, { status: 400 });
    }

    const existing = loadJson("audit_log.json");
    const entries: AuditEvent[] = Array.isArray(existing) ? existing : [];
    entries.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: Date.now(),
      type,
      message,
      details,
    });
    saveJson("audit_log.json", entries.slice(-250));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
