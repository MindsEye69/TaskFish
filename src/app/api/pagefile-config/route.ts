import { NextResponse } from "next/server";
import { assessPageFileConfiguration, PAGE_FILE_PROBE_SCRIPT } from "@/lib/pageFileAdvisor";
import { runPowerShell } from "../api-helper";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stdout = await runPowerShell(PAGE_FILE_PROBE_SCRIPT);
    return NextResponse.json(assessPageFileConfiguration(JSON.parse(stdout.trim())));
  } catch {
    return NextResponse.json({
      management: "unknown",
      automaticManaged: false,
      totalRamMB: 0,
      files: [],
      totalAllocatedMB: 0,
      totalCurrentUsageMB: 0,
      totalPeakUsageMB: 0,
      totalDriveFreeMB: 0,
      advice: {
        kind: "unavailable",
        title: "Pagefile settings unavailable",
        detail: "TaskFish could not read the current Windows pagefile configuration.",
      },
      volumes: [],
      placement: {
        kind: "review-volumes",
        title: "Pagefile placement unavailable",
        detail: "TaskFish could not compare the current pagefile drive with local storage volumes.",
        candidateDrives: [],
        requiredFreeMB: 0,
      },
    }, { status: 503 });
  }
}
