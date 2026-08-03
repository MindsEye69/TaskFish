export interface GameModeTarget {
  pid: number;
  name: string;
}

const PROTECTED_PROCESS_NAMES = new Set([
  "csrss", "explorer", "lsass", "memory compression", "registry", "services",
  "smss", "svchost", "system", "taskfish", "node", "powershell", "pwsh", "wininit", "winlogon",
]);

function normalizeName(name: string) {
  return (name || "").trim().toLowerCase().replace(/\.exe$/i, "");
}

export function prepareGameModeTargets(targets: GameModeTarget[]) {
  const accepted: GameModeTarget[] = [];
  const seen = new Set<number>();
  let skipped = 0;

  for (const target of targets) {
    const pid = Number(target?.pid);
    const name = typeof target?.name === "string" ? target.name : "";
    if (!Number.isInteger(pid) || pid <= 0 || !name || seen.has(pid) || PROTECTED_PROCESS_NAMES.has(normalizeName(name))) {
      skipped += 1;
      continue;
    }
    seen.add(pid);
    accepted.push({ pid, name });
  }

  return { accepted, skipped };
}
