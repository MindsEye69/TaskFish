const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { pipeline } = require("stream/promises");

const rootDir = path.join(__dirname, "..");
const apiPath = path.join(rootDir, "src", "app", "api");
const apiBackupPath = path.join(rootDir, ".taskfish-build-api");
const resourcesBinDir = path.join(rootDir, "resources", "bin");
const ollamaExePath = path.join(resourcesBinDir, "ollama.exe");
const ollamaZipPath = path.join(resourcesBinDir, "ollama-windows-amd64.zip");
const ollamaAssetName = "ollama-windows-amd64.zip";

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "TaskFish build" } }, async (res) => {
      try {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          resolve(downloadFile(res.headers.location, destination));
          res.resume();
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed ${res.statusCode}: ${url}`));
          res.resume();
          return;
        }
        await pipeline(res, fs.createWriteStream(destination));
        resolve();
      } catch (e) {
        reject(e);
      }
    }).on("error", reject);
  });
}

async function ensureOllamaBinary() {
  if (process.platform !== "win32") return;
  if (fs.existsSync(ollamaExePath)) {
    console.log("Bundled Ollama binary already present.");
    return;
  }
  if (process.env.TASKFISH_SKIP_OLLAMA_DOWNLOAD === "1") {
    if (process.env.TASKFISH_ALLOW_MISSING_OLLAMA === "1") {
      console.warn("Skipping Ollama download and allowing missing resources/bin/ollama.exe for a non-installer local build.");
      return;
    }
    throw new Error("resources/bin/ollama.exe is missing. Unset TASKFISH_SKIP_OLLAMA_DOWNLOAD or set TASKFISH_ALLOW_MISSING_OLLAMA=1 for a non-installer local build.");
  }

  fs.mkdirSync(resourcesBinDir, { recursive: true });
  console.log("Downloading Ollama Windows binary for installer resources...");
  const releaseUrl = process.env.OLLAMA_VERSION
    ? `https://github.com/ollama/ollama/releases/download/${process.env.OLLAMA_VERSION}/${ollamaAssetName}`
    : `https://github.com/ollama/ollama/releases/latest/download/${ollamaAssetName}`;

  await downloadFile(releaseUrl, ollamaZipPath);
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '${ollamaZipPath.replace(/'/g, "''")}' -DestinationPath '${resourcesBinDir.replace(/'/g, "''")}' -Force"`, {
    stdio: "inherit",
    cwd: rootDir,
  });
  fs.rmSync(ollamaZipPath, { force: true });
  if (!fs.existsSync(ollamaExePath)) {
    throw new Error("Downloaded Ollama archive did not contain ollama.exe.");
  }
}

async function main() {
  await ensureOllamaBinary();

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
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exitCode = 1;
});
