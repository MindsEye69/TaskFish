import { NextResponse } from "next/server";
import { loadJson, saveJson } from "../api-helper";
import { normalizeRuleKey } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rules = loadJson("rules.json");
    return NextResponse.json({ rules });
  } catch (err) {
    console.error("ERROR in GET api/rules:", err);
    return NextResponse.json({ rules: {} });
  }
}

export async function POST(req: Request) {
  try {
    const { name, config } = await req.json();
    if (!name || !config) {
      return NextResponse.json({ error: "Missing name or config" }, { status: 400 });
    }

    const key = normalizeRuleKey(name);
    const rules = loadJson("rules.json");
    if (key !== name) delete rules[name];
    if (config.action === "NONE" && config.autoKillMins == null && !config.manualControl) delete rules[key];
    else rules[key] = config;
    saveJson("rules.json", rules);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("ERROR in POST api/rules:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
