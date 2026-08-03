export type WatchdogMode = "off" | "training" | "guard";
export type WatchdogRuleAction = "allow" | "block";

export interface WatchdogRule {
  key: string;
  name: string;
  executablePath?: string;
  action: WatchdogRuleAction;
  updatedAt: number;
}

export interface WatchdogSettings {
  mode: WatchdogMode;
  rules: WatchdogRule[];
}

export interface WatchdogProcessEvent {
  id: string;
  pid: number;
  parentPid: number;
  name: string;
  parentName?: string;
  executablePath?: string;
  detectedAt: number;
  suspended: boolean;
  requiresDecision: boolean;
}

export const WATCHDOG_PROTECTED_PROCESS_NAMES = new Set([
  "csrss", "explorer", "lsass", "memory compression", "registry", "services",
  "smss", "svchost", "system", "taskfish", "wininit", "winlogon",
  "chatgpt", "csc", "cvtres", "gh", "node", "openconsole", "powershell", "pwsh",
  "taskkill", "tzutil", "windowsterminal",
]);

const WATCHDOG_PROTECTED_PARENT_NAMES = new Set(["chatgpt", "taskfish"]);

export function normalizeWatchdogName(name: string): string {
  return (name || "").trim().toLowerCase().replace(/\.exe$/i, "");
}

export function normalizeWatchdogPath(executablePath?: string): string {
  return (executablePath || "").trim().replace(/\//g, "\\").toLowerCase();
}

export function watchdogRuleKey(name: string, executablePath?: string): string {
  const normalizedPath = normalizeWatchdogPath(executablePath);
  return normalizedPath ? `path:${normalizedPath}` : `name:${normalizeWatchdogName(name)}`;
}

export function shouldRecordWatchdogTrainingObservation(
  observedKeys: ReadonlySet<string>,
  name: string,
  executablePath?: string,
): boolean {
  return !observedKeys.has(watchdogRuleKey(name, executablePath));
}

export function isWatchdogProtectedProcess(name: string): boolean {
  return WATCHDOG_PROTECTED_PROCESS_NAMES.has(normalizeWatchdogName(name));
}

export function isWatchdogProtectedParent(name: string): boolean {
  return WATCHDOG_PROTECTED_PARENT_NAMES.has(normalizeWatchdogName(name));
}

export function normalizeWatchdogSettings(raw: unknown): WatchdogSettings {
  const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const mode = data.mode === "training" || data.mode === "guard" ? data.mode : "off";
  const rawRules = Array.isArray(data.rules) ? data.rules : [];
  const rules = rawRules.flatMap((value): WatchdogRule[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const name = normalizeWatchdogName(String(item.name || ""));
    const action = item.action === "allow" || item.action === "block" ? item.action : null;
    if (!name || !action) return [];
    const executablePath = typeof item.executablePath === "string" && item.executablePath.trim()
      ? item.executablePath.trim()
      : undefined;
    return [{
      key: watchdogRuleKey(name, executablePath),
      name,
      executablePath,
      action,
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : Date.now(),
    }];
  });

  const deduped = new Map<string, WatchdogRule>();
  for (const rule of rules) deduped.set(rule.key, rule);
  return { mode, rules: [...deduped.values()] };
}

export function findWatchdogRule(
  settings: WatchdogSettings,
  name: string,
  executablePath?: string,
): WatchdogRule | undefined {
  const exactKey = watchdogRuleKey(name, executablePath);
  const exact = settings.rules.find(rule => rule.key === exactKey);
  if (exact) return exact;

  // A name-only rule is only created when Windows could not report a path.
  // It remains a fallback for the same degraded telemetry situation.
  if (!executablePath) {
    const nameKey = watchdogRuleKey(name);
    return settings.rules.find(rule => rule.key === nameKey);
  }
  return undefined;
}

export function decideWatchdogAction(input: {
  mode: WatchdogMode;
  name: string;
  trust: string;
  settings: WatchdogSettings;
  executablePath?: string;
}): "ignore" | "notify" | "suspend" | "block" {
  if (input.mode === "off" || !input.name || input.trust !== "unknown") return "ignore";
  if (isWatchdogProtectedProcess(input.name)) return "ignore";

  const rule = findWatchdogRule(input.settings, input.name, input.executablePath);
  if (rule?.action === "allow") return "ignore";
  if (rule?.action === "block") return "block";
  return input.mode === "guard" ? "suspend" : "notify";
}
