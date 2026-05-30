import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(req: Request) {
  let pid: number | undefined;
  try {
    const body = await req.json();
    pid = body.pid;
    const killTree = body.killTree;
    if (typeof pid !== "number") {
      return NextResponse.json({ error: "Invalid or missing pid" }, { status: 400 });
    }

    const cmd = killTree ? `taskkill /F /T /PID ${pid}` : `taskkill /F /PID ${pid}`;
    await execAsync(cmd);

    return NextResponse.json({ ok: true });
  } catch (err) {
    // If the process is already dead or access is denied, taskkill might return error.
    // We log and return ok: false or success depending on the situation, but matching main, we swallow or return status.
    console.error(`ERROR in api/kill for PID ${pid ?? "unknown"}:`, err);
    return NextResponse.json({ ok: false, error: String(err) });
  }
}
