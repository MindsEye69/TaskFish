import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const PRIORITIES = new Set(["Idle", "BelowNormal", "Normal"]);

export async function POST(req: Request) {
  try {
    const { pid, priority } = await req.json();
    if (typeof pid !== "number" || pid <= 0 || !PRIORITIES.has(priority)) {
      return NextResponse.json({ error: "Invalid pid or priority" }, { status: 400 });
    }

    const safePid = Math.trunc(pid);
    const command = `$p=Get-Process -Id ${safePid} -ErrorAction SilentlyContinue; if($p){$p.PriorityClass='${priority}'; Write-Output 'ok'}else{Write-Output 'missing'}`;
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${command.replace(/"/g, '`"')}"`,
      { timeout: 10000 }
    );

    return NextResponse.json({ ok: stdout.includes("ok") });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
