import { NextResponse } from "next/server";
import { runPowerShell, loadJson } from "../api-helper";
import { getTrust, getCategory } from "@/lib/trust";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Joins Win32_Process with Win32_PerfFormattedData_PerfProc_Process to get real CPU %
    const query = `$perf=@{}; Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | % { $perf[$_.IDProcess] = $_.PercentProcessorTime }; Get-CimInstance Win32_Process | % { $cpu=0; if($perf.ContainsKey($_.ProcessId)){$cpu=$perf[$_.ProcessId]}; $_|Add-Member -NotePropertyName CpuPct -NotePropertyValue $cpu -PassThru } | Select-Object ProcessId,Name,ParentProcessId,WorkingSetSize,HandleCount,ExecutablePath,CpuPct | ConvertTo-Json -Compress`;
    const stdout = await runPowerShell(query);

    const cache = loadJson("process_cache.json");
    const rawRules = loadJson("rules.json");

    // Normalize all rule keys to lowercase-no-ext so mixed-case saves don't miss.
    const rules: Record<string, any> = {};
    for (const [k, v] of Object.entries(rawRules as Record<string, any>)) {
      rules[k.toLowerCase().replace(/\.exe$/i, "")] = v;
    }

    let processes: any[] = [];
    if (stdout.trim()) {
      const raw = JSON.parse(stdout.trim());
      const arr = Array.isArray(raw) ? raw : [raw];
      const ownPid = process.pid;

      processes = arr
        .filter((p: any) => p.ProcessId !== ownPid && p.ParentProcessId !== ownPid)
        .map((p: any) => {
          const name = p.Name || "Unknown";
          let trust = getTrust(name);
          const nameKey = name.toLowerCase();
          const ruleKey = nameKey.replace(/\.exe$/i, "");

          const rule = rules[ruleKey];
          if (rule?.manualControl) {
            // User has explicit control — skip cache reclassification.
            if (rule.overrideTrust && rule.overrideTrust !== "unknown") {
              trust = rule.overrideTrust;
            } else if (rule.action === "ALLOW") {
              trust = "verified";
            } else if (trust === "unknown") {
              trust = "background"; // acknowledged by user, remove from unknown panel
            }
          } else {
            const analysis = cache[nameKey];
            if (analysis) {
              if (analysis.verdict === "essential") trust = "trusted";
              else if (analysis.verdict === "safe") trust = "verified";
            }
            if (rule && rule.action === "ALLOW") trust = "verified";
          }

          return {
            id: p.ProcessId,
            name,
            ramMB: Math.round(((p.WorkingSetSize || 0) / (1024 * 1024)) * 100) / 100,
            cpu: Math.round((p.CpuPct || 0) * 10) / 10,
            ppid: p.ParentProcessId || 0,
            handles: p.HandleCount || 0,
            trust,
            category: getCategory(trust),
            execPath: p.ExecutablePath || "",
          };
        });
    }

    return NextResponse.json({
      processes,
      totalRAM: Math.round(processes.reduce((acc, p) => acc + p.ramMB, 0)),
      totalCPU: processes.reduce((acc, p) => acc + p.cpu, 0),
      unknownCount: processes.filter(p => p.trust === "unknown").length
    });
  } catch (err) {
    console.error("ERROR in api/processes:", err);
    return NextResponse.json({ error: String(err), processes: [] }, { status: 500 });
  }
}
