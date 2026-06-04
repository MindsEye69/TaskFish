export interface EventFixStepLike {
  instruction: string;
  command?: string;
}

export const INVALID_CMDLET_RE = /\b(Get-DCOMPermission|Set-DCOMPermission|Get-COMRegistration|Set-ComObjectSecurity|Repair-ComRegistration|Set-DCOMConfig|Get-DCOMConfig|dcomedit|comregedit|Set-DCOMAccessPermission)\b/i;
export const FORBIDDEN_FIX_RE = /\b(dcomcnfg|component services|dcom\s+(appid|app id|acl|permission|permissions)|net\s+localgroup|diskpart|format)\b/i;

const REGISTRY_FIX_RE = /\b(registry|regedit|HKLM|HKCU|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|reg\s+(add|delete)|Set-ItemProperty|Remove-ItemProperty)\b/i;
const FIREWALL_FIX_RE = /\b(firewall|netsh\s+advfirewall|Set-NetFirewallRule|New-NetFirewallRule)\b/i;
const DESTRUCTIVE_FIX_RE = /\b(chkdsk\s+.*\/[fr]|delete|remove|reset|reinstall Windows)\b/i;

const REAL_TERMINAL_CMD_RE = /^(?:[|]\s*)?(Get-|Set-|Start-|Stop-|Restart-|Remove-|New-|Test-|Invoke-|Write-|Select-|Where-|Format-|Out-|sfc\b|dism\b|chkdsk\b|wevtutil\b|sc\s+\w|net\s+\w|reg\s+\w|powercfg\b|netsh\b|winver\b|powershell\b|bcdedit\b|icacls\b|shutdown\b|taskkill\b|tasklist\b|wmic\b|systeminfo\b|ipconfig\b|ping\b|tracert\b|Get-WinEvent\b|msiexec\b)/i;
const GUI_OR_NAV_RE = /\b(open|navigate|go to|click|select(?!-)|settings\s*>|control panel|event viewer|windows update|device manager|task manager|start menu|component services|services\.msc|devmgmt|msconfig|msinfo32|mdsched|regedit|ms-settings:|shell:AppsFolder)\b/i;
const GUI_LAUNCH_CMD_RE = /\b(Start-Process|Invoke-Item|explorer(?:\.exe)?|cmd\s+\/c\s+start)\b.*\b(ms-settings:|eventvwr|devmgmt|services\.msc|msconfig|msinfo32|mdsched|regedit|control(?:\.exe)?\b|shell:AppsFolder)\b/i;
const GUI_EXECUTABLE_RE = /^(?:eventvwr|devmgmt|services\.msc|msconfig|msinfo32|mdsched|regedit|control(?:\.exe)?)(?:\b|$)/i;

export function normalizeCommandLine(line: string): string {
  return line
    .replace(/[“”„‟]/g, "\"")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/^```(?:powershell|ps1|cmd|bat)?/i, "")
    .replace(/```$/i, "")
    .replace(/^PS\s+[^>]+>\s*/i, "")
    .replace(/^[$>]\s*/, "")
    .replace(/^(?:run|execute|type|command)\s*:?\s+/i, "")
    .replace(/\s+(?:#|\/\/|::|REM\b).*$/i, "")
    .trim()
    .replace(/^(["'`])(.+)\1$/g, "$2")
    .replace(/,\s+(?:then|and|or|but|you|when|if|once|after|please|note|making|ensuring|so)\b.*/i, "")
    .trim()
    .replace(/[.;:]+$/g, "");
}

export function isCopyableTerminalCommand(line: string): boolean {
  const normalized = normalizeCommandLine(line);
  return Boolean(
    normalized &&
    REAL_TERMINAL_CMD_RE.test(normalized) &&
    !GUI_OR_NAV_RE.test(normalized) &&
    !GUI_LAUNCH_CMD_RE.test(normalized) &&
    !GUI_EXECUTABLE_RE.test(normalized)
  );
}

export function cleanCommand(cmd: string): string | undefined {
  const lines = cmd
    .split(/\r?\n/)
    .map(normalizeCommandLine)
    .filter(line => line && !/^(#|REM\b|::)/i.test(line));
  if (lines.length === 0) return undefined;
  if (lines.some(line => !isCopyableTerminalCommand(line))) return undefined;
  return lines.join("\n");
}

export function commandAsInstruction(cmd: string): string {
  return cmd
    .split(/\r?\n/)
    .map(normalizeCommandLine)
    .filter(line => line && !isCopyableTerminalCommand(line))
    .join(" ")
    .slice(0, 300);
}

export function isRiskyCmd(cmd: string): string {
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

export function warningForStep(step: EventFixStepLike): string {
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

export function removedUnsafeStep(isDcom: boolean): EventFixStepLike & { label: string; warning: string } {
  return {
    label: "Unsafe step removed",
    instruction: isDcom
      ? "A DCOMCNFG, Component Services, registry permission, or unsupported command suggestion was removed. DistributedCOM 10010/10016 findings should not be repaired with DCOM permission edits unless a documented Microsoft support procedure matches a real symptom."
      : "An unsupported or unsafe repair suggestion was removed. Use documented vendor or Microsoft guidance before attempting registry, permission, local group, disk partition, or formatting changes.",
    warning: "Do not run the removed advice without a verified backup, administrator approval, and trusted vendor documentation.",
  };
}
