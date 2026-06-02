export interface EventLogEntry {
  id: number;
  level: number;
  levelName: string;
  timeCreated: string;
  provider: string;
  channel: string;
  computer: string;
  message: string;
}

export interface EventCluster {
  key: string;
  provider: string;
  eventId: number;
  level: number;
  levelName: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  sampleMessage: string;
  category: "needs-attention" | "watch" | "likely-noise";
  summary: string;
}

export interface EventHealthReport {
  totalEvents: number;
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  dateRange: { from: string; to: string } | null;
  overallHealth: "good" | "watch" | "attention" | "urgent";
  clusters: EventCluster[];
  importedAt: number;
  fileName: string;
}

const KNOWN_EVENTS: Record<string, string> = {
  "Kernel-Power:41": "Unexpected system restart - possible power loss or crash",
  "Microsoft-Windows-Kernel-General:6008": "Previous unexpected shutdown detected",
  "Service Control Manager:7034": "Service crashed unexpectedly",
  "Service Control Manager:7023": "Service terminated with an error",
  "Service Control Manager:7031": "Service terminated unexpectedly, restart pending",
  "Microsoft-Windows-WindowsUpdateClient:20": "Windows Update installation error",
  "Microsoft-Windows-WindowsUpdateClient:19": "Windows Update installed successfully",
  "Application Error:1000": "Application crash (fault bucket created)",
  "Application Hang:1002": "Application stopped responding",
  "Windows Error Reporting:1001": "Fault bucket created - crash report queued",
  "Microsoft-Windows-Security-Auditing:4625": "Failed account login attempt",
  "Microsoft-Windows-Security-Auditing:4740": "User account locked out",
  "Microsoft-Windows-Security-Auditing:1102": "Security audit log was cleared",
  "Microsoft-Windows-Security-Auditing:4719": "System audit policy changed",
  "Microsoft-Windows-Security-Auditing:4624": "Successful account login",
  "Microsoft-Windows-Security-Auditing:4648": "Login attempt using explicit credentials",
  "Microsoft-Windows-Security-Auditing:4720": "New user account created",
  "Microsoft-Windows-Security-Auditing:4728": "Member added to security-enabled global group",
  "Microsoft-Windows-Security-Auditing:4732": "Member added to security-enabled local group",
  "Microsoft-Windows-Bits-Client:16403": "BITS background download error",
  "Microsoft-Windows-DistributedCOM:10016": "DCOM permission denied (usually benign configuration noise)",
  "Microsoft-Windows-DistributedCOM:10010": "DCOM server unavailable or not registered",
  "Microsoft-Windows-Kernel-PnP:219": "Driver failed to load or initialize",
  "Microsoft-Windows-Kernel-PnP:411": "Driver could not be loaded",
  "disk:11": "Disk controller reported a read/write error",
  "disk:153": "Reset to device issued - possible drive issue",
  "ntfs:55": "NTFS file system corruption detected",
  "Microsoft-Windows-EventLog:104": "Event log was cleared",
  "Microsoft-Windows-EventLog:6013": "System uptime log entry",
  "Microsoft-Windows-Diagnostics-Performance:100": "Boot performance degradation",
  "Microsoft-Windows-Diagnostics-Performance:200": "App startup performance degradation",
};

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function firstMatch(block: string, pattern: RegExp): string {
  const match = block.match(pattern);
  return match ? decodeXml(match[1].trim()) : "";
}

function extractMessage(block: string): string {
  const renderedMessage = firstMatch(block, /<Message>([\s\S]*?)<\/Message>/);
  if (renderedMessage) return renderedMessage;

  const data: string[] = [];
  for (const match of block.matchAll(/<Data(?:\s+Name=['"]([^'"]+)['"])?>([\s\S]*?)<\/Data>/g)) {
    const name = match[1] ? `${decodeXml(match[1])}: ` : "";
    const value = decodeXml(match[2].trim());
    if (value) data.push(`${name}${value}`);
  }
  if (data.length > 0) return data.slice(0, 8).join("\n");

  const userData = firstMatch(block, /<UserData>([\s\S]*?)<\/UserData>/);
  if (!userData) return "";
  return userData
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levelDisplayName(level: number): string {
  switch (level) {
    case 1: return "Critical";
    case 2: return "Error";
    case 3: return "Warning";
    case 4: return "Information";
    case 0: return "LogAlways";
    default: return "Unknown";
  }
}

export function parseWevtutilXml(xml: string): EventLogEntry[] {
  const entries: EventLogEntry[] = [];
  const blocks = xml.match(/<Event\b[\s\S]*?<\/Event>/g) ?? [];

  for (const block of blocks) {
    const idMatch = block.match(/<EventID(?:\s[^>]*)?>(\d+)<\/EventID>/);
    if (!idMatch) continue;

    const levelMatch = block.match(/<Level>(\d+)<\/Level>/);
    const level = levelMatch ? parseInt(levelMatch[1], 10) : 4;

    entries.push({
      id: parseInt(idMatch[1], 10),
      level,
      levelName: levelDisplayName(level),
      timeCreated: firstMatch(block, /SystemTime=['"]([^'"]+)['"]/),
      provider: firstMatch(block, /Provider\s+Name=['"]([^'"]+)['"]/) || "Unknown",
      channel: firstMatch(block, /<Channel>([\s\S]*?)<\/Channel>/),
      computer: firstMatch(block, /<Computer>([\s\S]*?)<\/Computer>/),
      message: extractMessage(block),
    });
  }

  return entries;
}

export function clusterEvents(entries: EventLogEntry[], fileName: string): EventHealthReport {
  const criticalCount = entries.filter(e => e.level === 1).length;
  const errorCount = entries.filter(e => e.level === 2).length;
  const warningCount = entries.filter(e => e.level === 3).length;

  if (entries.length === 0) {
    return {
      totalEvents: 0,
      criticalCount,
      errorCount,
      warningCount,
      dateRange: null,
      overallHealth: "good",
      clusters: [],
      importedAt: Date.now(),
      fileName,
    };
  }

  type ClusterAcc = {
    provider: string;
    eventId: number;
    level: number;
    levelName: string;
    times: string[];
    sampleMessage: string;
  };
  const map = new Map<string, ClusterAcc>();

  for (const e of entries) {
    const key = `${e.provider}:${e.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.times.push(e.timeCreated);
      if (!existing.sampleMessage && e.message) existing.sampleMessage = e.message;
      if (e.level > 0 && e.level < existing.level) {
        existing.level = e.level;
        existing.levelName = e.levelName;
      }
    } else {
      map.set(key, {
        provider: e.provider,
        eventId: e.id,
        level: e.level,
        levelName: e.levelName,
        times: [e.timeCreated],
        sampleMessage: e.message,
      });
    }
  }

  const allTimes = entries.map(e => e.timeCreated).filter(Boolean).sort();
  const dateRange = allTimes.length > 0 ? { from: allTimes[0], to: allTimes[allTimes.length - 1] } : null;
  const clusters: EventCluster[] = [];

  for (const [key, data] of map) {
    const sortedTimes = data.times.filter(Boolean).sort();
    const count = data.times.length;
    const level = data.level;

    let category: EventCluster["category"];
    if (level === 1) category = "needs-attention";
    else if (level === 2) category = count >= 5 ? "needs-attention" : "watch";
    else if (level === 3) category = count >= 20 ? "watch" : "likely-noise";
    else category = "likely-noise";

    const lookupKey = `${data.provider}:${data.eventId}`;
    const summary = KNOWN_EVENTS[lookupKey]
      ?? (data.sampleMessage ? data.sampleMessage.split("\n")[0].slice(0, 120) : `Event ${data.eventId} from ${data.provider}`);

    clusters.push({
      key,
      provider: data.provider,
      eventId: data.eventId,
      level,
      levelName: data.levelName,
      count,
      firstSeen: sortedTimes[0] ?? "",
      lastSeen: sortedTimes[sortedTimes.length - 1] ?? "",
      sampleMessage: data.sampleMessage,
      category,
      summary,
    });
  }

  clusters.sort((a, b) => {
    const order: Record<EventCluster["category"], number> = {
      "needs-attention": 0,
      watch: 1,
      "likely-noise": 2,
    };
    return (order[a.category] - order[b.category]) || b.count - a.count;
  });

  const hasUrgent = clusters.some(c => c.category === "needs-attention" && c.level === 1);
  const hasAttention = clusters.some(c => c.category === "needs-attention");
  const hasWatch = clusters.some(c => c.category === "watch");
  const overallHealth: EventHealthReport["overallHealth"] =
    hasUrgent ? "urgent" : hasAttention ? "attention" : hasWatch ? "watch" : "good";

  return {
    totalEvents: entries.length,
    criticalCount,
    errorCount,
    warningCount,
    dateRange,
    overallHealth,
    clusters,
    importedAt: Date.now(),
    fileName,
  };
}
