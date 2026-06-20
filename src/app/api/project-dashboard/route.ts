import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const PAPER_SLEUTH_ROOT = path.resolve(process.env.PAPER_SLEUTH_ROOT ?? path.join(os.homedir(), "Documents", "Paper Sleuth"));
const DASHBOARD_HOME = path.resolve(process.env.PROJECT_DASHBOARD_HOME ?? path.join(os.homedir(), ".codex", "project-dashboard"));
const CONFIG_PATH = path.resolve(process.env.PROJECT_DASHBOARD_CONFIG ?? path.join(DASHBOARD_HOME, "config.json"));

type DashboardAction =
  | "snapshot"
  | "refresh"
  | "session-start"
  | "session-close"
  | "save-notes"
  | "save-procedure"
  | "save-config"
  | "start-app"
  | "stop-app";

function projectRootFromRequest(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("projectRoot");
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (projectId) return projectRootFromConfig(projectId) ?? process.cwd();
  return requested ? path.resolve(requested) : process.cwd();
}

function projectRootFromConfig(projectId: string) {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as { projects?: { id?: string; path?: string }[] };
    const project = config.projects?.find(item => item.id === projectId);
    return project?.path ? path.resolve(project.path) : null;
  } catch {
    return null;
  }
}

function paperSleuthRootFromConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as { paperSleuthRoot?: string };
    return config.paperSleuthRoot ? path.resolve(config.paperSleuthRoot) : PAPER_SLEUTH_ROOT;
  } catch {
    return PAPER_SLEUTH_ROOT;
  }
}

async function runDashboardScript(action: DashboardAction, projectRoot: string, input?: string) {
  const scriptPath = path.join(process.cwd(), "scripts", "project-dashboard.mjs");
  const child = execFileAsync(process.execPath, [scriptPath, action, projectRoot], {
    cwd: process.cwd(),
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 16,
  });

  if (input !== undefined) {
    child.child.stdin?.end(input);
  }

  try {
    const { stdout } = await child;
    return JSON.parse(stdout);
  } catch (error) {
    const maybeStdout = typeof error === "object" && error && "stdout" in error ? String(error.stdout) : "";
    if (maybeStdout.trim()) {
      return JSON.parse(maybeStdout);
    }
    throw error;
  }
}

function isInsideRoot(root: string, absolutePath: string) {
  const relative = path.relative(root, absolutePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function openNativeFile(absolutePath: string) {
  spawn("cmd", ["/c", "start", "", absolutePath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

export async function GET(request: NextRequest) {
  try {
    const projectRoot = projectRootFromRequest(request);
    const result = await runDashboardScript("snapshot", projectRoot);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "refresh") as DashboardAction | "open-file" | "open-paper-sleuth-ticket";
    const projectRoot = body.projectRoot
      ? path.resolve(String(body.projectRoot))
      : body.projectId
        ? projectRootFromConfig(String(body.projectId)) ?? process.cwd()
        : process.cwd();

    if (action === "open-file") {
      const relativePath = String(body.path ?? "");
      const absolutePath = path.resolve(projectRoot, relativePath);
      if (!isInsideRoot(projectRoot, absolutePath) || !fs.existsSync(absolutePath)) {
        return NextResponse.json({ ok: false, error: "File is outside the project or does not exist." }, { status: 400 });
      }
      openNativeFile(absolutePath);
      return NextResponse.json({ ok: true });
    }

    if (action === "open-paper-sleuth-ticket") {
      const absolutePath = path.resolve(String(body.path ?? ""));
      if (!isInsideRoot(paperSleuthRootFromConfig(), absolutePath) || !fs.existsSync(absolutePath)) {
        return NextResponse.json({ ok: false, error: "Ticket is outside Paper Sleuth or does not exist." }, { status: 400 });
      }
      openNativeFile(absolutePath);
      return NextResponse.json({ ok: true });
    }

    if (!["refresh", "session-start", "session-close", "save-notes", "save-procedure", "save-config", "start-app", "stop-app"].includes(action)) {
      return NextResponse.json({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
    }

    const input = action === "save-notes"
      ? String(body.content ?? "")
      : action === "save-config"
        ? JSON.stringify(body.config ?? {}, null, 2)
      : action === "save-procedure"
        ? JSON.stringify({ procedure: body.procedure, flow: body.flow })
        : undefined;
    const result = await runDashboardScript(action, projectRoot, input);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
