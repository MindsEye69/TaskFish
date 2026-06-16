export interface RawProcessTelemetry {
  executablePath?: string;
  parentName?: string;
  parentPid?: number | string | null;
  commandLine?: string;
  fileDescription?: string;
  companyName?: string;
  signatureStatus?: string;
  signerSubject?: string;
  dllNames?: string[];
  tcpConnections?: Array<{
    RemoteAddress?: string;
    RemotePort?: number | string;
    State?: string;
  }>;
}

const SECRET_RE =
  /\b(api[_-]?key|token|bearer|secret|password|passwd|pwd|connectionstring|private[_-]?key|aws_access_key_id|azure_client_secret)\b|BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY|:\/\/[^/\s:@]+:[^/\s:@]+@/i;

export function escapeCimFilterLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

export function containsSecretLikeValue(value: unknown): boolean {
  return typeof value === "string" && SECRET_RE.test(value);
}

export function redactUserPath(value: string): string {
  return value
    .replace(/C:\\Users\\[^\\\r\n]+\\Desktop\\[^\\\r\n]+/gi, "%USERPROFILE%\\Desktop\\*")
    .replace(/C:\\Users\\[^\\\r\n]+\\Documents\\[^\\\r\n]+/gi, "%USERPROFILE%\\Documents\\*")
    .replace(/C:\\Users\\[^\\\r\n]+\\Downloads\\[^\\\r\n]+/gi, "%USERPROFILE%\\Downloads\\*")
    .replace(/C:\\Users\\[^\\\r\n]+\\OneDrive(?: - [^\\\r\n]+)?\\[^\\\r\n]+/gi, "%USERPROFILE%\\OneDrive\\*")
    .replace(/C:\\Users\\[^\\\r\n]+\\AppData\\Local\\Temp\\?/gi, "%TEMP%\\")
    .replace(/C:\\Users\\[^\\\r\n]+\\AppData\\Roaming\\?/gi, "%APPDATA%\\")
    .replace(/C:\\Users\\[^\\\r\n]+\\AppData\\Local\\?/gi, "%LOCALAPPDATA%\\")
    .replace(/C:\\Users\\[^\\\r\n]+\\?/gi, "%USERPROFILE%\\");
}

export function classifyPath(value: string): string {
  const lower = value.toLowerCase();
  if (!value) return "unknown";
  if (lower.startsWith("c:\\windows\\")) return "windows-system";
  if (lower.startsWith("c:\\program files\\") || lower.startsWith("c:\\program files (x86)\\")) {
    return "program-files";
  }
  if (lower.includes("\\appdata\\local\\temp\\")) return "user-temp";
  if (lower.startsWith("c:\\users\\")) return "user-profile";
  return "other-local-path";
}

export function commandLineSummary(commandLine?: string): string {
  if (!commandLine || commandLine === "Unknown") return "unknown";
  if (containsSecretLikeValue(commandLine)) return "withheld: secret-like value detected";
  return "withheld: command line privacy class";
}

function classifyAddress(address: string): string {
  if (!address || address === "*" || address === "0.0.0.0" || address === "::") return "listener";
  if (address === "127.0.0.1" || address === "::1" || /^localhost$/i.test(address)) return "loopback";
  if (
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
    /^fe80:/i.test(address) ||
    /^fc/i.test(address) ||
    /^fd/i.test(address)
  ) {
    return "private-ip";
  }
  return "public-ip";
}

export function summarizeTcpConnection(conn: NonNullable<RawProcessTelemetry["tcpConnections"]>[number]): string {
  const port = conn.RemotePort ?? "unknown";
  const state = conn.State ? ` (${conn.State})` : "";
  return `${classifyAddress(String(conn.RemoteAddress ?? ""))}:${port}${state}`;
}

export function buildPrivacySafeProcessTelemetry(raw: RawProcessTelemetry): string {
  const lines: string[] = [];
  const execPath = raw.executablePath || "";
  const redactedExecPath = execPath ? redactUserPath(execPath) : "unknown";
  lines.push(`Executable Location Class: ${classifyPath(execPath)}`);
  lines.push(`Executable Path Redacted: ${redactedExecPath}`);
  lines.push(`Parent Process: ${raw.parentName || "Unknown"} (PID: ${raw.parentPid || "Unknown"})`);
  lines.push(`Command Line: ${commandLineSummary(raw.commandLine)}`);

  if (raw.fileDescription || raw.companyName || raw.signatureStatus || raw.signerSubject) {
    lines.push(`File Description: ${raw.fileDescription || "Unknown"}`);
    lines.push(`Company Name: ${raw.companyName || "Unknown"}`);
    lines.push(`Digital Signature Status: ${raw.signatureStatus || "Unsigned"}`);
    lines.push(`Signer Subject: ${raw.signerSubject || "Unsigned"}`);
  }

  const dllNames = (raw.dllNames || [])
    .filter(Boolean)
    .slice(0, 25)
    .map(name => containsSecretLikeValue(name) ? "<secret:redacted>" : name);
  lines.push(`Loaded DLL Names: ${dllNames.length > 0 ? dllNames.join(", ") : "None"}`);

  const network = (raw.tcpConnections || []).slice(0, 25).map(summarizeTcpConnection);
  lines.push(`Network Connections Summary: ${network.length > 0 ? network.join(", ") : "None"}`);
  return lines.join("\n");
}

