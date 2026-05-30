const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const apiPath = path.join(rootDir, "src", "app", "api");
const apiBackupPath = path.join(rootDir, ".taskfish-build-api");

// 1. Kill any running TaskFish process (Windows only)
if (process.platform === "win32") {
  try {
    execSync("taskkill /F /IM TaskFish.exe", { stdio: "ignore" });
  } catch {}
}

// 2. Clean .next and out folders to prevent stale type checking errors from development
const nextDir = path.join(rootDir, ".next");
const outDir = path.join(rootDir, "out");
if (fs.existsSync(nextDir)) {
  try { fs.rmSync(nextDir, { recursive: true, force: true }); } catch {}
}
if (fs.existsSync(outDir)) {
  try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
}

let apiMoved = false;
try {
  // 3. Temporarily move API routes outside src/app to exclude them from static export build.
  if (fs.existsSync(apiPath)) {
    if (fs.existsSync(apiBackupPath)) fs.rmSync(apiBackupPath, { recursive: true, force: true });
    fs.cpSync(apiPath, apiBackupPath, { recursive: true });
    fs.rmSync(apiPath, { recursive: true, force: true });
    apiMoved = true;
    console.log("Temporarily moved src/app/api out of app for build.");
  }

  // 4. Run next build
  console.log("Running Next.js static build...");
  execSync("npx next build", {
    stdio: "inherit",
    cwd: rootDir,
    env: { ...process.env, TASKFISH_STATIC_EXPORT: "1" },
  });

} catch (err) {
  console.error("Build failed:", err);
  process.exitCode = 1;
} finally {
  // 5. Always restore API routes.
  if (apiMoved && fs.existsSync(apiBackupPath)) {
    if (fs.existsSync(apiPath)) fs.rmSync(apiPath, { recursive: true, force: true });
    fs.cpSync(apiBackupPath, apiPath, { recursive: true });
    fs.rmSync(apiBackupPath, { recursive: true, force: true });
    console.log("Restored src/app/api.");
  }
}

// 6. If Next.js build succeeded, run tsc and electron-builder
if (process.exitCode !== 1) {
  try {
    console.log("Compiling Electron files...");
    execSync("npx tsc -p tsconfig.electron.json", { stdio: "inherit", cwd: rootDir });

    console.log("Packaging Electron app...");
    execSync("npx electron-builder", { stdio: "inherit", cwd: rootDir });
  } catch (err) {
    console.error("Packaging failed:", err);
    process.exitCode = 1;
  }
}
