import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export function getUserDataPath(): string {
  const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
  const taskfishDir = path.join(appData, "taskfish");
  if (!fs.existsSync(taskfishDir)) {
    fs.mkdirSync(taskfishDir, { recursive: true });
  }
  return taskfishDir;
}

export function loadJson(fileName: string): any {
  const filePath = path.join(getUserDataPath(), fileName);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

export function saveJson(fileName: string, data: any) {
  const filePath = path.join(getUserDataPath(), fileName);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save JSON", e);
  }
}

export async function runPowerShell(query: string): Promise<string> {
  const { stdout } = await execAsync(
    `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${query.replace(/"/g, '`"')}"`,
    { maxBuffer: 20 * 1024 * 1024 }
  );
  return stdout;
}
