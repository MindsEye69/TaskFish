import { NextRequest, NextResponse } from "next/server";
import { runPowerShell } from "../api-helper";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pidStr = searchParams.get("pid");
    const type = searchParams.get("type");

    if (!pidStr || !type) {
      return NextResponse.json({ error: "Missing pid or type" }, { status: 400 });
    }

    const pid = parseInt(pidStr, 10);
    if (isNaN(pid)) {
      return NextResponse.json({ error: "Invalid pid" }, { status: 400 });
    }

    if (type === "dlls") {
      const query = `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Modules | Select-Object ModuleName,FileName | ConvertTo-Json -Compress`;
      const stdout = await runPowerShell(query);
      if (!stdout.trim()) return NextResponse.json([]);
      const parsed = JSON.parse(stdout.trim());
      return NextResponse.json(Array.isArray(parsed) ? parsed : [parsed]);
    }

    if (type === "network") {
      const query = `$tcp = Get-NetTCPConnection -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State; $udp = Get-NetUDPEndpoint -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort; @{ tcp = $tcp; udp = $udp } | ConvertTo-Json -Compress`;
      const stdout = await runPowerShell(query);
      if (!stdout.trim()) return NextResponse.json({ tcp: [], udp: [] });
      const parsed = JSON.parse(stdout.trim());
      const cleanArray = (v: any) => v ? (Array.isArray(v) ? v : [v]) : [];
      return NextResponse.json({
        tcp: cleanArray(parsed.tcp),
        udp: cleanArray(parsed.udp)
      });
    }

    if (type === "services") {
      const query = `Get-CimInstance Win32_Service -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue | Select-Object Name,DisplayName,Status,StartMode | ConvertTo-Json -Compress`;
      const stdout = await runPowerShell(query);
      if (!stdout.trim()) return NextResponse.json([]);
      const parsed = JSON.parse(stdout.trim());
      return NextResponse.json(Array.isArray(parsed) ? parsed : [parsed]);
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (err) {
    console.error("ERROR in api/telemetry:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
