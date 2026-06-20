import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EXCLUDED_DIRS = new Set([
  ".git",
  ".next",
  ".next-dev",
  ".codegraph",
  ".claude",
  ".chatboks",
  "node_modules",
  "dist",
  "dist_electron",
  "out",
  "release",
  "releases",
  "resources",
]);

const LANGUAGE_BY_EXT = new Map([
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".mjs", "JavaScript"],
  [".cjs", "JavaScript"],
  [".css", "CSS"],
  [".json", "JSON"],
  [".md", "Markdown"],
  [".mjs", "JavaScript"],
  [".yml", "YAML"],
  [".yaml", "YAML"],
  [".ps1", "PowerShell"],
  [".mjs", "JavaScript"],
]);

const DASHBOARD_HOME = path.resolve(process.env.PROJECT_DASHBOARD_HOME ?? path.join(os.homedir(), ".codex", "project-dashboard"));
const CONFIG_PATH = path.resolve(process.env.PROJECT_DASHBOARD_CONFIG ?? path.join(DASHBOARD_HOME, "config.json"));
const MODULES_DIR = path.join(DASHBOARD_HOME, "modules");
const APP_RUNTIME_DIR = path.join(DASHBOARD_HOME, "apps");
const DEFAULT_PAPER_SLEUTH_ROOT = path.resolve(process.env.PAPER_SLEUTH_ROOT ?? path.join(os.homedir(), "Documents", "Paper Sleuth"));
const TICKET_FOLDER_ALIASES = new Map([
  ["circuitnine", "circuitnine-ironpaw"],
  ["ironpaw", "circuitnine-ironpaw"],
  ["informationontology", "information-ontology"],
  ["wall-vision", "wallvision"],
]);

function run(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function runVisible(cmd, args, cwd) {
  try {
    execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      stdio: "inherit",
    });
    return true;
  } catch {
    return false;
  }
}

function safeRead(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function safeJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function defaultDashboardConfig() {
  return {
    version: 1,
    paperSleuthRoot: DEFAULT_PAPER_SLEUTH_ROOT,
    projects: [],
    customModulesDir: MODULES_DIR,
  };
}

function readDashboardConfig() {
  const config = safeJson(CONFIG_PATH, null);
  if (!config || typeof config !== "object") return defaultDashboardConfig();
  return normalizeDashboardConfig(config);
}

function normalizeDashboardConfig(config) {
  const fallback = defaultDashboardConfig();
  return {
    version: 1,
    paperSleuthRoot: path.resolve(String(config.paperSleuthRoot || fallback.paperSleuthRoot)),
    projects: Array.isArray(config.projects)
      ? config.projects.map(normalizeProjectConfig).filter(Boolean)
      : [],
    customModulesDir: path.resolve(String(config.customModulesDir || fallback.customModulesDir)),
  };
}

function normalizeProjectConfig(project) {
  if (!project || typeof project !== "object") return null;
  const projectPath = String(project.path ?? "").trim();
  const name = String(project.name ?? "").trim();
  const id = slugify(project.id || project.ticketFolder || name || projectPath);
  if (!id || !projectPath) return null;
  const launch = project.launch && typeof project.launch === "object" ? project.launch : {};
  return {
    id,
    name: name || titleizeSlug(id),
    path: path.resolve(projectPath),
    ticketFolder: slugify(project.ticketFolder || id),
    launch: {
      mode: String(launch.mode ?? "auto"),
      command: String(launch.command ?? ""),
      args: Array.isArray(launch.args) ? launch.args.map(String) : [],
      cwd: launch.cwd ? path.resolve(String(launch.cwd)) : "",
      processName: String(launch.processName ?? ""),
      label: String(launch.label ?? ""),
    },
  };
}

function writeDashboardConfig(config) {
  ensureDir(path.dirname(CONFIG_PATH));
  const normalized = normalizeDashboardConfig(config);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function paperSleuthRoot(config = readDashboardConfig()) {
  return path.resolve(config.paperSleuthRoot || DEFAULT_PAPER_SLEUTH_ROOT);
}

function paperSleuthTicketsDir(config = readDashboardConfig()) {
  return path.join(paperSleuthRoot(config), "research", "tickets");
}

function projectConfigForRoot(projectRoot, config = readDashboardConfig()) {
  const resolved = path.resolve(projectRoot).toLowerCase();
  return config.projects.find(project => path.resolve(project.path).toLowerCase() === resolved) ?? null;
}

function projectIdentity(projectRoot, config = readDashboardConfig()) {
  const configured = projectConfigForRoot(projectRoot, config);
  if (configured) return configured;
  const pkg = readPackageMetadata(projectRoot);
  const ticketFolder = resolveTicketFolderSlug(projectRoot, config);
  const packageSlug = slugify(pkg?.name);
  const id = ticketFolder || (packageSlug && !["workspace", "repo", "app"].includes(packageSlug) ? packageSlug : projectSlug(projectRoot));
  return {
    id,
    name: displayProjectName(projectRoot),
    path: path.resolve(projectRoot),
    ticketFolder: ticketFolder || id,
    launch: { mode: "auto", command: "", args: [], cwd: "", processName: "", label: "" },
  };
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function projectSlug(projectRoot) {
  return slugify(path.basename(projectRoot));
}

function procedurePaths(projectRoot, config = readDashboardConfig()) {
  const dir = path.join(DASHBOARD_HOME, "procedures", projectIdentity(projectRoot, config).id);
  return {
    dir,
    json: path.join(dir, "procedures.json"),
    startup: path.join(dir, "startup.md"),
    close: path.join(dir, "close.md"),
  };
}

function appStatePath(projectRoot, config = readDashboardConfig()) {
  return path.join(APP_RUNTIME_DIR, `${projectIdentity(projectRoot, config).id}.json`);
}

function readProcedureStore(projectRoot) {
  const paths = procedurePaths(projectRoot);
  return safeJson(paths.json, {});
}

function relativeSlash(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replaceAll(path.sep, "/");
}

function readPackageMetadata(projectRoot) {
  const pkg = safeJson(path.join(projectRoot, "package.json"), null);
  return pkg && typeof pkg === "object" ? pkg : {};
}

function executableNames(projectRoot) {
  const pkg = readPackageMetadata(projectRoot);
  const names = [
    pkg?.build?.win?.executableName,
    pkg?.build?.productName,
    pkg?.productName,
    pkg?.displayName,
    path.basename(projectRoot),
  ];
  return [...new Set(names.map(name => String(name ?? "").trim()).filter(Boolean))]
    .flatMap(name => [name.endsWith(".exe") ? name : `${name}.exe`]);
}

function executableCandidates(projectRoot) {
  const names = executableNames(projectRoot);
  const dirs = [
    path.join(projectRoot, "dist_electron", "win-unpacked"),
    path.join(projectRoot, "dist", "win-unpacked"),
    path.join(projectRoot, "release", "win-unpacked"),
    path.join(projectRoot, "releases", "win-unpacked"),
    projectRoot,
  ];

  return dirs.flatMap(dir => names.map(name => path.join(dir, name)));
}

function findLaunchTarget(projectRoot, config = readDashboardConfig()) {
  const configured = projectConfigForRoot(projectRoot, config);
  const launch = configured?.launch;
  if (launch?.mode === "executable" && launch.command) {
    return {
      mode: "executable",
      command: path.resolve(launch.command),
      args: launch.args ?? [],
      cwd: launch.cwd || path.dirname(path.resolve(launch.command)),
      label: launch.label || path.basename(launch.command),
      processName: launch.processName || path.basename(launch.command),
    };
  }
  if (launch?.mode === "command" && launch.command) {
    return {
      mode: "command",
      command: launch.command,
      args: launch.args ?? [],
      cwd: launch.cwd || projectRoot,
      label: launch.label || launch.command,
      processName: launch.processName || "",
    };
  }

  const executable = executableCandidates(projectRoot).find(candidate => fs.existsSync(candidate));
  if (executable) {
    return {
      mode: "executable",
      command: executable,
      args: [],
      cwd: path.dirname(executable),
      label: path.basename(executable),
      processName: path.basename(executable),
    };
  }

  const pkg = readPackageMetadata(projectRoot);
  const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const scriptName = ["electron-dev", "dev", "start"].find(name => scripts[name]);
  if (scriptName) {
    return {
      mode: "npm",
      command: "npm.cmd",
      args: ["run", scriptName],
      cwd: projectRoot,
      label: `npm run ${scriptName}`,
      processName: "",
    };
  }

  return null;
}

function isPidRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function collectAppControl(projectRoot, config = readDashboardConfig()) {
  const target = findLaunchTarget(projectRoot, config);
  const state = safeJson(appStatePath(projectRoot, config), {});
  const running = isPidRunning(Number(state.pid));
  return {
    available: Boolean(target),
    running,
    pid: running ? Number(state.pid) : null,
    label: target?.label ?? "No launch target",
    command: target ? [target.command, ...target.args].join(" ") : "",
    mode: target?.mode ?? "",
    processName: target?.processName ?? "",
    startedAt: running ? String(state.startedAt ?? "") : "",
  };
}

function startApp(projectRoot, config = readDashboardConfig()) {
  const target = findLaunchTarget(projectRoot, config);
  if (!target) return { ok: false, error: "No application launch target found for this project." };

  const current = collectAppControl(projectRoot, config);
  if (current.running) return { ok: true, message: `${current.label} is already running.`, appControl: current };

  ensureDir(APP_RUNTIME_DIR);
  const child = spawn(target.command, target.args, {
    cwd: target.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: target.mode !== "executable",
  });
  child.unref();

  fs.writeFileSync(appStatePath(projectRoot, config), JSON.stringify({
    pid: child.pid,
    command: [target.command, ...target.args].join(" "),
    label: target.label,
    processName: target.processName,
    startedAt: new Date().toISOString(),
  }, null, 2), "utf8");

  return { ok: true, message: `Started ${target.label}.`, appControl: collectAppControl(projectRoot, config) };
}

function stopApp(projectRoot, config = readDashboardConfig()) {
  const statePath = appStatePath(projectRoot, config);
  const state = safeJson(statePath, {});
  const target = findLaunchTarget(projectRoot, config);
  const pid = Number(state.pid);
  let stopped = false;

  if (isPidRunning(pid)) {
    run("taskkill", ["/PID", String(pid), "/T", "/F"], projectRoot);
    stopped = true;
  } else if (target?.processName) {
    const output = run("taskkill", ["/IM", target.processName, "/T", "/F"], projectRoot);
    stopped = Boolean(output);
  }

  try {
    fs.rmSync(statePath, { force: true });
  } catch {
    // State cleanup is best-effort; the next snapshot will recompute running status.
  }

  return {
    ok: true,
    message: stopped ? `Stopped ${target?.label ?? "application"}.` : `${target?.label ?? "Application"} was not running.`,
    appControl: collectAppControl(projectRoot, config),
  };
}

function titleizeSlug(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function displayProjectName(projectRoot) {
  const pkg = readPackageMetadata(projectRoot);
  const directoryName = path.basename(projectRoot);
  const directoryLabel = ["repo", "app"].includes(directoryName.toLowerCase())
    ? path.basename(path.dirname(projectRoot))
    : directoryName;
  if (pkg?.build?.productName) return String(pkg.build.productName);
  if (pkg?.productName) return String(pkg.productName);
  if (pkg?.displayName) return String(pkg.displayName);
  if (pkg?.name) {
    const packageSlug = slugify(pkg.name);
    if (!["workspace", "repo", "app"].includes(packageSlug) && packageSlug !== slugify(directoryLabel)) {
      return titleizeSlug(pkg.name);
    }
  }
  return directoryLabel;
}

function projectSlugCandidates(projectRoot, config = readDashboardConfig()) {
  const configured = projectConfigForRoot(projectRoot, config);
  const pkg = readPackageMetadata(projectRoot);
  const candidates = [
    configured?.id,
    configured?.ticketFolder,
    configured?.name,
    pkg?.name,
    pkg?.build?.productName,
    pkg?.productName,
    pkg?.displayName,
    path.basename(projectRoot),
    path.basename(path.dirname(projectRoot)),
  ];
  return [...new Set(candidates.map(slugify).filter(Boolean))];
}

function listTicketFolders(config = readDashboardConfig()) {
  try {
    return fs.readdirSync(paperSleuthTicketsDir(config), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function resolveTicketFolderSlug(projectRoot, config = readDashboardConfig()) {
  const configured = projectConfigForRoot(projectRoot, config);
  if (configured?.ticketFolder) return configured.ticketFolder;
  const folders = listTicketFolders(config);
  if (!folders.length) return "";
  const folderBySlug = new Map(folders.map(folder => [slugify(folder), folder]));

  for (const candidate of projectSlugCandidates(projectRoot, config)) {
    const alias = TICKET_FOLDER_ALIASES.get(candidate) ?? candidate;
    if (folderBySlug.has(alias)) return folderBySlug.get(alias);
  }

  for (const candidate of projectSlugCandidates(projectRoot, config)) {
    const fuzzy = folders.find(folder => {
      const folderSlug = slugify(folder);
      return folderSlug.startsWith(`${candidate}-`) || folderSlug.endsWith(`-${candidate}`);
    });
    if (fuzzy) return fuzzy;
  }

  return "";
}

function ticketFolderPath(projectRoot, config = readDashboardConfig()) {
  const folder = resolveTicketFolderSlug(projectRoot, config);
  return folder ? path.join(paperSleuthTicketsDir(config), folder) : "";
}

function ticketFileCount(projectRoot, config = readDashboardConfig()) {
  const dir = ticketFolderPath(projectRoot, config);
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

function looksLikeProject(dirPath) {
  return ["package.json", ".git", ".codegraph", "AGENTS.md", "dashboard.md"].some(name => fs.existsSync(path.join(dirPath, name)));
}

function shouldSkipDiscoveredProject(name) {
  const lower = name.toLowerCase();
  return name.startsWith(".")
    || EXCLUDED_DIRS.has(name)
    || ["archive-src", "backup", "scripts"].includes(lower)
    || lower.includes("backup")
    || lower.includes("installation files");
}

function collectProjects(currentRoot, config = readDashboardConfig()) {
  const byPath = new Map();
  const addProject = (candidate, configured = null) => {
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved)) return;
    byPath.set(resolved.toLowerCase(), { path: resolved, configured });
  };

  addProject(currentRoot);
  for (const project of config.projects) {
    addProject(project.path, project);
  }

  if (config.projects.length === 0) {
    const desktop = path.join(os.homedir(), "Desktop");
    try {
      for (const entry of fs.readdirSync(desktop, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith("@") || shouldSkipDiscoveredProject(entry.name)) continue;
        const dir = path.join(desktop, entry.name);
        if (looksLikeProject(dir)) addProject(dir);

        for (const child of fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isDirectory()).slice(0, 12)) {
          if (shouldSkipDiscoveredProject(child.name)) continue;
          const childDir = path.join(dir, child.name);
          if (looksLikeProject(childDir)) addProject(childDir);
        }
      }
    } catch {
      // The current project remains available if Desktop discovery is unavailable.
    }
  }

  const currentPath = path.resolve(currentRoot).toLowerCase();
  return [...byPath.values()]
    .map(({ path: projectPath, configured }) => {
      const ticketFolder = resolveTicketFolderSlug(projectPath, config);
      return {
        id: configured?.id ?? projectIdentity(projectPath, config).id,
        name: configured?.name ?? displayProjectName(projectPath),
        path: projectPath,
        ticketFolder,
        ticketCount: ticketFileCount(projectPath, config),
        configured: Boolean(configured),
      };
    })
    .sort((a, b) => {
      if (a.path.toLowerCase() === currentPath) return -1;
      if (b.path.toLowerCase() === currentPath) return 1;
      return a.name.localeCompare(b.name);
    });
}

function parseRemoteUrl(remote) {
  if (!remote) return "";
  const trimmed = remote.trim();
  if (trimmed.startsWith("git@github.com:")) {
    return `https://github.com/${trimmed.slice("git@github.com:".length).replace(/\.git$/, "")}`;
  }
  return trimmed.replace(/\.git$/, "");
}

function collectGit(projectRoot) {
  const statusRaw = run("git", ["status", "--short", "--branch"], projectRoot);
  const lines = statusRaw ? statusRaw.split(/\r?\n/) : [];
  const branchLine = lines.find(line => line.startsWith("##")) ?? "";
  const branch = branchLine.replace(/^##\s*/, "").split("...")[0] || "unknown";
  const statusLines = lines.filter(line => !line.startsWith("##"));
  const uncommitted = statusLines.map(line => ({
    status: line.slice(0, 2).trim() || "??",
    path: line.slice(3).trim().replaceAll("\\", "/"),
  })).filter(item => item.path);
  const aheadBehind = branchLine.match(/\[(.*?)\]/)?.[1] ?? "";
  const remoteUrl = parseRemoteUrl(run("git", ["config", "--get", "remote.origin.url"], projectRoot));
  const logRaw = run("git", ["log", "-5", "--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s"], projectRoot);
  const commits = logRaw ? logRaw.split(/\r?\n/).map(line => {
    const [hash, shortHash, author, relativeDate, subject] = line.split("\x1f");
    return {
      hash,
      shortHash,
      author,
      relativeDate,
      subject,
      url: remoteUrl && hash ? `${remoteUrl}/commit/${hash}` : "",
    };
  }) : [];

  return {
    branch,
    status: uncommitted.length === 0 ? "Clean working tree" : `${uncommitted.length} uncommitted file${uncommitted.length === 1 ? "" : "s"}`,
    clean: uncommitted.length === 0,
    aheadBehind,
    remoteUrl,
    uncommitted,
    commits,
  };
}

function listFiles(projectRoot) {
  const raw = run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], projectRoot);
  if (raw) {
    return raw.split(/\r?\n/).filter(Boolean).map(item => item.replaceAll("\\", "/"));
  }

  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        files.push(relativeSlash(projectRoot, absolute));
      }
    }
  }
  walk(projectRoot);
  return files;
}

function isUncommittedPath(filePath, uncommittedPaths) {
  return [...uncommittedPaths].some(item => {
    const normalized = item.replace(/\/$/, "");
    return filePath === normalized || filePath.startsWith(`${normalized}/`);
  });
}

function buildFileTree(files, uncommittedPaths) {
  const root = { name: "Tasker", path: "", type: "dir", children: [], uncommitted: false };

  for (const file of files.slice(0, 400)) {
    const parts = file.split("/");
    let cursor = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const currentPath = parts.slice(0, index + 1).join("/");
      let child = cursor.children.find(item => item.name === part && item.type === (isFile ? "file" : "dir"));
      if (!child) {
        child = {
          name: part,
          path: currentPath,
          type: isFile ? "file" : "dir",
          children: [],
          uncommitted: isUncommittedPath(currentPath, uncommittedPaths),
        };
        cursor.children.push(child);
      }
      if (isUncommittedPath(currentPath, uncommittedPaths)) child.uncommitted = true;
      cursor = child;
    });
  }

  function sortNode(node) {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortNode);
    node.uncommitted = node.uncommitted || node.children.some(child => child.uncommitted);
  }
  sortNode(root);
  return root;
}

function collectStats(projectRoot, files) {
  const languages = new Map();
  let linesOfCode = 0;
  let filesChanged = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const language = LANGUAGE_BY_EXT.get(ext) ?? "Other";
    languages.set(language, (languages.get(language) ?? 0) + 1);

    if (filesChanged < 900 && ![".jpg", ".jpeg", ".png", ".ico", ".evtx", ".pak"].includes(ext)) {
      const content = safeRead(path.join(projectRoot, file));
      linesOfCode += content ? content.split(/\r?\n/).length : 0;
      filesChanged += 1;
    }
  }

  return {
    files: files.length,
    linesOfCode,
    sessions: countSessions(projectRoot),
    languages: [...languages.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  };
}

function countSessions(projectRoot) {
  const sessionsDir = path.join(projectRoot, "dashboards", "sessions");
  try {
    return fs.readdirSync(sessionsDir).filter(name => name.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function markdownField(content, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.match(new RegExp(`^${escaped}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
}

function markdownTitle(content, fallback) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback;
}

function markdownSection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^##\\s+${escaped}\\s*$`, "im"));
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const rest = content.slice(start).replace(/^\r?\n/, "");
  const nextHeading = rest.search(/^##\s+/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  return section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join(" ");
}

function collectSourceUrls(content) {
  return [...new Set(content.match(/https?:\/\/[^\s)]+/g) ?? [])];
}

function parseTicketFile(filePath, folderSlug, index) {
  const content = safeRead(filePath);
  const sourceUrls = collectSourceUrls(content);
  const stats = fs.statSync(filePath);
  const fallbackTitle = titleizeSlug(path.basename(filePath, ".md"));
  const priority = markdownField(content, "Priority");
  const status = markdownField(content, "Status") || "Open";

  return {
    id: `${folderSlug}-${path.basename(filePath, ".md") || index + 1}`,
    title: markdownTitle(content, fallbackTitle),
    severity: normalizeSeverity(priority || markdownField(content, "Severity")),
    status,
    source: `Paper Sleuth / ${markdownField(content, "Project") || titleizeSlug(folderSlug)}`,
    updated: markdownField(content, "Updated") || stats.mtime.toISOString().slice(0, 10),
    url: sourceUrls[0] ?? "",
    sourceUrls,
    path: filePath,
    summary: markdownSection(content, "Summary"),
  };
}

function collectPaperSleuthTickets(projectRoot, config = readDashboardConfig()) {
  const ticketsDir = paperSleuthTicketsDir(config);
  if (!fs.existsSync(ticketsDir)) return null;
  const folderSlug = resolveTicketFolderSlug(projectRoot, config);
  if (!folderSlug) return [];
  const dir = path.join(ticketsDir, folderSlug);
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry, index) => parseTicketFile(path.join(dir, entry.name), folderSlug, index))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.title.localeCompare(b.title));
  } catch {
    return [];
  }
}

function collectTickets(projectRoot, config = readDashboardConfig()) {
  const paperTickets = collectPaperSleuthTickets(projectRoot, config);
  if (paperTickets) return paperTickets;

  const candidates = [
    path.join(projectRoot, ".paper-sleuth", "tickets.json"),
    path.join(projectRoot, "paper-sleuth-tickets.json"),
    path.join(projectRoot, "dashboards", "paper-sleuth-tickets.json"),
    path.join(projectRoot, "tickets.json"),
  ];

  for (const candidate of candidates) {
    const raw = safeJson(candidate, null);
    const items = Array.isArray(raw) ? raw : Array.isArray(raw?.tickets) ? raw.tickets : null;
    if (!items) continue;
    return items.map((item, index) => ({
      id: String(item.id ?? `paper-${index + 1}`),
      title: String(item.title ?? item.summary ?? "Untitled ticket"),
      severity: normalizeSeverity(item.severity ?? item.priority),
      status: String(item.status ?? "Open"),
      source: String(item.source ?? "Paper Sleuth"),
      updated: String(item.updated ?? item.updatedAt ?? ""),
      url: String(item.url ?? ""),
      sourceUrls: item.url ? [String(item.url)] : [],
      path: String(item.path ?? ""),
      summary: String(item.summary ?? ""),
    }));
  }

  return [];
}

function severityRank(value) {
  const severity = normalizeSeverity(value);
  if (severity === "High") return 0;
  if (severity === "Medium") return 1;
  return 2;
}

function normalizeSeverity(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("critical") || text.includes("high") || text.includes("p0") || text.includes("p1")) return "High";
  if (text.includes("low") || text.includes("p3") || text.includes("p4")) return "Low";
  return "Medium";
}

function collectCodeGraph(projectRoot) {
  const hasIndex = fs.existsSync(path.join(projectRoot, ".codegraph"));
  return {
    configured: hasIndex,
    status: hasIndex ? "Index present" : "Not initialized",
    issue: !hasIndex,
  };
}

function collectGraphify(projectRoot) {
  const configCandidates = [
    "graphify.config.json",
    ".graphify.json",
    "graphify.md",
    "GRAPHIFY.md",
  ];
  const configured = configCandidates.some(name => fs.existsSync(path.join(projectRoot, name)));
  return {
    configured,
    status: configured ? "Configured" : "Not configured",
    issue: !configured,
  };
}

function readNotes(projectRoot) {
  const notesPath = path.join(projectRoot, "notes.md");
  if (!fs.existsSync(notesPath)) {
    fs.writeFileSync(notesPath, "# Project Notes\n\n## Next Steps\n\n", "utf8");
  }
  return safeRead(notesPath);
}

function flowNode(id, label, detail, tone = "core", issue = false, meta = "", actionType = "note", actionValue = "") {
  return { id, label, detail, tone, issue, meta, actionType, actionValue };
}

function applyProcedureOverride(projectRoot, key, fallbackFlow) {
  const store = readProcedureStore(projectRoot);
  const saved = store?.[key]?.flow;
  if (!saved || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges)) {
    return fallbackFlow;
  }
  return {
    ...fallbackFlow,
    ...saved,
    title: fallbackFlow.title,
  };
}

function buildFlows(snapshot, projectRoot) {
  const graphifyIssue = snapshot.graphify.issue;
  const codeGraphIssue = snapshot.codeGraph.issue;
  const gitIssue = !snapshot.git.clean;
  const ticketIssue = snapshot.tickets.some(ticket => ticket.severity === "High" && ticket.status.toLowerCase() !== "closed");

  const defaults = {
    sessionStart: {
      title: "Session Start",
      nodes: [
        flowNode("open", "Open Project", `Select \"${snapshot.project.name}\"`, "core", false, "", "command", "/session start"),
        flowNode("agents", "Read AGENTS.md", "Load startup instructions", "info", !snapshot.files.includes("AGENTS.md"), "", "file", "AGENTS.md"),
        flowNode("codegraph", "CodeGraph Check", snapshot.codeGraph.status, "issue", codeGraphIssue, codeGraphIssue ? "Known Issues" : "", "command", "codegraph_status"),
        flowNode("snapshot", "Dashboard Snapshot", "Load dashboard.md", "optional", !snapshot.dashboardMarkdownExists, "", "file", "dashboard.md"),
        flowNode("tickets", "Paper Sleuth Tickets", `${snapshot.tickets.length} open/source items`, "core", ticketIssue, "", "note", "Review open tickets"),
        flowNode("notes", "Mount Notes", "Open notes.md", "optional", false, "", "file", "notes.md"),
        flowNode("ready", "Session Ready", "Environment ready", "core", codeGraphIssue || ticketIssue, "", "note", "Begin work"),
      ],
      edges: [
        ["open", "agents"],
        ["agents", "codegraph"],
        ["codegraph", "snapshot"],
        ["codegraph", "tickets"],
        ["codegraph", "notes"],
        ["snapshot", "ready"],
        ["tickets", "ready"],
        ["notes", "ready"],
      ],
      positions: {},
    },
    sessionClose: {
      title: "Session Close",
      nodes: [
        flowNode("begin", "Begin Close", "Run /session close", "core", false, "", "command", "/session close"),
        flowNode("close-notes", "Write notes.md", "Save edits and next steps", "info", false, "", "file", "notes.md"),
        flowNode("close-markdown", "Update Markdown", "Write edited/appended docs", "info", false, "", "note", "Update changed markdown files"),
        flowNode("close-codegraph", "Sync CodeGraph", snapshot.codeGraph.status, "core", codeGraphIssue, "", "command", "codegraph sync"),
        flowNode("close-graphify", "Update Graphify", snapshot.graphify.status, "optional", graphifyIssue, graphifyIssue ? "Not configured" : "", "command", "graphify update"),
        flowNode("close-git", "Check Git Status", snapshot.git.status, "issue", gitIssue, gitIssue ? "Known Issues" : "", "command", "git status"),
        flowNode("close-gate", "Clean Tree Gate", gitIssue ? "Blocked before close" : "Clear", "issue", gitIssue, "", "note", "Do not close with unexplained dirty state"),
        flowNode("close-dashboard", "Write dashboard.md", "Persist next startup data", "core", false, "", "file", "dashboard.md"),
        flowNode("closed", "Session Closed", gitIssue ? "Needs cleanup" : "Ready for next session", "core", gitIssue, "", "note", "Ready for next session"),
      ],
      edges: [
        ["begin", "close-notes"],
        ["close-notes", "close-markdown"],
        ["close-markdown", "close-codegraph"],
        ["close-codegraph", "close-graphify"],
        ["close-graphify", "close-git"],
        ["close-git", "close-gate"],
        ["close-gate", "close-dashboard"],
        ["close-dashboard", "closed"],
      ],
      positions: {},
    },
    program: {
      title: "Program Flow",
      nodes: [
        flowNode("ui", "Dashboard UI", "Next.js route", "core"),
        flowNode("api", "Collector API", "/api/project-dashboard", "core"),
        flowNode("collector", "Project Collector", "Git, files, tickets, stats", "info"),
        flowNode("store", "Dashboard Store", "dashboard.md + dashboards/", "optional"),
        flowNode("notes", "Notes Writer", "notes.md", "optional"),
        flowNode("external", "Native Open", "Open files/commits externally", "info"),
      ],
      edges: [
        ["ui", "api"],
        ["api", "collector"],
        ["collector", "store"],
        ["collector", "notes"],
        ["ui", "external"],
      ],
      positions: {},
    },
  };

  return {
    sessionStart: applyProcedureOverride(projectRoot, "sessionStart", defaults.sessionStart),
    sessionClose: applyProcedureOverride(projectRoot, "sessionClose", defaults.sessionClose),
    program: defaults.program,
  };
}

function buildReadiness(snapshot) {
  const items = [
    {
      id: "git-clean",
      label: "Git working tree clean",
      ok: snapshot.git.clean,
      detail: snapshot.git.status,
    },
    {
      id: "codegraph",
      label: "CodeGraph synced",
      ok: snapshot.codeGraph.configured,
      detail: snapshot.codeGraph.status,
    },
    {
      id: "graphify",
      label: "Graphify updated",
      ok: snapshot.graphify.configured,
      detail: snapshot.graphify.status,
    },
    {
      id: "notes",
      label: "Notes saved",
      ok: Boolean(snapshot.notes.content.trim()),
      detail: "notes.md available",
    },
    {
      id: "dashboard",
      label: "Dashboard handoff written",
      ok: snapshot.dashboardMarkdownExists,
      detail: snapshot.dashboardMarkdownExists ? "dashboard.md available" : "Will be written on close",
    },
  ];

  return {
    clear: items.every(item => item.ok),
    items,
  };
}

function collectCustomModules(projectRoot, config = readDashboardConfig()) {
  const projectId = projectIdentity(projectRoot, config).id;
  const dirs = [path.join(config.customModulesDir, "global"), path.join(config.customModulesDir, projectId)];
  const modules = [];

  for (const dir of dirs) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = path.join(dir, entry.name);
        const raw = safeJson(filePath, null);
        if (!raw || typeof raw !== "object") continue;
        modules.push({
          id: slugify(raw.id || path.basename(entry.name, ".json")),
          title: String(raw.title ?? titleizeSlug(path.basename(entry.name, ".json"))),
          summary: String(raw.summary ?? raw.description ?? ""),
          severity: normalizeSeverity(raw.severity ?? raw.priority ?? "Medium"),
          status: String(raw.status ?? "Open"),
          source: String(raw.source ?? "Dashboard Module"),
          updated: String(raw.updated ?? raw.updatedAt ?? ""),
          content: String(raw.content ?? ""),
          url: String(raw.url ?? ""),
          path: filePath,
        });
      }
    } catch {
      // Missing module folders are normal.
    }
  }

  return modules.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.title.localeCompare(b.title));
}

function collectSnapshot(projectRoot, mode = "snapshot") {
  const config = readDashboardConfig();
  const resolvedRoot = path.resolve(projectRoot);
  const identity = projectIdentity(resolvedRoot, config);
  const git = collectGit(resolvedRoot);
  const files = listFiles(resolvedRoot);
  const uncommittedPaths = new Set(git.uncommitted.map(item => item.path));
  const notesContent = readNotes(resolvedRoot);
  const dashboardMarkdownPath = path.join(resolvedRoot, "dashboard.md");
  const ticketFolder = resolveTicketFolderSlug(resolvedRoot, config);
  const tickets = collectTickets(resolvedRoot, config);
  const customModules = collectCustomModules(resolvedRoot, config);
  const projects = collectProjects(resolvedRoot, config);
  const configForSnapshot = config.projects.length
    ? config
    : {
        ...config,
        projects: projects.map(project => ({
          id: project.id,
          name: project.name,
          path: project.path,
          ticketFolder: project.ticketFolder || project.id,
          launch: { mode: "auto", command: "", args: [], cwd: "", processName: "", label: "" },
        })),
      };

  const snapshot = {
    version: 1,
    mode,
    generatedAt: new Date().toISOString(),
    config: {
      path: CONFIG_PATH,
      home: DASHBOARD_HOME,
      modulesDir: config.customModulesDir,
      data: configForSnapshot,
    },
    project: {
      id: identity.id,
      name: identity.name,
      path: resolvedRoot,
      ticketFolder,
    },
    projects,
    paperSleuth: {
      root: paperSleuthRoot(config),
      ticketsDir: paperSleuthTicketsDir(config),
      projectFolder: ticketFolder,
      projectTicketsPath: ticketFolder ? path.join(paperSleuthTicketsDir(config), ticketFolder) : "",
      status: !fs.existsSync(paperSleuthTicketsDir(config))
        ? "Paper Sleuth tickets directory not found"
        : ticketFolder
          ? `${tickets.length} ticket${tickets.length === 1 ? "" : "s"} found`
          : "No matching Paper Sleuth ticket folder",
    },
    appControl: collectAppControl(resolvedRoot, config),
    git,
    codeGraph: collectCodeGraph(resolvedRoot),
    graphify: collectGraphify(resolvedRoot),
    dashboardMarkdownExists: fs.existsSync(dashboardMarkdownPath),
    files,
    fileTree: buildFileTree(files, uncommittedPaths),
    stats: collectStats(resolvedRoot, files),
    notes: {
      path: "notes.md",
      content: notesContent,
    },
    tickets,
    customModules,
  };

  snapshot.procedures = procedurePaths(resolvedRoot, config);
  snapshot.flows = buildFlows(snapshot, resolvedRoot);
  snapshot.readiness = buildReadiness(snapshot);
  snapshot.attention = buildAttention(snapshot);
  return snapshot;
}

function buildAttention(snapshot) {
  const items = [];
  if (!snapshot.git.clean) {
    items.push({
      id: "git-dirty",
      severity: "High",
      title: `${snapshot.git.uncommitted.length} uncommitted file${snapshot.git.uncommitted.length === 1 ? "" : "s"}`,
      source: "Git",
    });
  }
  if (snapshot.codeGraph.issue) {
    items.push({
      id: "codegraph-missing",
      severity: "High",
      title: "CodeGraph is not initialized",
      source: "CodeGraph",
    });
  }
  if (snapshot.graphify.issue) {
    items.push({
      id: "graphify-missing",
      severity: "Medium",
      title: "Graphify integration is not configured",
      source: "Graphify",
    });
  }
  for (const ticket of snapshot.tickets.filter(ticket => ticket.status.toLowerCase() !== "closed")) {
    items.push({
      id: ticket.id,
      severity: ticket.severity,
      title: ticket.title,
      source: ticket.source,
    });
  }
  return items.slice(0, 8);
}

function renderMarkdown(snapshot) {
  const data = JSON.stringify(snapshot, null, 2);
  const uncommitted = snapshot.git.uncommitted.length
    ? snapshot.git.uncommitted.map(item => `- ${item.status} ${item.path}`).join("\n")
    : "- None";
  const commits = snapshot.git.commits.length
    ? snapshot.git.commits.map(item => `- ${item.shortHash} ${item.subject} (${item.relativeDate})`).join("\n")
    : "- None";
  const tickets = snapshot.tickets.length
    ? snapshot.tickets.map(item => `- [${item.severity}] ${item.title} (${item.status})`).join("\n")
    : "- None";
  const customModules = snapshot.customModules.length
    ? snapshot.customModules.map(item => `- [${item.severity}] ${item.title} (${item.status})`).join("\n")
    : "- None";
  const readiness = snapshot.readiness.items
    .map(item => `- [${item.ok ? "x" : " "}] ${item.label}: ${item.detail}`)
    .join("\n");

  return `# Project Dashboard

Generated: ${snapshot.generatedAt}
Project: ${snapshot.project.name}
Path: ${snapshot.project.path}
Paper Sleuth: ${snapshot.paperSleuth.status}

## Next Session Brief

- Start with the Attention Queue below.
- Use /session start when opening this project.
- Use /session close before leaving so CodeGraph, Graphify, notes, git status, and dashboard data are checked.

## Close Readiness

${readiness}

## Attention Queue

${snapshot.attention.map(item => `- [${item.severity}] ${item.title} (${item.source})`).join("\n") || "- Clear"}

## Git

- Branch: ${snapshot.git.branch}
- Status: ${snapshot.git.status}
- Ahead/Behind: ${snapshot.git.aheadBehind || "0/0"}

### Uncommitted Files

${uncommitted}

### Recent Commits

${commits}

## Paper Sleuth Tickets

${tickets}

## Custom Modules

${customModules}

## Dashboard Data

<!-- PROJECT_DASHBOARD_DATA_START -->
\`\`\`json
${data}
\`\`\`
<!-- PROJECT_DASHBOARD_DATA_END -->
`;
}

function writeSnapshot(projectRoot, snapshot) {
  const dashboardsDir = path.join(projectRoot, "dashboards");
  const sessionsDir = path.join(dashboardsDir, "sessions");
  ensureDir(sessionsDir);
  snapshot.dashboardMarkdownExists = true;
  snapshot.flows = buildFlows(snapshot, projectRoot);
  snapshot.readiness = buildReadiness(snapshot);
  snapshot.attention = buildAttention(snapshot);
  const stamp = snapshot.generatedAt.replace(/[:.]/g, "-");
  const sessionFile = path.join(sessionsDir, `${stamp}.json`);
  const latestFile = path.join(dashboardsDir, "latest.json");
  const dashboardMarkdown = path.join(projectRoot, "dashboard.md");

  fs.writeFileSync(sessionFile, JSON.stringify(snapshot, null, 2), "utf8");
  fs.writeFileSync(latestFile, JSON.stringify(snapshot, null, 2), "utf8");
  fs.writeFileSync(dashboardMarkdown, renderMarkdown(snapshot), "utf8");

  return {
    dashboardMarkdown,
    latestFile,
    sessionFile,
  };
}

function saveNotes(projectRoot, content) {
  fs.writeFileSync(path.join(projectRoot, "notes.md"), content, "utf8");
}

function renderProcedureMarkdown(projectRoot, key, flow) {
  const title = key === "sessionStart" ? "Session Startup Procedure" : "Session Close Procedure";
  const command = key === "sessionStart" ? "/session start" : "/session close";
  const nodeById = new Map(flow.nodes.map(node => [node.id, node]));
  const steps = flow.nodes.map((node, index) => {
    const outgoing = flow.edges
      .filter(([from]) => from === node.id)
      .map(([, to]) => nodeById.get(to)?.label)
      .filter(Boolean)
      .join(", ");
    return `${index + 1}. ${node.label}
   - Detail: ${node.detail || "No detail"}
   - Type: ${node.actionType || "note"}
   - Value: ${node.actionValue || "None"}
   - Next: ${outgoing || "None"}`;
  }).join("\n");

  return `# ${title}

Project: ${path.basename(projectRoot)}
Command: ${command}
Updated: ${new Date().toISOString()}

Agents should follow this procedure when the user types \`${command}\`.

## Steps

${steps}

## Graph Data

<!-- PROJECT_DASHBOARD_PROCEDURE_START -->
\`\`\`json
${JSON.stringify({ key, flow }, null, 2)}
\`\`\`
<!-- PROJECT_DASHBOARD_PROCEDURE_END -->
`;
}

function saveProcedure(projectRoot, payload) {
  if (!payload || !["sessionStart", "sessionClose"].includes(payload.procedure)) {
    throw new Error("Procedure must be sessionStart or sessionClose.");
  }
  const flow = payload.flow;
  if (!flow || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    throw new Error("Procedure flow is invalid.");
  }

  const paths = procedurePaths(projectRoot);
  ensureDir(paths.dir);
  const store = readProcedureStore(projectRoot);
  store[payload.procedure] = {
    updatedAt: new Date().toISOString(),
    flow,
  };
  fs.writeFileSync(paths.json, JSON.stringify(store, null, 2), "utf8");
  const mdPath = payload.procedure === "sessionStart" ? paths.startup : paths.close;
  fs.writeFileSync(mdPath, renderProcedureMarkdown(projectRoot, payload.procedure, flow), "utf8");
  return { paths, mdPath };
}

function maybeRunCloseIntegrations(projectRoot) {
  const results = {
    codegraphSync: false,
    graphifyUpdate: false,
  };

  if (fs.existsSync(path.join(projectRoot, ".codegraph"))) {
    results.codegraphSync = runVisible("codegraph", ["sync"], projectRoot);
  }

  if (collectGraphify(projectRoot).configured) {
    results.graphifyUpdate = runVisible("graphify", ["update"], projectRoot);
  }

  return results;
}

function parseArgs(argv) {
  const [command = "snapshot", projectRootArg = process.cwd()] = argv;
  return {
    command,
    projectRoot: path.resolve(projectRootArg),
  };
}

function main() {
  const { command, projectRoot } = parseArgs(process.argv.slice(2));

  if (command === "start-app") {
    const appResult = startApp(projectRoot);
    const snapshot = collectSnapshot(projectRoot, "start-app");
    console.log(JSON.stringify({ ...appResult, command, snapshot }, null, 2));
    return;
  }

  if (command === "stop-app") {
    const appResult = stopApp(projectRoot);
    const snapshot = collectSnapshot(projectRoot, "stop-app");
    console.log(JSON.stringify({ ...appResult, command, snapshot }, null, 2));
    return;
  }

  if (command === "save-config") {
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    const config = writeDashboardConfig(payload);
    const firstProject = config.projects.find(project => fs.existsSync(project.path));
    const snapshot = collectSnapshot(firstProject?.path ?? projectRoot, "save-config");
    console.log(JSON.stringify({ ok: true, command, config, snapshot }, null, 2));
    return;
  }

  if (command === "save-notes") {
    const content = fs.readFileSync(0, "utf8");
    saveNotes(projectRoot, content);
    const snapshot = collectSnapshot(projectRoot, "save-notes");
    writeSnapshot(projectRoot, snapshot);
    console.log(JSON.stringify({ ok: true, snapshot }, null, 2));
    return;
  }

  if (command === "save-procedure") {
    const payload = JSON.parse(fs.readFileSync(0, "utf8"));
    const written = saveProcedure(projectRoot, payload);
    const snapshot = collectSnapshot(projectRoot, "save-procedure");
    writeSnapshot(projectRoot, snapshot);
    console.log(JSON.stringify({ ok: true, written, snapshot }, null, 2));
    return;
  }

  if (command === "session-close") {
    maybeRunCloseIntegrations(projectRoot);
  }

  const snapshot = collectSnapshot(projectRoot, command);
  const written = ["refresh", "session-start", "session-close"].includes(command)
    ? writeSnapshot(projectRoot, snapshot)
    : null;

  console.log(JSON.stringify({ ok: true, command, written, snapshot }, null, 2));

  if (command === "session-close" && !snapshot.git.clean) {
    process.exitCode = 2;
  }
}

main();
