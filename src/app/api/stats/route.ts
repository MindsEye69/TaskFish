import { NextResponse } from "next/server";
import { runPowerShell } from "../api-helper";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const query = `$cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" | Select-Object -ExpandProperty PercentProcessorTime; $mem = Get-CimInstance Win32_OperatingSystem; $used = $mem.TotalVisibleMemorySize - $mem.FreePhysicalMemory; @{ cpu = [int]$cpu; ram = [int]($used / 1024) } | ConvertTo-Json -Compress`;
    const stdout = await runPowerShell(query);
    return NextResponse.json(JSON.parse(stdout.trim()));
  } catch (err) {
    console.error("ERROR in api/stats:", err);
    return NextResponse.json({ cpu: 0, ram: 0 });
  }
}
