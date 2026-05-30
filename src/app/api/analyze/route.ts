import { NextResponse } from "next/server";
import { loadJson, saveJson } from "../api-helper";
import { getTrust, getCategory } from "@/lib/trust";

const MODEL_PREFERENCE = ["gemma3:4b", "gemma2:2b", "llama3.2:3b", "llama3.2:1b", "mistral", "phi3:mini", "llama2"];
const RECOMMENDED_MODEL = "gemma3:4b";

function offlineAnalysis(name: string) {
  const trust = getTrust(name);
  const category = getCategory(trust);
  if (trust === "trusted") {
    return {
      verdict: "essential",
      title: name,
      description: `${name} matches TaskFish's built-in trusted Windows process list.`,
      tip: "Keep this process allowed.",
      gameModeSafe: true,
      suggestedRule: { action: "ALLOW", autoKillMins: null },
      riskScore: 0,
      threatFlags: [],
      offline: true,
    };
  }
  if (trust === "verified") {
    return {
      verdict: "safe",
      title: name,
      description: `${name} matches TaskFish's built-in verified application list.`,
      tip: "Allow this process unless you do not use the associated app.",
      gameModeSafe: false,
      suggestedRule: { action: "ALLOW", autoKillMins: null },
      riskScore: 5,
      threatFlags: [],
      offline: true,
    };
  }
  if (category === "background") {
    return {
      verdict: "background",
      title: name,
      description: `${name} looks like a background helper or service based on its name.`,
      tip: "Limit it during gaming if it consumes noticeable resources.",
      gameModeSafe: true,
      suggestedRule: { action: "LIMITED", autoKillMins: null },
      riskScore: 20,
      threatFlags: [],
      offline: true,
    };
  }
  return {
    verdict: "caution",
    title: name,
    description: `${name} is not recognized by TaskFish's built-in process list.`,
    tip: "Review its executable path and signature before allowing it permanently.",
    gameModeSafe: false,
    suggestedRule: { action: "NONE", autoKillMins: null },
    riskScore: 50,
    threatFlags: ["unknown_process"],
    offline: true,
  };
}

function cacheAndReturnOffline(name: string) {
  const fallback = offlineAnalysis(name);
  const cache = loadJson("process_cache.json");
  cache[name.toLowerCase()] = fallback;
  saveJson("process_cache.json", cache);
  return NextResponse.json({ ...fallback, recommendedModel: RECOMMENDED_MODEL });
}

async function getInstalledModels(): Promise<string[]> {
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const data = await r.json() as { models?: { name: string }[] };
    return (data.models ?? []).map((m: { name: string }) => m.name);
  } catch { return []; }
}

async function getBestModel(): Promise<string | null> {
  const installed = await getInstalledModels();
  if (installed.length === 0) return null;
  for (const pref of MODEL_PREFERENCE) {
    const family = pref.split(":")[0];
    const match = installed.find(m => m === pref || m.startsWith(family + ":"));
    if (match) return match;
  }
  return installed[0];
}

const ANALYSIS_PROMPT = (name: string) =>
  `You are a Windows process security analyst. Analyze this Windows process: "${name}"

Respond with ONLY this JSON (no other text):
{"verdict":"essential","title":"Display Name","description":"One sentence: what this process does and what app it belongs to.","tip":"One sentence recommendation.","gameModeSafe":true,"suggestedRule":{"action":"ALLOW"}}

verdict: "essential"=core Windows, "safe"=trusted app, "background"=benign service, "caution"=unknown/suspicious
gameModeSafe: false if it uses significant CPU/GPU or is non-essential during gaming
suggestedRule.action: "ALLOW" for essential/safe, "LIMITED" for background, "BAN" for caution`;

export async function POST(req: Request) {
  try {
    const { name, forceRescan } = await req.json();
    if (!name) {
      return NextResponse.json({ error: "Missing process name" }, { status: 400 });
    }

    // Serve from cache unless caller requests a fresh scan
    if (!forceRescan) {
      const cache = loadJson("process_cache.json");
      const hit = cache[name.toLowerCase()];
      if (hit) return NextResponse.json(hit);
    }

    const model = await getBestModel();
    if (!model) {
      return cacheAndReturnOffline(name);
    }

    try {
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: ANALYSIS_PROMPT(name), stream: false, format: "json" }),
        signal: AbortSignal.timeout(90000),
      });

      const data: any = await response.json();
      if (data.error) {
        return NextResponse.json({ error: data.error, recommendedModel: RECOMMENDED_MODEL });
      }

      try {
        const parsed = JSON.parse(data.response);
        // Persist so subsequent scans skip Ollama for this process
        const cache = loadJson("process_cache.json");
        cache[name.toLowerCase()] = parsed;
        saveJson("process_cache.json", cache);
        return NextResponse.json(parsed);
      } catch {
        return NextResponse.json({ error: "Model returned invalid JSON — try re-analyzing" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
        return cacheAndReturnOffline(name);
      }
      return cacheAndReturnOffline(name);
    }
  } catch (err) {
    console.error("ERROR in api/analyze:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
