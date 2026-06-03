import { app, BrowserWindow, Notification, ipcMain, Menu, Tray, nativeImage, WebContents, dialog } from "electron";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { spawn, exec, execFile, ChildProcess } from "child_process";
import { getTrust, getCategory } from "../src/lib/trust";
import { createProfileId, ensureProfilesData, findProfile, normalizeProfileRules } from "../src/lib/profiles";
import { parseWevtutilXml, clusterEvents } from "../src/lib/eventLog";
import type { EventHealthReport, EventHealthAnalysis, EventCluster, EventHealthFinding } from "../src/lib/eventLog";

// --- PERSISTENT POWERSHELL SESSION ---
// One long-lived process handles all queries; eliminates per-poll spawning.
const SENTINEL = "__TF_DONE__";

class PersistentPS {
  private proc: ChildProcess | null = null;
  private buf = "";
  private queue: { cmd: string; resolve: (s: string) => void; reject: (e: Error) => void }[] = [];
  private running = false;

  private start() {
    this.proc = spawn("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-NoLogo", "-NoExit", "-Command", "-"],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    this.proc.stdout!.on("data", (data: Buffer) => {
      this.buf += data.toString();
      const idx = this.buf.indexOf(SENTINEL);
      if (idx !== -1) {
        const result = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + SENTINEL.length);
        this.running = false;
        const item = this.queue.shift();
        if (item) item.resolve(result);
        this.next();
      }
    });
    this.proc.stderr!.on("data", () => {}); // swallow stderr
    this.proc.on("exit", () => {
      this.proc = null;
      this.running = false;
      if (this.queue.length > 0) this.next(); // restart for pending work
    });
  }

  private next() {
    if (this.running || this.queue.length === 0) return;
    if (!this.proc || this.proc.killed) this.start();
    this.running = true;
    const { cmd } = this.queue[0];
    this.proc!.stdin!.write(`${cmd}\nWrite-Output "${SENTINEL}"\n`);
  }

  run(cmd: string, timeoutMs = 12000): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      const item = {
        cmd,
        resolve: (s: string) => done(() => resolve(s)),
        reject: (e: Error) => done(() => reject(e)),
      };

      this.queue.push(item);
      if (!this.running) this.next();

      setTimeout(() => {
        // Reject the caller but leave the item in the queue so the sentinel
        // stays in sync with PS output. When the sentinel eventually arrives,
        // item.resolve() calls done() → ignored (settled). Queue resumes normally.
        done(() => reject(new Error("PS timed out")));
      }, timeoutMs);
    });
  }

  kill() {
    this.queue = [];
    this.running = false;
    if (this.proc) { try { this.proc.kill(); } catch (_) {} this.proc = null; }
  }

  get pid(): number | undefined { return this.proc?.pid; }
}

const ps = new PersistentPS();

// safeExec for non-PS one-offs (taskkill, reg.exe, etc.)
function safeExec(command: string, options: any = {}): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: 10000, encoding: "utf8", windowsHide: true, ...options },
      (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout: String(stdout) });
      }
    );
  });
}

function safeExecFile(file: string, args: string[], options: any = {}): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10000, encoding: "utf8", windowsHide: true, ...options },
      (error, stdout) => {
        if (error) reject(error);
        else resolve({ stdout: String(stdout) });
      }
    );
  });
}

// --- DEBUG LOGGING ---
let logPath = "";
function initLog() {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    logPath = path.join(logDir, "taskfish_debug.txt");
    fs.appendFileSync(logPath, `\n\n--- SESSION START: ${new Date().toISOString()} ---\n`);
  } catch (e) {
    console.error("Failed to init log", e);
  }
}

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  if (logPath) {
    try { fs.appendFileSync(logPath, line); } catch(e) {}
  }
}

initLog();
log("APP STARTING...");

// --- PATHS ---
const userDataPath = app.getPath("userData");
const cachePath     = path.join(userDataPath, "process_cache.json");
const rulesPath     = path.join(userDataPath, "rules.json");
const iconCachePath = path.join(userDataPath, "icon_cache.json");
const metaCachePath = path.join(userDataPath, "process_metadata_cache.json");
const auditLogPath   = path.join(userDataPath, "audit_log.json");
const enforcementSettingsPath = path.join(userDataPath, "enforcement_settings.json");
const profilesPath = path.join(userDataPath, "profiles.json");
const eventHealthCachePath = path.join(userDataPath, "event_health_cache.json");

const iconCacheMap  = new Map<string, string>();
const limitedPriorityPids = new Set<number>();
const bannedPids = new Set<number>();
const PROTECTED_PROCESS_NAMES = new Set([
  "explorer", "svchost", "lsass", "csrss", "services", "wininit", "winlogon",
  "smss", "system", "registry", "taskfish", "node", "powershell", "pwsh",
]);
const execPathCache = new Map<string, string>(); // processName.lower → executable path

// --- ICON CACHE HELPERS ---
let iconSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSaveIconCache() {
  if (iconSaveTimer) clearTimeout(iconSaveTimer);
  iconSaveTimer = setTimeout(() => {
    const data: Record<string, string> = {};
    iconCacheMap.forEach((v, k) => { if (v !== "NO_ICON") data[k] = v; });
    saveJson(iconCachePath, data);
    iconSaveTimer = null;
  }, 1500);
}

function loadJson(p: string) {
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch(e) { return {}; }
  }
  return {};
}

function saveJson(p: string, data: any) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); } catch(e) {}
}

function appendAudit(type: string, message: string, details: any = {}) {
  const existing = loadJson(auditLogPath);
  const entries = Array.isArray(existing) ? existing : [];
  entries.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, ts: Date.now(), type, message, details });
  saveJson(auditLogPath, entries.slice(-250));
}

function notify(title: string, body: string) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (e) {
    log("Notification failed: " + String(e));
  }
}

function normalizeRuleName(name: string) {
  return (name || "").toLowerCase().replace(/\.exe$/i, "");
}

function normalizeRules(rawRules: Record<string, any>) {
  const rules: Record<string, any> = {};
  for (const [k, v] of Object.entries(rawRules || {})) {
    rules[normalizeRuleName(k)] = v;
  }
  return rules;
}

function isProtectedProcessName(name: string) {
  return PROTECTED_PROCESS_NAMES.has(normalizeRuleName(name));
}

function offlineAnalysis(name: string) {
  const trust = getTrust(name);
  const category = getCategory(trust);
  if (trust === "trusted") {
    return {
      verdict: "essential",
      title: name,
      description: `${name} matches TaskFish's built-in trusted Windows process list.`,
      tip: "Keep this process allowed.",
      gameModeSafe: true,
      suggestedRule: { action: "ALLOW", autoKillMins: null },
      riskScore: 0,
      threatFlags: [],
      offline: true,
    };
  }
  if (trust === "verified") {
    return {
      verdict: "safe",
      title: name,
      description: `${name} matches TaskFish's built-in verified application list.`,
      tip: "Allow this process unless you do not use the associated app.",
      gameModeSafe: false,
      suggestedRule: { action: "ALLOW", autoKillMins: null },
      riskScore: 5,
      threatFlags: [],
      offline: true,
    };
  }
  if (category === "background") {
    return {
      verdict: "background",
      title: name,
      description: `${name} looks like a background helper or service based on its name.`,
      tip: "Limit it during gaming if it consumes noticeable resources.",
      gameModeSafe: true,
      suggestedRule: { action: "LIMITED", autoKillMins: null },
      riskScore: 20,
      threatFlags: [],
      offline: true,
    };
  }
  return {
    verdict: "caution",
    title: name,
    description: `${name} is not recognized by TaskFish's built-in process list.`,
    tip: "Review its executable path and signature before allowing it permanently.",
    gameModeSafe: false,
    suggestedRule: { action: "NONE", autoKillMins: null },
    riskScore: 50,
    threatFlags: ["unknown_process"],
    offline: true,
  };
}

async function setProcessPriority(pid: number, priority: "Idle" | "BelowNormal" | "Normal") {
  if (!Number.isFinite(pid) || pid <= 0) return { ok: false, error: "Invalid pid" };
  const safePid = Math.trunc(pid);
  const query = `$p=Get-Process -Id ${safePid} -ErrorAction SilentlyContinue; if($p){$p.PriorityClass='${priority}'; @{ok=$true; pid=${safePid}; priority='${priority}'} | ConvertTo-Json -Compress}else{@{ok=$false; error='Process not found'} | ConvertTo-Json -Compress}`;
  try {
    const stdout = await ps.run(query);
    return stdout.trim() ? JSON.parse(stdout.trim()) : { ok: false, error: "No response" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function killPid(pid: number, killTree: boolean) {
  if (!Number.isFinite(pid) || pid <= 0) return;
  const safePid = Math.trunc(pid);
  await safeExec(killTree ? `taskkill /F /T /PID ${safePid}` : `taskkill /F /PID ${safePid}`).catch(() => {});
}

async function enforceProcessRules(processes: { id: number; name: string }[], rules: Record<string, any>) {
  const actions: any[] = [];
  const currentLimited = new Set<number>();

  for (const proc of processes || []) {
    const rule = rules?.[proc.name] || rules?.[normalizeRuleName(proc.name)];
    if (!rule || rule.action === "NONE" || !Number.isFinite(proc.id) || proc.id <= 0) continue;

    if (rule.action === "BAN") {
      if (isProtectedProcessName(proc.name)) {
        appendAudit("safety", `Blocked unsafe BAN rule for protected process ${proc.name}`, { pid: proc.id, name: proc.name });
        actions.push({ type: "SAFETY", name: proc.name, pid: proc.id });
        continue;
      }
      if (!bannedPids.has(proc.id)) {
        bannedPids.add(proc.id);
        await killPid(proc.id, true);
        appendAudit("ban", `Blocked banned process ${proc.name}`, { pid: proc.id, name: proc.name });
        notify("TaskFish blocked a banned process", `${proc.name} was terminated.`);
        actions.push({ type: "BAN", name: proc.name, pid: proc.id });
      }
      continue;
    }

    if (rule.action === "LIMITED") {
      currentLimited.add(proc.id);
      if (!limitedPriorityPids.has(proc.id)) {
        const result = await setProcessPriority(proc.id, "Idle");
        if (result.ok) {
          limitedPriorityPids.add(proc.id);
          appendAudit("limited", `Limited ${proc.name} to idle priority`, { pid: proc.id, name: proc.name });
          actions.push({ type: "LIMITED", name: proc.name, pid: proc.id });
        }
      }
    }
  }

  for (const pid of [...limitedPriorityPids]) {
    if (!currentLimited.has(pid)) {
      await setProcessPriority(pid, "Normal");
      limitedPriorityPids.delete(pid);
    }
  }

  return { ok: true, actions };
}

// ===========================================================================
// METADATA CACHE — stores signature/company info per executable path
// ===========================================================================
interface MetadataEntry {
  company:     string;
  description: string;
  signer:      string;
  sigStatus:   string;
  ts:          number; // epoch ms; expire after 7 days
}

const META_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
let metaCache: Record<string, MetadataEntry> = {};
let metaSaveTimer: ReturnType<typeof setTimeout> | null = null;

function loadMetaCache() {
  metaCache = loadJson(metaCachePath);
  // Prune stale entries
  const now = Date.now();
  let pruned = 0;
  for (const key of Object.keys(metaCache)) {
    if (now - (metaCache[key].ts ?? 0) > META_CACHE_TTL_MS) {
      delete metaCache[key];
      pruned++;
    }
  }
  if (pruned > 0) saveJson(metaCachePath, metaCache);
  log(`Loaded ${Object.keys(metaCache).length} metadata cache entries (pruned ${pruned})`);
}

function scheduleMetaSave() {
  if (metaSaveTimer) clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(() => {
    saveJson(metaCachePath, metaCache);
    metaSaveTimer = null;
  }, 1500);
}

// ===========================================================================
// BACKGROUND SIGNATURE VERIFIER
// Auto-promotes Microsoft & Google signed binaries silently.
// ===========================================================================
const TRUSTED_SIGNERS = ["microsoft", "google llc", "google inc", "google"];
const verifyQueue     = new Set<string>(); // "execPath|||processName"
let   workerRunning   = false;

function queueVerification(execPath: string, processName: string) {
  const key = execPath.toLowerCase();
  if (metaCache[key]) return; // already audited — skip
  verifyQueue.add(`${execPath}|||${processName}`);
  if (!workerRunning) runVerifyWorker();
}

async function runVerifyWorker() {
  workerRunning = true;
  for (const item of [...verifyQueue]) {
    verifyQueue.delete(item);
    const sep = item.indexOf("|||");
    if (sep === -1) continue;
    const execPath   = item.slice(0, sep);
    const processName = item.slice(sep + 3);
    await auditAndPromote(execPath, processName);
    await new Promise(r => setTimeout(r, 380)); // throttle: ~2-3 audits/sec
  }
  workerRunning = false;
}

async function auditAndPromote(execPath: string, processName: string) {
  if (!fs.existsSync(execPath)) return;
  const key = execPath.toLowerCase();
  if (metaCache[key]) return;

  try {
    const escaped = execPath.replace(/'/g, "''");
    const query   = `$ver=(Get-Item -Path '${escaped}' -EA SilentlyContinue).VersionInfo; $sig=(Get-AuthenticodeSignature -FilePath '${escaped}' -EA SilentlyContinue); @{Company=$ver.CompanyName;Description=$ver.FileDescription;Signer=$sig.SignerCertificate.Subject;Status=$sig.Status.ToString()} | ConvertTo-Json -Compress`;
    const stdout  = await ps.run(query).catch(() => "");
    if (!stdout.trim()) return;

    const m = JSON.parse(stdout.trim());

    const entry: MetadataEntry = {
      company:     m.Company     || "",
      description: m.Description || "",
      signer:      m.Signer      || "",
      sigStatus:   m.Status      || "Unknown",
      ts:          Date.now(),
    };
    metaCache[key] = entry;
    scheduleMetaSave();

    // Check if signer matches a trusted vendor
    const signerLower = (entry.signer + " " + entry.company).toLowerCase();
    const isMicrosoft = signerLower.includes("microsoft");
    const isGoogle    = TRUSTED_SIGNERS.slice(1).some(s => signerLower.includes(s));

    if (entry.sigStatus === "Valid" && (isMicrosoft || isGoogle)) {
      const vendorLabel = isMicrosoft ? "Microsoft" : "Google";
      // Both Microsoft and Google → verdict "essential" → trust="trusted" (blue)
      const verdict = "essential";

      // Write to process_cache.json (drives trust promotion on next poll)
      const cache = loadJson(cachePath);
      const nameKey = processName.toLowerCase();
      if (!cache[nameKey] || !(cache[nameKey].description)) {
        cache[nameKey] = {
          verdict,
          title:       entry.description || processName,
          description: `${entry.description || processName} — digitally verified by ${vendorLabel} (${entry.company || vendorLabel}).`,
          tip:         `This process carries a valid ${vendorLabel} Authenticode signature and is safe to allow.`,
          gameModeSafe: isMicrosoft, // Google apps not always game-mode safe
          suggestedRule: { action: "ALLOW" },
          riskScore:     0,
          threatFlags:  [],
        };
        saveJson(cachePath, cache);
        log(`[VERIFIER] Auto-promoted: ${processName} → ${vendorLabel}`);
      }

      // Silently auto-whitelist in rules.json
      const rules = loadJson(rulesPath);
      if (!rules[processName]) {
        rules[processName] = { action: "ALLOW", autoKillMins: null };
        saveJson(rulesPath, rules);
        log(`[VERIFIER] Auto-whitelisted: ${processName}`);
      }
    }
  } catch (e) {
    log(`[VERIFIER] Error auditing ${execPath}: ${e}`);
  }
}

// ===========================================================================
// CPU PER-PROCESS — two-poll approach
// ===========================================================================
interface CpuSample { k: number; u: number; ts: number; }
const cpuSamples = new Map<number, CpuSample>(); // PID → last sample
let   numCores   = 0; // cached after first poll

function calcCpuPct(pid: number, kTime: number, uTime: number, ts100ns: number): number {
  const prev = cpuSamples.get(pid);
  cpuSamples.set(pid, { k: kTime, u: uTime, ts: ts100ns });
  if (!prev || numCores === 0) return 0;
  const deltaWork = (kTime - prev.k) + (uTime - prev.u);
  const deltaTime = ts100ns - prev.ts;
  if (deltaTime <= 0) return 0;
  // percentage of total system CPU (all cores)
  const pct = (deltaWork / (deltaTime * numCores)) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10;
}

// --- SIDECAR MANAGER ---
let ollamaProcess: ChildProcess | null = null;

async function startOllama(): Promise<boolean> {
  log("Starting Ollama...");

  try {
    const probe = await fetch("http://localhost:11434/api/version", {
      signal: AbortSignal.timeout(1500),
    });
    if (probe.ok) {
      log("Ollama already running — skipping launch");
      return true;
    }
  } catch {}

  if (ollamaProcess) return true;

  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "bin", "ollama.exe"));
  } else {
    candidates.push(path.join(app.getAppPath(), "ollama.exe"));
    candidates.push(path.join(app.getAppPath(), "resources", "bin", "ollama.exe"));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"));
  }
  candidates.push("C:\\Program Files\\Ollama\\ollama.exe");

  let binPath = candidates.find(p => { try { return fs.existsSync(p); } catch { return false; } });

  if (!binPath) {
    try {
      const { stdout } = await safeExec("where ollama", { timeout: 3000 });
      const found = stdout.trim().split(/\r?\n/)[0].trim();
      if (found && fs.existsSync(found)) binPath = found;
    } catch {}
  }

  if (!binPath) {
    log("Ollama NOT FOUND — install from https://ollama.com");
    return false;
  }

  log("Starting Ollama at: " + binPath);
  ollamaProcess = exec(`"${binPath}" serve`, { windowsHide: true });
  ollamaProcess.on("exit", () => {
    ollamaProcess = null;
    // Don't broadcast idle during "starting" or "pulling" — ensureDefaultModel owns those transitions.
    if (currentAiStatus.phase !== "pulling" && currentAiStatus.phase !== "starting") {
      broadcastAiStatus({ phase: "idle" });
    }
  });

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch("http://localhost:11434/api/version", { signal: AbortSignal.timeout(600) });
      if (r.ok) { log("Ollama ready"); return true; }
    } catch {}
    await new Promise(r => setTimeout(r, 600));
  }
  log("Ollama did not become ready within 20s");
  return false;
}

function stopOllama() {
  if (ollamaProcess) {
    ollamaProcess.kill();
    ollamaProcess = null;
  }
  if (currentAiStatus.phase !== "pulling") {
    broadcastAiStatus({ phase: "idle" });
  }
}

// --- APP WINDOW ---
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let enforcementTimer: ReturnType<typeof setInterval> | null = null;
let enforcementRunning = false;
let enforcementActive = loadJson(enforcementSettingsPath)?.rulesActive !== false;
let lastEnforcementActions = 0;

function saveEnforcementSettings() {
  saveJson(enforcementSettingsPath, { rulesActive: enforcementActive });
}

function getTrayIcon() {
  const iconPath = path.join(__dirname, "../../build/icon.ico");
  if (fs.existsSync(iconPath)) return iconPath;
  return nativeImage.createEmpty();
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openSecurityCenter() {
  showMainWindow();
  mainWindow?.webContents.send("open-security-center");
}

function updateTrayMenu() {
  if (!tray) return;
  const state = enforcementActive ? "active" : "paused";
  const actionText = lastEnforcementActions === 1 ? "1 recent action" : `${lastEnforcementActions} recent actions`;
  tray.setToolTip(`TaskFish - rules ${state} - ${actionText}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: mainWindow?.isVisible() ? "Hide TaskFish" : "Show TaskFish", click: () => mainWindow?.isVisible() ? mainWindow.hide() : showMainWindow() },
    {
      label: enforcementActive ? "Pause Rules" : "Activate Rules",
      click: () => setEnforcementActive(!enforcementActive, true),
    },
    { label: "Open Security Center", click: openSecurityCenter },
    { type: "separator" },
    {
      label: "Quit TaskFish",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function setEnforcementActive(active: boolean, shouldAudit = false) {
  if (enforcementActive === active) return enforcementActive;
  enforcementActive = active;
  saveEnforcementSettings();
  if (shouldAudit) {
    appendAudit("rules", active ? "Rule enforcement enabled" : "Rule enforcement paused", { source: "tray" });
    notify("TaskFish rule enforcement", active ? "Rules are active." : "Rules are paused.");
  }
  updateTrayMenu();
  return enforcementActive;
}

async function collectProcessRefs() {
  const query = `Get-CimInstance Win32_Process | Select-Object ProcessId,Name | ConvertTo-Json -Compress`;
  const stdout = await ps.run(query);
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout.trim());
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const ownPid = process.pid;
  const psPid = ps.pid;
  return items
    .filter((p: any) => p.ProcessId !== ownPid && p.ProcessId !== psPid)
    .map((p: any) => ({ id: Number(p.ProcessId), name: normalizeRuleName(p.Name || "") }))
    .filter((p: { id: number; name: string }) => Number.isFinite(p.id) && p.id > 0 && p.name);
}

async function runBackgroundEnforcement() {
  if (!enforcementActive || enforcementRunning) return;
  enforcementRunning = true;
  try {
    const processes = await collectProcessRefs();
    const rules = normalizeRules(loadJson(rulesPath) as Record<string, any>);
    const result = await enforceProcessRules(processes, rules);
    if (result.actions.length > 0) {
      lastEnforcementActions = result.actions.length;
      updateTrayMenu();
      mainWindow?.webContents.send("rules-enforced", result.actions);
    }
  } catch (e) {
    log("Background enforcement failed: " + String(e));
  } finally {
    enforcementRunning = false;
  }
}

function startBackgroundEnforcement() {
  if (enforcementTimer) return;
  enforcementTimer = setInterval(runBackgroundEnforcement, 5000);
  runBackgroundEnforcement();
}

function createTray() {
  if (tray) return;
  tray = new Tray(getTrayIcon());
  tray.on("click", () => showMainWindow());
  updateTrayMenu();
}

function createWindow() {
  const savedIcons = loadJson(iconCachePath) as Record<string, string>;
  // Only load positive icon hits — skip stale NO_ICON entries so they can be retried
  Object.entries(savedIcons).forEach(([k, v]) => { if (v && v !== "NO_ICON") iconCacheMap.set(k, v); });
  log(`Loaded ${iconCacheMap.size} icons from disk cache`);

  loadMetaCache();

  log("Creating window...");
  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    backgroundColor: "#191926",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#191926", symbolColor: "#f0f0f8", height: 40 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
    notify("TaskFish is still protecting you", "Rule enforcement continues in the system tray.");
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log(`did-fail-load: code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    log(`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    log(`[RENDER CONSOLE] [Level ${level}] ${message} (at ${sourceId}:${line})`);
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.webContents.openDevTools(); // temporary debug
    mainWindow.loadFile(path.join(__dirname, "../../out/index.html"));
  }
}

app.whenReady().then(() => {
  createTray();
  createWindow();
  startBackgroundEnforcement();
  void ensureDefaultModel();
});
app.on("activate", showMainWindow);
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  isQuitting = true;
  if (enforcementTimer) clearInterval(enforcementTimer);
  ps.kill();
  stopOllama();
});

// --- IPC HANDLERS ---

ipcMain.handle("get-cached-analysis", async (_e, name: string) => {
  const cache = loadJson(cachePath);
  return cache[name.toLowerCase()] || null;
});

ipcMain.handle("get-all-cached-analyses", async () => {
  return loadJson(cachePath);
});

ipcMain.handle("save-analysis", async (_e, name: string, data: any) => {
  const cache = loadJson(cachePath);
  cache[name.toLowerCase()] = data;
  saveJson(cachePath, cache);
});

ipcMain.handle("write-scan-log", async (_e, entries: { name: string; verdict: string; action: string; title: string; tip: string }[]) => {
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "deep_scan_log.txt");

    const timestamp = new Date().toLocaleString();
    const divider = "-".repeat(80);
    const header = [
      "TaskFish Deep Scan Log",
      `Generated: ${timestamp}`,
      divider,
      `${"Process".padEnd(28)} ${"Verdict".padEnd(12)} ${"Rule".padEnd(10)} Description`,
      divider,
    ].join("\n");

    const lines = entries.map(e =>
      `${e.name.padEnd(28)} ${e.verdict.padEnd(12)} ${e.action.padEnd(10)} ${e.tip || ""}`
    );

    const existing = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8") : "";
    const separator = existing ? "\n\n" : "";
    fs.writeFileSync(logFile, existing + separator + header + "\n" + lines.join("\n"), "utf-8");
    log("Scan log written to: " + logFile);
    return logFile;
  } catch (err) {
    log("Failed to write scan log: " + String(err));
    return null;
  }
});

ipcMain.handle("get-rules", async () => loadJson(rulesPath));

ipcMain.handle("save-rule", async (_e, { name, config }) => {
  const rules = loadJson(rulesPath);
  const key = normalizeRuleName(name);
  if (key !== name) delete rules[name];
  if (config?.action === "NONE" && config?.autoKillMins == null && !config?.manualControl) delete rules[key];
  else rules[key] = config;
  saveJson(rulesPath, rules);
  appendAudit("rule", `Rule updated for ${key}: ${config?.action ?? "NONE"}`, { name: key, config });
});

ipcMain.handle("get-profiles", async () => ensureProfilesData(loadJson(profilesPath)));

ipcMain.handle("apply-profile", async (_e, profileId: string) => {
  const profiles = ensureProfilesData(loadJson(profilesPath));
  const profile = findProfile(profiles, profileId);
  if (!profile) return { ok: false, rules: loadJson(rulesPath), profiles };

  const rules = normalizeProfileRules(profile.rules);
  saveJson(rulesPath, rules);
  const nextProfiles = { ...profiles, activeProfileId: profile.id };
  saveJson(profilesPath, nextProfiles);
  appendAudit("profile", `Applied profile ${profile.name}`, { profileId: profile.id, rules: Object.keys(rules).length });
  updateTrayMenu();
  return { ok: true, rules, profiles: nextProfiles };
});

ipcMain.handle("save-profile", async (_e, { name, rules }: { name: string; rules: Record<string, any> }) => {
  const profileName = String(name || "").trim();
  if (!profileName) return ensureProfilesData(loadJson(profilesPath));

  const profiles = ensureProfilesData(loadJson(profilesPath));
  const id = createProfileId(profileName);
  const savedProfile = {
    id,
    name: profileName,
    description: `${Object.keys(rules || {}).length} saved rule(s).`,
    rules: normalizeProfileRules(rules),
    updatedAt: Date.now(),
  };
  const nextProfiles = {
    activeProfileId: id,
    profiles: [...profiles.profiles.filter(profile => profile.builtIn || profile.id !== id), savedProfile],
  };
  saveJson(profilesPath, nextProfiles);
  saveJson(rulesPath, savedProfile.rules);
  appendAudit("profile", `Saved profile ${profileName}`, { profileId: id, rules: Object.keys(savedProfile.rules).length });
  return nextProfiles;
});

ipcMain.handle("get-audit-log", async () => {
  const entries = loadJson(auditLogPath);
  return Array.isArray(entries) ? entries : [];
});

ipcMain.handle("append-audit", async (_e, { type, message, details }: { type: string; message: string; details?: unknown }) => {
  appendAudit(type, message, details ?? {});
});

ipcMain.handle("notify", async (_e, { title, body }: { title: string; body: string }) => {
  notify(title, body);
});

// ===========================================================================
// get-processes — combined query with CPU perf data
// ===========================================================================
ipcMain.handle("get-processes", async () => {
  try {
    // Combined query: processes + perf counters + cores (cores cached via PS global)
    const query = `
$procs = Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ParentProcessId,WorkingSetSize,HandleCount,ExecutablePath
$perf  = Get-CimInstance Win32_PerfRawData_PerfProc_Process | Select-Object IDProcess,KernelModeTime,UserModeTime,Timestamp_Sys100NS
if (-not $global:tfCores) { $global:tfCores = [int](Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors }
@{ procs=$procs; perf=$perf; cores=$global:tfCores } | ConvertTo-Json -Depth 3 -Compress`.trim();

    const stdout = await ps.run(query);

    const cache = loadJson(cachePath);
    // Normalize all rule keys to lowercase-no-ext so mixed-case saves don't miss.
    const rules: Record<string, any> = {};
    for (const [k, v] of Object.entries(loadJson(rulesPath) as Record<string, any>)) {
      rules[normalizeRuleName(k)] = v;
    }

    if (!stdout.trim()) return { processes: [], totalRAM: 0, totalCPU: 0, unknownCount: 0 };

    const raw = JSON.parse(stdout.trim());
    const procsArr: any[] = raw.procs ? (Array.isArray(raw.procs) ? raw.procs : [raw.procs]) : [];
    const perfArr:  any[] = raw.perf  ? (Array.isArray(raw.perf)  ? raw.perf  : [raw.perf])  : [];
    const cores: number   = raw.cores ?? 1;

    // Update cached core count
    if (cores > 0 && numCores === 0) {
      numCores = cores;
      log(`Detected ${numCores} logical CPU cores`);
    }

    // Build a PID → perf map for O(1) lookup
    const perfMap = new Map<number, { k: number; u: number; ts: number }>();
    for (const p of perfArr) {
      if (p.IDProcess != null) {
        perfMap.set(Number(p.IDProcess), {
          k:  Number(p.KernelModeTime ?? 0),
          u:  Number(p.UserModeTime   ?? 0),
          ts: Number(p.Timestamp_Sys100NS ?? 0),
        });
      }
    }

    const ownPid = process.pid;
    const psPid  = ps.pid;

    const processes = procsArr
      .filter((p: any) =>
        p.ProcessId !== ownPid &&
        p.ParentProcessId !== ownPid &&
        p.ProcessId !== psPid &&
        p.ParentProcessId !== psPid
      )
      .map((p: any) => {
        const name    = p.Name || "Unknown";
        let trust     = getTrust(name);
        const nameKey = name.toLowerCase();

        // Rule-driven trust: manual override skips cache reclassification entirely.
        const rule = rules[normalizeRuleName(name)];
        if (rule?.manualControl) {
          // User has explicit control — use saved overrideTrust if available, otherwise
          // only apply ALLOW promotion; never let the cache reset trust to unknown.
          if (rule.overrideTrust) {
            trust = rule.overrideTrust;
          } else if (rule.action === "ALLOW" && trust !== "trusted") {
            trust = "verified";
          } else if (trust === "unknown") {
            trust = "background"; // acknowledged by user, remove from unknown panel
          }
        } else {
          // Cache-driven trust promotion from AI analysis:
          // "essential"/"safe" only promotes unknowns → verified. System processes (trusted) keep their tier.
          // "essential" in the AI sense means "known good user app", NOT "Windows system process".
          // Only the static getTrust() TRUSTED set should ever produce trust="trusted" (system tier).
          const analysis = cache[nameKey];
          if (analysis) {
            if (analysis.verdict === "essential" || analysis.verdict === "safe") {
              if (trust === "unknown") trust = "verified";
            } else if (analysis.verdict === "background") {
              if (trust === "unknown") trust = "background";
            }
            // "caution" leaves trust unchanged (stays unknown / red)
          }

          // ALLOW rules promote unknowns/background → verified, but NEVER demote
          // already-trusted system processes (trusted stays trusted / blue).
          if (rule && rule.action === "ALLOW" && trust !== "trusted") trust = "verified";
        }

        // Store exec path for icon + verifier
        const execKey = nameKey.replace(/\.exe$/i, "");
        if (p.ExecutablePath && !execPathCache.has(execKey)) {
          execPathCache.set(execKey, p.ExecutablePath);
        }

        // Look up vendor from metadata cache (populated async by background verifier)
        const execPathLower = (p.ExecutablePath || "").toLowerCase();
        const meta = execPathLower ? metaCache[execPathLower] : null;
        const vendor = meta?.company || "";

        // Queue background signature audit for any process without metadata yet
        if (p.ExecutablePath && !meta) {
          queueVerification(p.ExecutablePath, name);
        }

        // CPU calculation
        const perf = perfMap.get(Number(p.ProcessId));
        const cpu  = perf
          ? calcCpuPct(Number(p.ProcessId), perf.k, perf.u, perf.ts)
          : 0;

        return {
          id:      p.ProcessId,
          name,
          ramMB:   Math.round(((p.WorkingSetSize || 0) / (1024 * 1024)) * 100) / 100,
          cpu,
          ppid:    p.ParentProcessId || 0,
          handles: p.HandleCount || 0,
          trust,
          category: getCategory(trust),
          vendor,
          execPath: p.ExecutablePath || "",
        };
      });

    log(`Returning ${processes.length} processes`);
    return {
      processes,
      totalRAM:     Math.round(processes.reduce((acc, p) => acc + p.ramMB, 0)),
      totalCPU:     Math.round(processes.reduce((acc, p) => acc + p.cpu, 0) * 10) / 10,
      unknownCount: processes.filter(p => p.trust === "unknown").length,
    };
  } catch (err) {
    log("ERROR in get-processes: " + String(err));
    return { error: "System Error: " + String(err), processes: [] };
  }
});

ipcMain.handle("get-icon", async (_event, rawName: string) => {
  const name = rawName.replace(/\.exe$/i, "").replace(/-\d+$/, "").toLowerCase();

  // Return cached positive result immediately
  if (iconCacheMap.has(name) && iconCacheMap.get(name) !== "NO_ICON") {
    return iconCacheMap.get(name);
  }

  // Try execPathCache first
  let execPath = execPathCache.get(name);

  // Live PS fallback: query for the exe path if cache missed
  if (!execPath) {
    try {
      const stdout = await ps.run(
        `(Get-CimInstance Win32_Process -Filter "Name LIKE '${name}%'" -EA SilentlyContinue | Select-Object -First 1).ExecutablePath`
      ).catch(() => "");
      const found = stdout.trim();
      if (found && fs.existsSync(found)) {
        execPath = found;
        execPathCache.set(name, found);
      }
    } catch {}
  }

  if (!execPath || !fs.existsSync(execPath)) {
    // Don't permanently cache — path may appear on next poll
    return "NO_ICON";
  }

  try {
    const nativeImg = await app.getFileIcon(execPath, { size: "normal" });
    const b64 = nativeImg.toPNG().toString("base64");
    const result = b64.length > 100 ? b64 : "NO_ICON"; // sanity-check size (empty PNG is ~68 bytes)
    iconCacheMap.set(name, result);
    if (result !== "NO_ICON") scheduleSaveIconCache();
    return result;
  } catch {
    iconCacheMap.set(name, "NO_ICON");
    return "NO_ICON";
  }
});

ipcMain.handle("kill-process", async (_event, { pid, killTree }: { pid: number, killTree: boolean }) => {
  await killPid(pid, killTree);
  appendAudit("kill", `Killed PID ${pid}`, { pid, killTree });
});

ipcMain.handle("set-process-priority", async (_event, { pid, priority }: { pid: number; priority: "Idle" | "BelowNormal" | "Normal" }) => {
  const result = await setProcessPriority(pid, priority);
  if (result.ok) {
    if (priority === "Idle") limitedPriorityPids.add(pid);
    if (priority === "Normal") limitedPriorityPids.delete(pid);
    appendAudit("priority", `Set PID ${pid} priority to ${priority}`, { pid, priority });
  }
  return result;
});

ipcMain.handle("enforce-rules", async (_event, { processes, rules }: { processes: { id: number; name: string }[]; rules: Record<string, any> }) => {
  return enforceProcessRules(processes, normalizeRules(rules));
});

ipcMain.handle("get-background-enforcement", async () => ({ rulesActive: enforcementActive }));

ipcMain.handle("set-background-enforcement", async (_event, active: boolean) => {
  return { rulesActive: setEnforcementActive(Boolean(active)) };
});

ipcMain.handle("start-ai-service", async (event) => ensureDefaultModel(event.sender));
ipcMain.handle("stop-ai-service",  async () => stopOllama());

ipcMain.handle("get-startup-info", async (_event, name: string) => {
  try {
    const clean = name.replace(/\.exe$/i, "");
    const { stdout: hkcu } = await safeExec(
      `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /f "${clean}" /t REG_SZ`,
      { timeout: 3000 }
    ).catch(() => ({ stdout: "" }));
    const { stdout: hklm } = await safeExec(
      `reg query "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /f "${clean}" /t REG_SZ`,
      { timeout: 3000 }
    ).catch(() => ({ stdout: "" }));
    return { isStartupApp: hkcu.includes(clean) || hklm.includes(clean) };
  } catch { return { isStartupApp: false }; }
});

const DEFAULT_MODEL = "llama3.2:1b";
const MODEL_PREFERENCE  = [DEFAULT_MODEL, "llama3.2:3b", "gemma3:4b", "gemma2:2b", "mistral", "phi3:mini", "llama2"];
const RECOMMENDED_MODEL = DEFAULT_MODEL;
let modelSetupPromise: Promise<boolean> | null = null;

type AiSetupPhase = "idle" | "starting" | "pulling" | "ready" | "error";
let currentAiStatus: { phase: AiSetupPhase; model?: string; error?: string } = { phase: "idle" };

function broadcastAiStatus(status: typeof currentAiStatus) {
  currentAiStatus = status;
  mainWindow?.webContents.send("ai-setup-status", status);
}

async function getInstalledModels(): Promise<string[]> {
  try {
    const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const data = await r.json() as { models?: { name: string }[] };
    return (data.models ?? []).map((m: { name: string }) => m.name);
  } catch { return []; }
}

async function getBestModel(): Promise<string | null> {
  const installed = await getInstalledModels();
  if (installed.length === 0) return null;
  for (const pref of MODEL_PREFERENCE) {
    const family = pref.split(":")[0];
    const match = installed.find(m => m === pref || m.startsWith(family + ":"));
    if (match) return match;
  }
  return installed[0];
}

async function pullOllamaModel(modelName: string, sender?: WebContents): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("http://localhost:11434/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });
    if (!response.ok || !response.body) return { ok: false, error: "Pull request rejected by Ollama" };

    const reader  = (response.body as any).getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let pullError: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const progress = JSON.parse(line);
          if (progress.error) {
            pullError = String(progress.error);
          }
          if (sender && !sender.isDestroyed()) sender.send("pull-progress", progress);
          else mainWindow?.webContents.send("pull-progress", progress);
        } catch {}
      }
    }

    if (pullError) {
      return { ok: false, error: pullError };
    }

    if (sender && !sender.isDestroyed()) sender.send("pull-progress", { status: "success" });
    else mainWindow?.webContents.send("pull-progress", { status: "success" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function waitForOllama(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch("http://localhost:11434/api/version", { signal: AbortSignal.timeout(600) });
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function ensureDefaultModel(sender?: WebContents): Promise<boolean> {
  if (modelSetupPromise) return modelSetupPromise;
  // Already ready — but verify Ollama is still responding before returning.
  // The ollamaProcess exit handler resets phase to "idle" if Ollama crashes, allowing recovery.
  if (currentAiStatus.phase === "ready") {
    try {
      const probe = await fetch("http://localhost:11434/api/version", {
        signal: AbortSignal.timeout(1500),
      });
      if (probe.ok) return true;
    } catch {}
    // Ollama is not responding despite phase=ready; reset to idle and retry
    broadcastAiStatus({ phase: "idle" });
  }
  modelSetupPromise = (async () => {
    broadcastAiStatus({ phase: "starting" });
    const ready = await startOllama();
    if (!ready) {
      broadcastAiStatus({ phase: "error", error: "Ollama failed to start" });
      return false;
    }

    const accepting = await waitForOllama(12000);
    if (!accepting) {
      broadcastAiStatus({ phase: "error", error: "Ollama started but did not accept requests within 12 s" });
      return false;
    }

    const existing = await getBestModel();
    if (existing) {
      log(`AI model available: ${existing}`);
      broadcastAiStatus({ phase: "ready", model: existing });
      return true;
    }

    log(`No AI model found. Pulling ${DEFAULT_MODEL}...`);
    notify("TaskFish AI setup", `Downloading ${DEFAULT_MODEL}. Analysis will be ready when this finishes.`);
    broadcastAiStatus({ phase: "pulling" });
    const result = await pullOllamaModel(DEFAULT_MODEL, sender);
    if (!result.ok) {
      log(`Model pull failed: ${result.error ?? "unknown error"}`);
      broadcastAiStatus({ phase: "error", error: result.error ?? "Model download failed" });
      return false;
    }

    const installed = await getBestModel();
    if (installed) {
      broadcastAiStatus({ phase: "ready", model: installed });
    } else {
      broadcastAiStatus({ phase: "error", error: "Model not found after pull" });
    }
    return Boolean(installed);
  })().finally(() => {
    modelSetupPromise = null;
  });
  return modelSetupPromise;
}

ipcMain.handle("list-models", async () => getInstalledModels());

ipcMain.handle("get-ai-status", async () => currentAiStatus);

ipcMain.handle("pull-model", async (event, modelName: string) => {
  const ready = await startOllama();
  if (!ready) return { ok: false, error: "Ollama is not available" };
  return pullOllamaModel(modelName, event.sender);
});

async function collectProcessTelemetry(name: string): Promise<string> {
  try {
    const cleanName = name.replace(/\.exe$/i, "");
    const procInfoQuery = `Get-CimInstance Win32_Process -Filter "Name='${name}' or Name='${cleanName}.exe'" | Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress`;
    const procStdout = await ps.run(procInfoQuery, 8000).catch(() => "");
    if (!procStdout.trim()) return "";
    const parsedProc = JSON.parse(procStdout.trim());
    const procArr = Array.isArray(parsedProc) ? parsedProc : [parsedProc];
    const target = procArr[0];
    if (!target) return "";

    const pid     = target.ProcessId;
    const ppid    = target.ParentProcessId;
    const cmdLine = target.CommandLine || "Unknown";
    const execPath = target.ExecutablePath || "";

    let parentName = "Unknown";
    if (ppid) {
      try {
        const parentStdout = await ps.run(`(Get-CimInstance Win32_Process -Filter "ProcessId = ${ppid}" -ErrorAction SilentlyContinue).Name`).catch(() => "");
        if (parentStdout && parentStdout.trim()) parentName = parentStdout.trim();
      } catch (_) {}
    }

    let fileMetadata = "";
    if (execPath && fs.existsSync(execPath)) {
      try {
        const escapedPath = execPath.replace(/'/g, "''");
        const metaQuery = `$ver = (Get-Item -Path '${escapedPath}' -ErrorAction SilentlyContinue).VersionInfo; $sig = (Get-AuthenticodeSignature -FilePath '${escapedPath}' -ErrorAction SilentlyContinue); @{ Company = $ver.CompanyName; Description = $ver.FileDescription; Signer = $sig.SignerCertificate.Subject; SigStatus = $sig.Status.ToString() } | ConvertTo-Json -Compress`;
        const metaStdout = await ps.run(metaQuery).catch(() => "");
        if (metaStdout && metaStdout.trim()) {
          const m = JSON.parse(metaStdout.trim());
          const cleanSigner = m.Signer ? m.Signer.split(",")[0].replace("CN=", "") : "Unsigned";
          fileMetadata = `File Description: ${m.Description || "Unknown"}\nCompany Name: ${m.Company || "Unknown"}\nDigital Signature Status: ${m.SigStatus || "Unsigned"}\nSigner Subject: ${cleanSigner}`;
        }
      } catch (_) {}
    }

    const dllsQuery  = `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Modules | Select-Object -First 25 ModuleName | ConvertTo-Json -Compress`;
    const dllsStdout = await ps.run(dllsQuery).catch(() => "");
    let dllList = "None";
    if (dllsStdout && dllsStdout.trim()) {
      const parsedDlls = JSON.parse(dllsStdout.trim());
      const dllArr = Array.isArray(parsedDlls) ? parsedDlls : [parsedDlls];
      dllList = dllArr.map((m: any) => m.ModuleName).join(", ");
    }

    const netQuery  = `Get-NetTCPConnection -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object RemoteAddress,RemotePort,State | ConvertTo-Json -Compress`;
    const netStdout = await ps.run(netQuery).catch(() => "");
    let netList = "None";
    if (netStdout && netStdout.trim()) {
      const parsedNet = JSON.parse(netStdout.trim());
      const netArr = Array.isArray(parsedNet) ? parsedNet : [parsedNet];
      netList = netArr.map((c: any) => `${c.RemoteAddress}:${c.RemotePort} (${c.State})`).join(", ");
    }

    return `Executable Path: ${execPath || "Unknown"}\nParent Process: ${parentName} (PID: ${ppid || "Unknown"})\nCommand Line: ${cmdLine}\n${fileMetadata ? fileMetadata + "\n" : ""}Loaded DLLs: ${dllList}\nNetwork Connections: ${netList}`;
  } catch {
    return "";
  }
}

const ANALYSIS_PROMPT = (name: string, telemetry: string = "") =>
  `You are a Windows process security analyst. Analyze this Windows process: "${name}"
${telemetry ? `\nRunning Process Live Telemetry:\n${telemetry}\n` : ""}

CRITICAL AUDIT GUIDELINES:
1. "Antigravity.exe" (Agentic Desktop Application developed by Google) is the host agentic environment that this system manager runs within. It is 100% TRUSTED, safe, and essential. You must NEVER classify it as suspicious, caution, or recommend banning it.
2. Many developer environment tools, local custom scripts, and AI runtime executables (like Antigravity.exe, node.exe, git.exe, code.exe, ollama.exe) are unsigned or self-signed. If they have valid file descriptions/companies (e.g. Google, Microsoft, GitHub) and run from standard program or user folders, classify them as "safe" or "background" rather than "caution" or "malware". Do not hallucinate gaming launchers or tracking features for them.
3. Do not recommend BANning (suggestedRule.action: "BAN") unless there is clear, high-risk evidence of malware, adware, severe security threat, or active malicious network activity.
4. If a process belongs to a trusted developer tool, or is a known benign helper utility, rate its riskScore below 10, set verdict to "safe" or "background", and suggest "ALLOW" or "LIMITED" action.

Respond with ONLY this JSON (no other text):
{"verdict":"essential","title":"Display Name","description":"One sentence: what this process does and what app it belongs to.","tip":"One sentence recommendation.","gameModeSafe":true,"suggestedRule":{"action":"ALLOW"},"riskScore":0,"threatFlags":[]}

verdict: "essential"=core Windows, "safe"=trusted app, "background"=benign service, "caution"=unknown/suspicious
gameModeSafe: false if it uses significant CPU/GPU or is non-essential during gaming
suggestedRule.action: "ALLOW" for essential/safe, "LIMITED" for background, "BAN" for caution
riskScore: 0 to 100 representing safety threat level (100 = extreme virus/malware, 0 = completely safe/essential)
threatFlags: Array of strings representing behavior indicators (e.g. "suspicious_network", "unsigned_binary", "dll_injection", "cryptominer", "keylogger", "adware") if any, otherwise empty array []`;

ipcMain.handle("analyze-process", async (_event, name: string) => {
  await ensureDefaultModel();

  const model = await getBestModel();
  if (!model) {
    const fallback = offlineAnalysis(name);
    const cache = loadJson(cachePath);
    cache[name.toLowerCase()] = fallback;
    saveJson(cachePath, cache);
    return { ...fallback, recommendedModel: RECOMMENDED_MODEL };
  }

  const telemetry = await collectProcessTelemetry(name);

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: ANALYSIS_PROMPT(name, telemetry), stream: false, format: "json" }),
      signal: AbortSignal.timeout(90000),
    });
    const data: any = await response.json();
    if (data.error) return { error: data.error, recommendedModel: RECOMMENDED_MODEL };
    try {
      const parsed = JSON.parse(data.response);
      log(`Analyzed "${name}" with model "${model}": ${parsed.verdict}`);
      return parsed;
    } catch {
      return { error: "Model returned invalid JSON — try re-analyzing" };
    }
  } catch (e) {
    const fallback = offlineAnalysis(name);
    const cache = loadJson(cachePath);
    cache[name.toLowerCase()] = fallback;
    saveJson(cachePath, cache);
    return { ...fallback, recommendedModel: RECOMMENDED_MODEL };
  }
});

ipcMain.handle("get-process-dlls", async (_event, pid: number) => {
  try {
    const query = `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Modules | Select-Object ModuleName,FileName | ConvertTo-Json -Compress`;
    const stdout = await ps.run(query);
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
});

ipcMain.handle("get-process-network", async (_event, pid: number) => {
  try {
    const query = `$tcp = Get-NetTCPConnection -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State; $udp = Get-NetUDPEndpoint -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort; @{ tcp = $tcp; udp = $udp } | ConvertTo-Json -Compress`;
    const stdout = await ps.run(query);
    if (!stdout.trim()) return { tcp: [], udp: [] };
    const parsed = JSON.parse(stdout.trim());
    const cleanArray = (v: any) => v ? (Array.isArray(v) ? v : [v]) : [];
    return { tcp: cleanArray(parsed.tcp), udp: cleanArray(parsed.udp) };
  } catch {
    return { tcp: [], udp: [] };
  }
});

ipcMain.handle("get-process-services", async (_event, pid: number) => {
  try {
    const query = `Get-CimInstance Win32_Service -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue | Select-Object Name,DisplayName,Status,StartMode | ConvertTo-Json -Compress`;
    const stdout = await ps.run(query);
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
});

ipcMain.handle("get-stats", async () => {
  try {
    const stdout = await ps.run(
      `$cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" | Select-Object -ExpandProperty PercentProcessorTime; $mem = Get-CimInstance Win32_OperatingSystem; $used = $mem.TotalVisibleMemorySize - $mem.FreePhysicalMemory; @{ cpu = [int]$cpu; ram = [int]($used / 1024) } | ConvertTo-Json -Compress`
    );
    return JSON.parse(stdout);
  } catch (e) {
    return { cpu: 0, ram: 0 };
  }
});

// --- EVENT HEALTH ANALYSIS ---

function buildEventHealthCacheKey(report: EventHealthReport): string {
  if (report.fileHash) return `sha256:${report.fileHash}`;
  const sig = report.clusters.map(c => `${c.key}:${c.level}:${c.count}:${c.firstSeen}:${c.lastSeen}`).join("|");
  return `clusters:${report.fileName}:${report.totalEvents}:${sig}`;
}

function buildClusterSummary(clusters: EventCluster[]): string {
  const relevant = clusters.filter(c => c.category !== "likely-noise").slice(0, 20);
  const source = relevant.length > 0 ? relevant : clusters.slice(0, 8);
  return source.map(c =>
    `clusterId=${c.key} level=${c.levelName} category=${c.category} count=${c.count} firstSeen=${c.firstSeen || "unknown"} lastSeen=${c.lastSeen || "unknown"} summary=${c.summary}`
  ).join("\n");
}

const EVENT_HEALTH_PROMPT = (clusterSummary: string, totalEvents: number, overallHealth: string): string =>
  `You are a Windows system health analyst. Analyze only this clustered Windows Event Log summary. Do not infer from raw events or request live scanning.

Total events: ${totalEvents}
Deterministic overall health signal: ${overallHealth}

Clustered event summary:
${clusterSummary}

Respond with only strict JSON matching this schema:
{
  "overallHealth": "good|watch|attention|urgent",
  "summary": "2-3 sentence overall assessment based only on the clusters",
  "findings": [
    {
      "clusterId": "exact clusterId from input",
      "severity": "critical|warning|info",
      "confidence": "high|medium|low",
      "explanation": "what this cluster means and why it matters",
      "evidence": ["specific count or timing detail from the cluster"],
      "safeNextSteps": ["safe Windows troubleshooting step"],
      "whenToIgnore": "specific condition where this cluster can be dismissed"
    }
  ]
}

Rules:
- Analyze clusters, not raw events.
- Only include findings for needs-attention or watch clusters; skip likely-noise entirely.
- DistributedCOM 10016 is info severity, low confidence, and usually benign Windows noise.
- Kernel-Power 41 and unexpected shutdowns are critical severity, high confidence.
- disk or ntfs events are critical severity regardless of count.
- Failed logins 4625: high count is critical; low count is warning.
- Keep explanations factual and concise.
- safeNextSteps must be concrete, low-risk steps a Windows user can take.`;

function deterministicEventHealth(report: EventHealthReport): EventHealthAnalysis {
  const findings: EventHealthFinding[] = [];

  for (const cluster of report.clusters) {
    if (cluster.category === "likely-noise") continue;

    const severity: EventHealthFinding["severity"] =
      cluster.level === 1 ? "critical" :
      cluster.level === 2 ? (cluster.count >= 5 ? "critical" : "warning") : "warning";

    const confidence: EventHealthFinding["confidence"] =
      cluster.level === 1 ? "high" : cluster.level === 2 ? "medium" : "low";

    const evidence: string[] = [`Occurred ${cluster.count} time${cluster.count !== 1 ? "s" : ""}`];
    if (cluster.firstSeen) evidence.push(`First seen: ${new Date(cluster.firstSeen).toLocaleString()}`);
    if (cluster.lastSeen && cluster.lastSeen !== cluster.firstSeen) {
      evidence.push(`Last seen: ${new Date(cluster.lastSeen).toLocaleString()}`);
    }
    if (cluster.sampleMessage) evidence.push(cluster.sampleMessage.split("\n")[0].slice(0, 120));

    const key = `${cluster.provider}:${cluster.eventId}`;
    let safeNextSteps: string[];
    let whenToIgnore: string;

    if (key.includes("Kernel-Power:41") || key.includes(":6008")) {
      safeNextSteps = [
        "Check Event Viewer for BSOD codes near the same timestamp",
        "Run Windows Memory Diagnostic: Start > mdsched.exe",
        "Inspect power supply connections and UPS if present",
      ];
      whenToIgnore = "Single occurrence immediately after a known power outage or deliberate shutdown.";
    } else if (key.includes("Service Control Manager")) {
      safeNextSteps = [
        "Open services.msc and verify the service is running",
        "Review the Application event log for the same time window",
      ];
      whenToIgnore = "If the service recovered automatically and is currently running normally.";
    } else if (key.includes("Security-Auditing:4625") || key.includes("Security-Auditing:4740")) {
      safeNextSteps = [
        "Review the failed login source in full event details",
        "If count is high, check for brute-force patterns",
        "Ensure account passwords are strong and MFA is enabled where available",
      ];
      whenToIgnore = "Low count, fewer than 5, from a known local machine only.";
    } else if (key.includes("Application Error:1000") || key.includes("Application Hang:1002")) {
      safeNextSteps = [
        "Note the faulting application name in event details",
        "Update or reinstall the crashing application",
        "Check Windows Update for relevant patches",
      ];
      whenToIgnore = "Single crash of a non-critical third-party app that has since been updated.";
    } else if (key.includes("disk:") || key.includes("ntfs:")) {
      safeNextSteps = [
        "Run chkdsk C: /f /r, replacing C: with the affected drive letter",
        "Check drive health with CrystalDiskInfo and review reallocated sector count",
        "Back up important data immediately before further investigation",
      ];
      whenToIgnore = "Disk errors should almost never be ignored; investigate promptly.";
    } else if (key.includes("DistributedCOM:10016")) {
      safeNextSteps = ["Usually benign; no action required unless frequency is unusually high."];
      whenToIgnore = "Very common Windows configuration noise; safe to ignore if the system is otherwise stable.";
    } else if (key.includes("WindowsUpdateClient")) {
      safeNextSteps = [
        "Run Windows Update manually: Settings > Windows Update > Check for updates",
        "Ensure the drive has sufficient free space, at least 10 GB, for updates",
      ];
      whenToIgnore = "If the same update has since succeeded.";
    } else if (key.includes("Kernel-PnP")) {
      safeNextSteps = [
        "Check Device Manager for yellow warning flags",
        "Update or reinstall the relevant device driver",
      ];
      whenToIgnore = "One-time occurrence during driver installation that has not recurred.";
    } else if (key.includes("Diagnostics-Performance")) {
      safeNextSteps = [
        "Review startup applications in Task Manager > Startup",
        "Consider adding RAM if this recurs frequently",
      ];
      whenToIgnore = "Occasional entries during heavy system load or first boot after updates are normal.";
    } else {
      safeNextSteps = [
        "Review full event details in Windows Event Viewer",
        `Search for Event ID ${cluster.eventId} ${cluster.provider}`,
      ];
      whenToIgnore = "If this is a one-time occurrence with no observable system impact.";
    }

    findings.push({ clusterId: cluster.key, severity, confidence, explanation: cluster.summary, evidence, safeNextSteps, whenToIgnore });
  }

  const critical = findings.filter(f => f.severity === "critical").length;
  const warning = findings.filter(f => f.severity === "warning").length;
  const summary = findings.length === 0
    ? "No significant findings detected. System event log appears healthy."
    : `${critical > 0 ? `${critical} critical` : ""}${critical > 0 && warning > 0 ? " and " : ""}${warning > 0 ? `${warning} warning` : ""} finding${findings.length !== 1 ? "s" : ""} identified across ${report.clusters.length} unique event cluster${report.clusters.length !== 1 ? "s" : ""}.`;

  return { overallHealth: report.overallHealth, summary, findings, analyzedAt: Date.now(), model: null, offline: true };
}

function validateEventHealthAnalysis(raw: unknown, report: EventHealthReport): EventHealthAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const validHealth = ["good", "watch", "attention", "urgent"];
  const overallHealth = validHealth.includes(r.overallHealth as string)
    ? r.overallHealth as EventHealthAnalysis["overallHealth"]
    : report.overallHealth;
  if (typeof r.summary !== "string" || !Array.isArray(r.findings)) return null;

  const validSeverity = ["critical", "warning", "info"];
  const validConfidence = ["high", "medium", "low"];
  const allowedIds = new Set(report.clusters.filter(c => c.category !== "likely-noise").map(c => c.key));
  const findings: EventHealthFinding[] = [];

  for (const f of r.findings as unknown[]) {
    if (!f || typeof f !== "object") continue;
    const fObj = f as Record<string, unknown>;
    if (!validSeverity.includes(fObj.severity as string)) continue;
    if (!validConfidence.includes(fObj.confidence as string)) continue;
    if (typeof fObj.clusterId !== "string" || !allowedIds.has(fObj.clusterId)) continue;
    if (typeof fObj.explanation !== "string" || !fObj.explanation) continue;
    findings.push({
      clusterId: fObj.clusterId,
      severity: fObj.severity as EventHealthFinding["severity"],
      confidence: fObj.confidence as EventHealthFinding["confidence"],
      explanation: (fObj.explanation as string).slice(0, 500),
      evidence: Array.isArray(fObj.evidence) ? (fObj.evidence as unknown[]).filter((e): e is string => typeof e === "string").slice(0, 5) : [],
      safeNextSteps: Array.isArray(fObj.safeNextSteps) ? (fObj.safeNextSteps as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 5) : [],
      whenToIgnore: typeof fObj.whenToIgnore === "string" ? (fObj.whenToIgnore as string).slice(0, 500) : "",
    });
  }

  return { overallHealth, summary: r.summary.slice(0, 800), findings, analyzedAt: Date.now(), model: null, offline: false };
}

ipcMain.handle("analyze-event-health", async (_event, report: EventHealthReport, forceRefresh?: boolean) => {
  if (!report || !Array.isArray(report.clusters)) return { error: "Invalid report" };

  const cacheKey = buildEventHealthCacheKey(report);
  const cache = loadJson(eventHealthCachePath) as Record<string, EventHealthAnalysis>;
  if (!forceRefresh && cache[cacheKey]) return cache[cacheKey];

  const model = await getBestModel();
  if (model) {
    const prompt = EVENT_HEALTH_PROMPT(buildClusterSummary(report.clusters), report.totalEvents, report.overallHealth);
    try {
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
        signal: AbortSignal.timeout(120000),
      });
      const data = await response.json() as { error?: unknown; response?: string };
      if (!data.error && typeof data.response === "string") {
        const validated = validateEventHealthAnalysis(JSON.parse(data.response) as unknown, report);
        if (validated) {
          validated.model = model;
          cache[cacheKey] = validated;
          saveJson(eventHealthCachePath, cache);
          return validated;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("ECONNREFUSED") && !msg.includes("timeout") && !msg.includes("connect")) {
        log("analyze-event-health Ollama error: " + msg);
      }
    }
  }

  const result = deterministicEventHealth(report);
  cache[cacheKey] = result;
  saveJson(eventHealthCachePath, cache);
  return result;
});

// --- EVENT FIX ASSISTANT ---

interface EventFixStep {
  label: string;
  instruction: string;
  command?: string;
  warning?: string;
}

interface EventFixResult {
  title: string;
  rootCauses: string[];
  steps: EventFixStep[];
  escalation: string;
  error?: string;
}

const eventFixCachePath = path.join(userDataPath, "event_fix_cache.json");

const EVENT_FIX_PROMPT = (
  clusterId: string,
  provider: string,
  eventId: number,
  levelName: string,
  count: number,
  firstSeen: string,
  lastSeen: string,
  summary: string,
  sampleMessage: string,
  explanation: string,
  evidence: string[],
): string => {
  const isDcom = /distributedcom/i.test(provider) && (eventId === 10010 || eventId === 10016);
  return `You are a Windows system repair expert. A user's PC has this Windows Event Log finding and needs safe, conservative fix guidance.

Event details:
- Cluster ID: ${clusterId}
- Provider: ${provider}
- Event ID: ${eventId}
- Level: ${levelName}
- Occurrences: ${count} times
- First seen: ${firstSeen || "unknown"}
- Last seen: ${lastSeen || "unknown"}
- Summary: ${summary}
- AI explanation: ${explanation}
- Evidence: ${evidence.join("; ")}
${sampleMessage ? `- Sample message: ${sampleMessage.slice(0, 300)}` : ""}
${isDcom ? `
IMPORTANT — DistributedCOM Event ${eventId}: This is one of the most common Windows events across all versions and is almost always harmless background noise. Windows components silently request elevated COM permissions they do not actually need; the denial has no real effect. Your response MUST: (1) state in the title that this is usually noise, (2) advise checking for a real user-visible symptom before any action, (3) suggest Windows Update and a reboot as first steps, (4) never recommend DCOMCNFG, Component Services, or registry permission changes.
` : ""}
Respond with ONLY strict JSON matching this schema (no markdown, no extra text):
{
  "title": "Short fix title (what we are fixing)",
  "rootCauses": ["Most likely cause 1", "Possible cause 2"],
  "steps": [
    {
      "label": "Step name (5 words max)",
      "instruction": "Plain English instruction for this step",
      "command": "optional PowerShell or CMD command the user can run (omit if not applicable — only include commands that exist in Windows)",
      "warning": "REQUIRED for any step that modifies the system — include whenever the step touches the registry, stops/starts a service, changes firewall rules, or makes any system configuration change. Omit ONLY for pure read-only/information-gathering steps."
    }
  ],
  "escalation": "One sentence on when to call a professional or escalate beyond self-repair"
}

SAFETY RULES — follow exactly, no exceptions:
1. Order steps: non-destructive information-gathering first (check for updates, verify with read-only commands, check app state), system-modifying steps last.
2. SAFE commands (no warning needed): Get-WinEvent, wevtutil ql, chkdsk /scan, sfc /scannow, DISM /Online /Cleanup-Image /CheckHealth, DISM /Online /Cleanup-Image /ScanHealth, Get-Service (read-only), Test-Path, winver, eventvwr.
3. RISKY commands (warning field REQUIRED): sc stop/start, net stop/start, Stop-Service/Start-Service/Restart-Service, reg add/delete, Set-ItemProperty or Remove-ItemProperty on registry keys, chkdsk /f or /r, netsh advfirewall, Set-NetFirewallRule, New-NetFirewallRule.
4. FORBIDDEN — do not include under any circumstances: dcomcnfg, Component Services permission changes, DCOM AppID ACL edits, net localgroup, diskpart, format, invented cmdlets not shipped with Windows (e.g. Get-DCOMPermission, Set-DCOMPermission, Repair-ComRegistration, Set-DCOMConfig).
5. Registry edits MUST carry warning: "Back up the registry first: regedit → File → Export. Incorrect edits can make Windows unbootable."
6. Service stop/start MUST carry warning: "Stopping this service may affect running applications. Reboot if unexpected behavior occurs."
7. DCOMCNFG or Component Services steps are FORBIDDEN — never suggest them.
8. Maximum 5 steps. If the event is likely noise, limit to 2-3 conservative steps and say so in the title.
9. Never suggest reinstalling Windows or destructive disk operations without an explicit warning marking them as absolute last resort.`;
};

const INVALID_CMDLET_RE = /\b(Get-DCOMPermission|Set-DCOMPermission|Get-COMRegistration|Set-ComObjectSecurity|Repair-ComRegistration|Set-DCOMConfig|Get-DCOMConfig|dcomedit|comregedit|Set-DCOMAccessPermission)\b/i;
const FORBIDDEN_FIX_RE = /\b(dcomcnfg|component services|dcom\s+(appid|app id|acl|permission|permissions)|net\s+localgroup|diskpart|format)\b/i;
const REGISTRY_FIX_RE = /\b(registry|regedit|HKLM|HKCU|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|reg\s+(add|delete)|Set-ItemProperty|Remove-ItemProperty)\b/i;
const FIREWALL_FIX_RE = /\b(firewall|netsh\s+advfirewall|Set-NetFirewallRule|New-NetFirewallRule)\b/i;
const DESTRUCTIVE_FIX_RE = /\b(chkdsk\s+.*\/[fr]|delete|remove|reset|reinstall Windows)\b/i;

function isRiskyCmd(cmd: string): string {
  if (/\breg\s+(add|delete)\b/i.test(cmd) || /\b(Set|New|Remove)-ItemProperty\b/i.test(cmd)) {
    return "Back up the registry first: regedit > File > Export. Incorrect edits can make Windows unbootable.";
  }
  if (/\bsc\s+(stop|start)\b/i.test(cmd) || /\bnet\s+(stop|start)\b/i.test(cmd) || /\b(Stop|Start|Restart)-Service\b/i.test(cmd)) {
    return "Stopping or restarting this service may affect running applications. Reboot if unexpected behavior occurs.";
  }
  if (/\bdcomcnfg\b/i.test(cmd)) {
    return "DCOMCNFG changes can break COM-dependent applications and are rarely needed. This step has been flagged for review.";
  }
  if (/\bnetsh\s+advfirewall\b/i.test(cmd) || /\b(Set|New)-NetFirewallRule\b/i.test(cmd)) {
    return "Firewall changes affect network security. Document the change and verify behavior thoroughly.";
  }
  if (/\bchkdsk\b.*\/[fr]\b/i.test(cmd)) {
    return "chkdsk /f or /r requires a reboot and may take considerable time. Save all work before proceeding.";
  }
  return "";
}

function warningForStep(step: EventFixStep): string {
  const text = `${step.instruction} ${step.command || ""}`;
  if (REGISTRY_FIX_RE.test(text)) {
    return "Back up the registry first: regedit > File > Export. Incorrect edits can make Windows unbootable.";
  }
  if (/\b(sc\s+(stop|start)|net\s+(stop|start)|Stop-Service|Start-Service|Restart-Service)\b/i.test(text)) {
    return "Stopping or restarting this service may affect running applications. Reboot if unexpected behavior occurs.";
  }
  if (FIREWALL_FIX_RE.test(text)) {
    return "Firewall changes affect network security. Document the change and verify behavior thoroughly.";
  }
  if (DESTRUCTIVE_FIX_RE.test(text)) {
    return "This can change or remove system state. Back up important data and use only as a last resort.";
  }
  return "";
}

function removedUnsafeStep(isDcom: boolean): EventFixStep {
  return {
    label: "Unsafe step removed",
    instruction: isDcom
      ? "A DCOMCNFG, Component Services, registry permission, or unsupported command suggestion was removed. DistributedCOM 10010/10016 findings should not be repaired with DCOM permission edits unless a documented Microsoft support procedure matches a real symptom."
      : "An unsupported or unsafe repair suggestion was removed. Use documented vendor or Microsoft guidance before attempting registry, permission, local group, disk partition, or formatting changes.",
    warning: "Do not run the removed advice without a verified backup, administrator approval, and trusted vendor documentation.",
  };
}

function sanitizeFixResult(result: EventFixResult, provider: string, eventId: number): EventFixResult {
  const isDcom = /distributedcom/i.test(provider) && (eventId === 10010 || eventId === 10016);
  let removedUnsafe = false;

  let steps: EventFixStep[] = result.steps.flatMap(step => {
    const text = `${step.label} ${step.instruction} ${step.command || ""}`;
    if (FORBIDDEN_FIX_RE.test(text) || INVALID_CMDLET_RE.test(text)) {
      removedUnsafe = true;
      return [];
    }
    if (!step.command) {
      const autoWarning = warningForStep(step);
      return [{ ...step, warning: step.warning || autoWarning || undefined }];
    }
    const autoWarning = isRiskyCmd(step.command) || warningForStep(step);
    return [{ ...step, warning: step.warning || autoWarning || undefined }];
  });

  if (removedUnsafe) steps.push(removedUnsafeStep(isDcom));

  if (isDcom && !steps[0]?.instruction.toLowerCase().includes("noise") && !steps[0]?.instruction.toLowerCase().includes("ignore")) {
    steps = [{
      label: "Is this noise?",
      instruction: `DistributedCOM event ${eventId} is extremely common on all Windows versions and is almost always harmless. Windows components silently request elevated COM permissions they do not need; the denial has no effect on normal operation. Before taking any action, confirm whether you are experiencing a real symptom (e.g., a specific app failing, a service not starting). If there is no visible problem, no action is required.`,
    }, ...steps];
  }

  if (isDcom) {
    const hasConservativeCheck = steps.some(step => /\b(update|reboot|repair)\b/i.test(step.instruction));
    if (!hasConservativeCheck) {
      steps.splice(1, 0, {
        label: "Update and reboot",
        instruction: "If the event correlates with a real app or Windows feature problem, install Windows updates, reboot, and update or repair the affected app before considering deeper remediation.",
      });
    }
    steps = steps.slice(0, 3);
  }

  const title = isDcom && !/\b(noise|harmless|ignore)\b/i.test(result.title)
    ? `Usually noise: ${result.title}`.slice(0, 120)
    : result.title;

  return { ...result, title, steps };
}

ipcMain.handle("get-event-fix", async (_event, finding: EventHealthFinding, cluster: EventCluster) => {
  if (!finding || !cluster) return { error: "Invalid input", title: "", rootCauses: [], steps: [], escalation: "" };

  const cacheKey = `fix:${finding.clusterId}`;
  const cache = loadJson(eventFixCachePath) as Record<string, EventFixResult>;
  if (cache[cacheKey]) {
    const result = sanitizeFixResult(cache[cacheKey], cluster.provider, cluster.eventId);
    if (JSON.stringify(result) !== JSON.stringify(cache[cacheKey])) {
      cache[cacheKey] = result;
      saveJson(eventFixCachePath, cache);
    }
    return result;
  }

  const model = await getBestModel();
  if (!model) {
    const rawResult: EventFixResult = {
      title: `Fix: ${finding.clusterId}`,
      rootCauses: ["AI model not available — showing basic guidance"],
      steps: finding.safeNextSteps.map((s, i) => ({ label: `Step ${i + 1}`, instruction: s })),
      escalation: "Contact a professional if the issue persists after following these steps.",
    };
    const result = sanitizeFixResult(rawResult, cluster.provider, cluster.eventId);
    cache[cacheKey] = result;
    saveJson(eventFixCachePath, cache);
    return result;
  }

  const prompt = EVENT_FIX_PROMPT(
    finding.clusterId,
    cluster.provider,
    cluster.eventId,
    cluster.levelName,
    cluster.count,
    cluster.firstSeen,
    cluster.lastSeen,
    cluster.summary,
    cluster.sampleMessage,
    finding.explanation,
    finding.evidence,
  );

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
      signal: AbortSignal.timeout(90000),
    });
    const data = await response.json() as { error?: unknown; response?: string };
    if (!data.error && typeof data.response === "string") {
      const parsed = JSON.parse(data.response) as unknown;
      if (parsed && typeof parsed === "object") {
        const r = parsed as Record<string, unknown>;
        const steps: EventFixStep[] = Array.isArray(r.steps)
          ? (r.steps as unknown[]).filter((s): s is EventFixStep => {
              if (!s || typeof s !== "object") return false;
              const obj = s as Record<string, unknown>;
              return typeof obj.label === "string" && typeof obj.instruction === "string";
            }).slice(0, 5)
          : finding.safeNextSteps.map((s, i) => ({ label: `Step ${i + 1}`, instruction: s }));

        const rawResult: EventFixResult = {
          title: typeof r.title === "string" ? r.title.slice(0, 120) : `Fix: ${finding.clusterId}`,
          rootCauses: Array.isArray(r.rootCauses)
            ? (r.rootCauses as unknown[]).filter((c): c is string => typeof c === "string").slice(0, 4)
            : [],
          steps,
          escalation: typeof r.escalation === "string" ? r.escalation.slice(0, 400) : "",
        };
        const result = sanitizeFixResult(rawResult, cluster.provider, cluster.eventId);
        cache[cacheKey] = result;
        saveJson(eventFixCachePath, cache);
        return result;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("ECONNREFUSED") && !msg.includes("connect")) log("get-event-fix error: " + msg);
  }

  // Fallback to safeNextSteps
  const rawResult: EventFixResult = {
    title: `Fix: ${finding.clusterId}`,
    rootCauses: [],
    steps: finding.safeNextSteps.map((s, i) => ({ label: `Step ${i + 1}`, instruction: s })),
    escalation: "Contact a professional if the issue persists.",
  };
  const result = sanitizeFixResult(rawResult, cluster.provider, cluster.eventId);
  cache[cacheKey] = result;
  saveJson(eventFixCachePath, cache);
  return result;
});

ipcMain.handle("import-event-log", async () => {
  if (!mainWindow) return { ok: false, error: "No window available" };

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Import Windows Event Log",
    filters: [{ name: "Event Log Files", extensions: ["evtx"] }],
    properties: ["openFile"],
  });

  if (canceled || filePaths.length === 0) return { ok: false, canceled: true };

  const filePath = filePaths[0];
  const fileName = path.basename(filePath);

  try {
    const fileHash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    const { stdout } = await safeExecFile(
      "wevtutil",
      ["qe", filePath, "/lf:true", "/f:xml", "/c:2000"],
      { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }
    );

    const entries = parseWevtutilXml(stdout);
    const report = clusterEvents(entries, fileName);
    report.fileHash = fileHash;

    appendAudit("event-log", `Imported event log: ${fileName}`, {
      totalEvents: report.totalEvents,
      health: report.overallHealth,
      clusters: report.clusters.length,
      fileHash,
    });

    return { ok: true, report };
  } catch (err) {
    log("import-event-log error: " + String(err));
    return { ok: false, error: String(err) };
  }
});
