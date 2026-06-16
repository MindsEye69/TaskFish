import { NextResponse } from "next/server";
import { runPowerShell } from "../api-helper";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const query = [
      `$cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" | Select-Object -ExpandProperty PercentProcessorTime`,
      `$m = Get-CimInstance Win32_OperatingSystem`,
      `$pf = @(Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue)`,
      `$pageAllocated = [int](($pf | Measure-Object -Property AllocatedBaseSize -Sum).Sum)`,
      `$pageUsed = [int](($pf | Measure-Object -Property CurrentUsage -Sum).Sum)`,
      `$totalRam = [int]($m.TotalVisibleMemorySize / 1024)`,
      `$freeRam = [int]($m.FreePhysicalMemory / 1024)`,
      `$commitLimit = [int]($m.TotalVirtualMemorySize / 1024)`,
      `$commitFree = [int]($m.FreeVirtualMemory / 1024)`,
      `$commitUsed = [Math]::Max(0, $commitLimit - $commitFree)`,
      `$pressure = if ($commitLimit -gt 0) { [int][Math]::Round(($commitUsed / $commitLimit) * 100) } else { 0 }`,
      `$needsPageFile = ($pageAllocated -lt 1024) -or (($commitLimit - $totalRam) -lt 2048) -or (($pressure -ge 85) -and (($pageAllocated - $pageUsed) -lt 4096))`,
      `@{ cpu = [int]$cpu; ram = ($totalRam - $freeRam); totalRam = $totalRam; freeRam = $freeRam; commitUsed = $commitUsed; commitLimit = $commitLimit; commitFree = $commitFree; commitPressure = $pressure; pageFileUsed = $pageUsed; pageFileAllocated = $pageAllocated; pageFileRecommended = $needsPageFile } | ConvertTo-Json -Compress`,
    ].join("; ");
    const stdout = await runPowerShell(query);
    return NextResponse.json(JSON.parse(stdout.trim()));
  } catch (err) {
    console.error("ERROR in api/stats:", err);
    return NextResponse.json({ cpu: 0, ram: 0 });
  }
}
