import { NextResponse } from "next/server";
import { loadJson, saveJson } from "../api-helper";
import type { EventCluster, EventHealthAnalysis, EventHealthFinding, EventHealthReport } from "@/lib/eventLog";

export const dynamic = "force-dynamic";

const MODEL_PREFERENCE = ["llama3.2:1b", "llama3.2:3b", "gemma3:4b", "gemma2:2b", "mistral", "phi3:mini", "llama2"];

async function getInstalledModels(): Promise<string[]> {
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const data = await r.json() as { models?: { name: string }[] };
    return (data.models ?? []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
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

function buildCacheKey(report: EventHealthReport): string {
  if (report.fileHash) return `sha256:${report.fileHash}`;
  const clusterSignature = report.clusters
    .map(c => `${c.key}:${c.level}:${c.count}:${c.firstSeen}:${c.lastSeen}`)
    .join("|");
  return `clusters:${report.fileName}:${report.totalEvents}:${clusterSignature}`;
}

function buildClusterSummary(clusters: EventCluster[]): string {
  const relevant = clusters.filter(c => c.category !== "likely-noise").slice(0, 20);
  const source = relevant.length > 0 ? relevant : clusters.slice(0, 8);
  return source.map(c =>
    `clusterId=${c.key} level=${c.levelName} category=${c.category} count=${c.count} firstSeen=${c.firstSeen || "unknown"} lastSeen=${c.lastSeen || "unknown"} summary=${c.summary}`
  ).join("\n");
}

function deterministic(report: EventHealthReport): EventHealthAnalysis {
  const findings: EventHealthFinding[] = [];
  const hasCorrelatedAppFailure = report.clusters.some(c =>
    !/distributedcom/i.test(c.provider) && (
      (/Application (Error|Hang)|Windows Error Reporting/i.test(c.provider) && [1000, 1001, 1002].includes(c.eventId)) ||
      (/Service Control Manager/i.test(c.provider) && [7023, 7031, 7034].includes(c.eventId))
    )
  );

  for (const cluster of report.clusters) {
    if (cluster.category === "likely-noise") continue;
    const isDcom = /DistributedCOM/i.test(cluster.provider) && (cluster.eventId === 10010 || cluster.eventId === 10016);

    const severity: EventHealthFinding["severity"] =
      isDcom ? "info" :
      cluster.level === 1 ? "critical" :
      cluster.level === 2 ? (cluster.count >= 5 ? "critical" : "warning") :
      "warning";

    const confidence: EventHealthFinding["confidence"] =
      isDcom ? "low" :
      cluster.level === 1 ? "high" :
      cluster.level === 2 ? "medium" : "low";

    const evidence: string[] = [`Occurred ${cluster.count} time${cluster.count !== 1 ? "s" : ""}`];
    if (cluster.firstSeen) evidence.push(`First seen: ${new Date(cluster.firstSeen).toLocaleString()}`);
    if (cluster.lastSeen && cluster.lastSeen !== cluster.firstSeen) {
      evidence.push(`Last seen: ${new Date(cluster.lastSeen).toLocaleString()}`);
    }
    if (cluster.sampleMessage) evidence.push(cluster.sampleMessage.split("\n")[0].slice(0, 120));

    const key = `${cluster.provider}:${cluster.eventId}`;
    let safeNextSteps: string[];
    let whenToIgnore: string;

    if (key.includes("Kernel-Power:41") || key.includes(":6008")) {
      safeNextSteps = [
        "Check Event Viewer for BSOD codes near the same timestamp",
        "Run Windows Memory Diagnostic: Start > mdsched.exe",
        "Inspect power supply connections and UPS if present",
      ];
      whenToIgnore = "Single occurrence immediately after a known power outage or deliberate shutdown.";
    } else if (key.includes("Service Control Manager")) {
      safeNextSteps = [
        "Open services.msc and verify the service is running",
        "Review the Application event log for the same time window",
      ];
      whenToIgnore = "If the service recovered automatically and is currently running normally.";
    } else if (key.includes("Security-Auditing:4625") || key.includes("Security-Auditing:4740")) {
      safeNextSteps = [
        "Review the failed login source in full event details",
        "If count is high, check for brute-force patterns",
        "Ensure account passwords are strong and MFA is enabled where available",
      ];
      whenToIgnore = "Low count, fewer than 5, from a known local machine only.";
    } else if (key.includes("Application Error:1000") || key.includes("Application Hang:1002")) {
      safeNextSteps = [
        "Note the faulting application name in event details",
        "Update or reinstall the crashing application",
        "Check Windows Update for relevant patches",
      ];
      whenToIgnore = "Single crash of a non-critical third-party app that has since been updated.";
    } else if (key.includes("disk:") || key.includes("ntfs:")) {
      safeNextSteps = [
        "Run chkdsk C: /f /r, replacing C: with the affected drive letter",
        "Check drive health with CrystalDiskInfo and review reallocated sector count",
        "Back up important data immediately before further investigation",
      ];
      whenToIgnore = "Disk errors should almost never be ignored; investigate promptly.";
    } else if (isDcom) {
      safeNextSteps = [
        "Ignore unless symptomatic; DistributedCOM 10010/10016 is usually harmless Windows background noise.",
        "If there are visible symptoms, correlate the timestamp with app crashes, service failures, or user-facing errors before changing anything.",
        "Install Windows updates and reboot before considering app-specific repair.",
      ];
      whenToIgnore = hasCorrelatedAppFailure
        ? "If the correlated app or service failure no longer occurs after update/reboot."
        : "If the system is otherwise stable with no correlated app failures, crashes, or services failing to start.";
    } else if (key.includes("WindowsUpdateClient")) {
      safeNextSteps = [
        "Run Windows Update manually: Settings > Windows Update > Check for updates",
        "Ensure the drive has sufficient free space, at least 10 GB, for updates",
      ];
      whenToIgnore = "If the same update has since succeeded.";
    } else if (key.includes("Kernel-PnP")) {
      safeNextSteps = [
        "Check Device Manager for yellow warning flags",
        "Update or reinstall the relevant device driver",
      ];
      whenToIgnore = "One-time occurrence during driver installation that has not recurred.";
    } else if (key.includes("Diagnostics-Performance")) {
      safeNextSteps = [
        "Review startup applications in Task Manager > Startup",
        "Consider adding RAM if this recurs frequently",
      ];
      whenToIgnore = "Occasional entries during heavy system load or first boot after updates are normal.";
    } else {
      safeNextSteps = [
        "Review full event details in Windows Event Viewer",
        `Search for Event ID ${cluster.eventId} ${cluster.provider}`,
      ];
      whenToIgnore = "If this is a one-time occurrence with no observable system impact.";
    }

    findings.push({
      clusterId: cluster.key,
      severity,
      confidence,
      explanation: cluster.summary,
      evidence,
      safeNextSteps,
      whenToIgnore,
    });
  }

  const critical = findings.filter(f => f.severity === "critical").length;
  const warning = findings.filter(f => f.severity === "warning").length;
  const summary = findings.length === 0
    ? "No significant findings detected. System event log appears healthy."
    : `${critical > 0 ? `${critical} critical` : ""}${critical > 0 && warning > 0 ? " and " : ""}${warning > 0 ? `${warning} warning` : ""} finding${findings.length !== 1 ? "s" : ""} identified across ${report.clusters.length} unique event cluster${report.clusters.length !== 1 ? "s" : ""}.`;

  return {
    overallHealth: report.overallHealth,
    summary,
    findings,
    analyzedAt: Date.now(),
    model: null,
    offline: true,
  };
}

function validateAnalysis(raw: unknown, report: EventHealthReport): EventHealthAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const validHealth = ["good", "watch", "attention", "urgent"];
  const overallHealth = validHealth.includes(r.overallHealth as string)
    ? r.overallHealth as EventHealthAnalysis["overallHealth"]
    : report.overallHealth;

  if (typeof r.summary !== "string" || !Array.isArray(r.findings)) return null;

  const validSeverity = ["critical", "warning", "info"];
  const validConfidence = ["high", "medium", "low"];
  const allowedClusterIds = new Set(report.clusters.filter(c => c.category !== "likely-noise").map(c => c.key));
  const findings: EventHealthFinding[] = [];

  for (const f of r.findings as unknown[]) {
    if (!f || typeof f !== "object") continue;
    const fObj = f as Record<string, unknown>;
    if (!validSeverity.includes(fObj.severity as string)) continue;
    if (!validConfidence.includes(fObj.confidence as string)) continue;
    if (typeof fObj.clusterId !== "string" || !allowedClusterIds.has(fObj.clusterId)) continue;
    if (typeof fObj.explanation !== "string" || !fObj.explanation) continue;

    findings.push({
      clusterId: fObj.clusterId,
      severity: fObj.severity as EventHealthFinding["severity"],
      confidence: fObj.confidence as EventHealthFinding["confidence"],
      explanation: fObj.explanation.slice(0, 500),
      evidence: Array.isArray(fObj.evidence) ? fObj.evidence.filter((e): e is string => typeof e === "string").slice(0, 5) : [],
      safeNextSteps: Array.isArray(fObj.safeNextSteps) ? fObj.safeNextSteps.filter((s): s is string => typeof s === "string").slice(0, 5) : [],
      whenToIgnore: typeof fObj.whenToIgnore === "string" ? fObj.whenToIgnore.slice(0, 500) : "",
    });
  }

  return { overallHealth, summary: r.summary.slice(0, 800), findings, analyzedAt: Date.now(), model: null, offline: false };
}

const EVENT_HEALTH_PROMPT = (clusterSummary: string, totalEvents: number, overallHealth: string): string =>
  `You are a Windows system health analyst. Analyze only this clustered Windows Event Log summary. Do not infer from raw events or request live scanning.

Total events: ${totalEvents}
Deterministic overall health signal: ${overallHealth}

Clustered event summary:
${clusterSummary}

Respond with only strict JSON matching this schema:
{
  "overallHealth": "good|watch|attention|urgent",
  "summary": "2-3 sentence overall assessment based only on the clusters",
  "findings": [
    {
      "clusterId": "exact clusterId from input",
      "severity": "critical|warning|info",
      "confidence": "high|medium|low",
      "explanation": "what this cluster means and why it matters",
      "evidence": ["specific count or timing detail from the cluster"],
      "safeNextSteps": ["safe Windows troubleshooting step"],
      "whenToIgnore": "specific condition where this cluster can be dismissed"
    }
  ]
}

Rules:
- Analyze clusters, not raw events.
- Only include findings for needs-attention or watch clusters; skip likely-noise entirely.
- DistributedCOM 10010 and 10016 are info severity and low confidence by default. Treat them as likely noise unless correlated crash, service-failure, or user-symptom evidence exists in the clusters; even then, do not make them critical or high confidence by themselves.
- Kernel-Power 41 and unexpected shutdowns are critical severity, high confidence.
- disk or ntfs events are critical severity regardless of count.
- Failed logins 4625: high count is critical; low count is warning.
- Keep explanations factual and concise.
- safeNextSteps must be concrete, low-risk steps a Windows user can take.`;

export async function POST(req: Request) {
  try {
    const { report } = await req.json() as { report: EventHealthReport };
    if (!report || !Array.isArray(report.clusters)) {
      return NextResponse.json({ error: "Missing or invalid report" }, { status: 400 });
    }

    const cacheKey = buildCacheKey(report);
    const cache = loadJson("event_health_cache.json") as Record<string, EventHealthAnalysis>;
    if (cache[cacheKey]) return NextResponse.json(cache[cacheKey]);

    const model = await getBestModel();
    if (model) {
      const clusterSummary = buildClusterSummary(report.clusters);
      const prompt = EVENT_HEALTH_PROMPT(clusterSummary, report.totalEvents, report.overallHealth);
      try {
        const response = await fetch("http://localhost:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
          signal: AbortSignal.timeout(120000),
        });
        const data = await response.json() as { error?: unknown; response?: string };
        if (!data.error && typeof data.response === "string") {
          const parsed = JSON.parse(data.response) as unknown;
          const validated = validateAnalysis(parsed, report);
          if (validated) {
            validated.model = model;
            cache[cacheKey] = validated;
            saveJson("event_health_cache.json", cache);
            return NextResponse.json(validated);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("ECONNREFUSED") && !msg.includes("timeout") && !msg.includes("connect")) {
          console.error("Ollama event-health error:", e);
        }
      }
    }

    const result = deterministic(report);
    cache[cacheKey] = result;
    saveJson("event_health_cache.json", cache);
    return NextResponse.json(result);
  } catch (err) {
    console.error("ERROR in event-health-analyze:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
