"use client";
import { useState, useMemo, useCallback, useEffect } from "react";
import type { AiSetupPhase, ProcessInfo, ProcessProfile, RuleConfig, EventFixResult, EventFixStep, EventFixChatMessage, PrivacyDataKey, PrivacyDiagnostics } from "@/lib/types";
import type { EventHealthReport, EventCluster, EventHealthAnalysis, EventHealthFinding } from "@/lib/eventLog";
import styles from "./SecurityCenter.module.css";

type AuditEvent = { id: string; ts: number; type: string; message: string; details?: unknown };
type LiveEventChannel = "System" | "Application" | "Security";
const LIVE_EVENT_CHANNELS: LiveEventChannel[] = ["System", "Application", "Security"];

interface Props {
  rules: Record<string, RuleConfig>;
  runningProcesses: ProcessInfo[];
  auditEvents?: AuditEvent[];
  onRemoveRule: (name: string) => void;
  onAnalyze: (name: string, pid: number) => void;
  profiles?: ProcessProfile[];
  activeProfileId?: string;
  onApplyProfile?: (profileId: string) => void;
  onSaveProfile?: (name: string) => void;
  aiAvailable?: boolean;
  aiSetupPhase?: AiSetupPhase;
  onRecordStatus?: (type: string, message: string, details?: unknown) => void;
  onEventHealthReport?: (report: EventHealthReport) => void;
}

function normalizeProcessName(name: string) {
  return (name || "").toLowerCase().replace(/\.exe$/i, "");
}

function isHandledByRule(rule?: RuleConfig) {
  return Boolean(rule?.manualControl || (rule?.action && rule.action !== "NONE"));
}

const HEALTH_LABELS: Record<string, string> = {
  good: "All Clear",
  watch: "Watch",
  attention: "Needs Attention",
  urgent: "Urgent",
};

const HEALTH_COLORS: Record<string, string> = {
  good: "#22c55e",
  watch: "#f59e0b",
  attention: "#f87171",
  urgent: "#ef4444",
};

const CATEGORY_LABELS: Record<string, string> = {
  "needs-attention": "Needs Attention",
  "watch": "Watch",
  "likely-noise": "Likely Noise",
};

const LEVEL_COLORS: Record<number, { bg: string; color: string }> = {
  1: { bg: "rgba(239,68,68,0.15)", color: "#ef4444" },
  2: { bg: "rgba(248,113,113,0.12)", color: "#f87171" },
  3: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
  4: { bg: "rgba(148,163,184,0.08)", color: "#94a3b8" },
  0: { bg: "rgba(148,163,184,0.08)", color: "#94a3b8" },
};

const EVENT_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  ban:         { bg: "rgba(248,113,113,0.12)", color: "#f87171", label: "BAN" },
  limited:     { bg: "rgba(245,158,11,0.12)",  color: "#f59e0b", label: "LIMITED" },
  rule:        { bg: "rgba(96,165,250,0.12)",   color: "#60a5fa", label: "RULE" },
  "auto-kill": { bg: "rgba(248,113,113,0.12)", color: "#f87171", label: "AUTO-KILL" },
  kill:        { bg: "rgba(248,113,113,0.12)", color: "#f87171", label: "KILL" },
  unknown:     { bg: "rgba(245,158,11,0.12)",  color: "#f59e0b", label: "UNKNOWN" },
  scan:        { bg: "rgba(34,197,94,0.12)",   color: "#22c55e", label: "SCAN" },
  "event-log": { bg: "rgba(96,165,250,0.12)",  color: "#60a5fa", label: "EVENT LOG" },
  privacy:     { bg: "rgba(20,184,166,0.12)",  color: "#2dd4bf", label: "PRIVACY" },
  "game-mode": { bg: "rgba(139,92,246,0.12)",  color: "#a78bfa", label: "GAME MODE" },
  safety:      { bg: "rgba(34,197,94,0.12)",   color: "#22c55e", label: "SAFETY" },
  priority:    { bg: "rgba(96,165,250,0.08)",  color: "#93c5fd", label: "PRIORITY" },
  profile:     { bg: "rgba(20,184,166,0.12)",  color: "#2dd4bf", label: "PROFILE" },
};

const COPYABLE_COMMAND_RE = /^(?:[|]\s*)?(Get-|Set-|Start-|Stop-|Restart-|Remove-|New-|Test-|Invoke-|Write-|Select-|Where-|Format-|Out-|sfc\b|dism\b|chkdsk\b|wevtutil\b|sc\s+\w|net\s+\w|reg\s+\w|powercfg\b|netsh\b|winver\b|powershell\b|bcdedit\b|icacls\b|shutdown\b|taskkill\b|tasklist\b|wmic\b|systeminfo\b|ipconfig\b|ping\b|tracert\b|Get-WinEvent\b|msiexec\b)/i;
const GUI_COMMAND_RE = /\b(open|navigate|go to|click|select(?!-)|settings\s*>|control panel|event viewer|windows update|device manager|task manager|start menu|component services|services\.msc|eventvwr|devmgmt|dcomcnfg|compmgmt\.msc|msconfig|msinfo32|mdsched|regedit|ms-settings:|shell:AppsFolder)\b/i;
const GUI_LAUNCH_CMD_RE = /\b(Start-Process|Invoke-Item|explorer(?:\.exe)?|cmd\s+\/c\s+start)\b.*\b(ms-settings:|eventvwr|devmgmt|services\.msc|dcomcnfg|compmgmt\.msc|msconfig|msinfo32|mdsched|regedit|control(?:\.exe)?\b|shell:AppsFolder)\b/i;
const GUI_EXECUTABLE_RE = /^(?:eventvwr(?:\.msc)?|devmgmt(?:\.msc)?|services\.msc|dcomcnfg|compmgmt\.msc|msconfig|msinfo32|mdsched|regedit|control(?:\.exe)?|explorer(?:\.exe)?)(?:\b|$)/i;

function isCopyableCommand(command: string) {
  return command
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .every(line => COPYABLE_COMMAND_RE.test(line) && !GUI_COMMAND_RE.test(line) && !GUI_LAUNCH_CMD_RE.test(line) && !GUI_EXECUTABLE_RE.test(line));
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFixPanel(
  fix: EventFixResult,
  chatKey: string,
  copiedCmd: string | null,
  onCopy: (cmd: string) => void,
  chatMessages: EventFixChatMessage[],
  chatInput: string,
  chatLoading: boolean,
  onChatInput: (value: string) => void,
  onChatSubmit: () => void,
) {
  return (
    <div className={styles.fixPanel}>
      <div className={styles.fixTitle}>{fix.title}</div>
      {fix.rootCauses.length > 0 && (
        <div className={styles.fixSection}>
          <div className={styles.fixSectionLabel}>Likely causes</div>
          <ul className={styles.fixCauseList}>
            {fix.rootCauses.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
      {fix.steps.length > 0 && (
        <div className={styles.fixSection}>
          <div className={styles.fixSectionLabel}>Fix steps</div>
          <ol className={styles.fixStepList}>
            {fix.steps.map((step: EventFixStep, i: number) => (
              <li key={i} className={`${styles.fixStep}${step.warning ? ` ${styles.fixStepRisky}` : ""}`}>
                <div className={styles.fixStepHeader}>
                  <span className={styles.fixStepLabel}>{step.label}</span>
                </div>
                <div className={styles.fixStepInstruction}>{step.instruction}</div>
                {step.command && isCopyableCommand(step.command) && (
                  <div className={styles.fixCmdBlock}>
                    <code className={styles.fixCmd}>{step.command}</code>
                    <button
                      type="button"
                      className={styles.fixCopyBtn}
                      onClick={() => onCopy(step.command!)}
                      title="Copy to clipboard"
                    >
                      {copiedCmd === step.command ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
                {step.warning && (
                  <div className={styles.fixStepWarning}>
                    ⚠ {step.warning}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {fix.escalation && <div className={styles.fixEscalation}>{fix.escalation}</div>}
      <div className={styles.fixChat}>
        <div className={styles.fixChatHeader}>
          <span>Repair assistant</span>
          <span>Tell it what happened after trying a step.</span>
        </div>
        {chatMessages.length > 0 && (
          <div className={styles.fixChatMessages}>
            {chatMessages.map((message, index) => (
              <div
                key={`${chatKey}-${index}`}
                className={`${styles.fixChatMessage} ${message.role === "user" ? styles.fixChatUser : styles.fixChatAssistant}`}
              >
                <span className={styles.fixChatRole}>{message.role === "user" ? "You" : "TaskFish"}</span>
                <span>{message.text}</span>
              </div>
            ))}
          </div>
        )}
        <div className={styles.fixChatComposer}>
          <input
            type="text"
            value={chatInput}
            className={styles.fixChatInput}
            placeholder="Example: That command failed in cmd.exe..."
            onChange={event => onChatInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                onChatSubmit();
              }
            }}
          />
          <button
            type="button"
            className={styles.fixChatSend}
            disabled={chatLoading || chatInput.trim().length === 0}
            onClick={onChatSubmit}
          >
            {chatLoading ? "Thinking..." : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SecurityCenter({
  rules,
  runningProcesses,
  auditEvents = [],
  onRemoveRule,
  onAnalyze,
  profiles = [],
  activeProfileId = "manual",
  onApplyProfile,
  onSaveProfile,
  aiAvailable = true,
  aiSetupPhase = "ready",
  onRecordStatus,
  onEventHealthReport,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAction, setFilterAction] = useState<"ALL" | "ALLOW" | "LIMITED" | "BAN">("ALL");
  const [profileName, setProfileName] = useState("");
  const [eventReport, setEventReport] = useState<EventHealthReport | null>(null);
  const [eventImportError, setEventImportError] = useState("");
  const [lastEventHealthError, setLastEventHealthError] = useState("");
  const [importingEvents, setImportingEvents] = useState(false);
  const [scanningLiveEvents, setScanningLiveEvents] = useState(false);
  const [liveEventChannels, setLiveEventChannels] = useState<LiveEventChannel[]>(["System", "Application"]);
  const [liveEventLimit, setLiveEventLimit] = useState(500);
  const [liveScanNotice, setLiveScanNotice] = useState("");
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["needs-attention", "watch"]));
  const [eventAnalysis, setEventAnalysis] = useState<EventHealthAnalysis | null>(null);
  const [analyzingEvents, setAnalyzingEvents] = useState(false);
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());
  const [fixResults, setFixResults] = useState<Record<string, EventFixResult>>({});
  const [loadingFixes, setLoadingFixes] = useState<Set<string>>(new Set());
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [clusterFindings, setClusterFindings] = useState<Record<string, EventHealthFinding>>({});
  const [analyzingClusters, setAnalyzingClusters] = useState<Set<string>>(new Set());
  const [fixChats, setFixChats] = useState<Record<string, EventFixChatMessage[]>>({});
  const [fixChatInputs, setFixChatInputs] = useState<Record<string, string>>({});
  const [chattingFixes, setChattingFixes] = useState<Set<string>>(new Set());
  const [privacyDiagnostics, setPrivacyDiagnostics] = useState<PrivacyDiagnostics | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacyClearBusy, setPrivacyClearBusy] = useState<PrivacyDataKey | null>(null);
  const [privacyNotice, setPrivacyNotice] = useState("");

  useEffect(() => {
    if (eventReport) onEventHealthReport?.(eventReport);
  }, [eventReport, onEventHealthReport]);

  const refreshPrivacyDiagnostics = useCallback(async () => {
    if (!window.electron?.getPrivacyDiagnostics) return;
    setPrivacyLoading(true);
    try {
      setPrivacyDiagnostics(await window.electron.getPrivacyDiagnostics());
    } finally {
      setPrivacyLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPrivacyDiagnostics().catch(() => {});
  }, [refreshPrivacyDiagnostics]);

  const handleClearPrivacyStore = useCallback(async (key: PrivacyDataKey) => {
    if (!window.electron?.clearPrivacyData || privacyClearBusy) return;
    setPrivacyClearBusy(key);
    setPrivacyNotice("");
    try {
      const result = await window.electron.clearPrivacyData([key]);
      if (result.ok) {
        const label = privacyDiagnostics?.stores.find(store => store.key === key)?.label ?? key;
        setPrivacyNotice(`${label} cleared.`);
        onRecordStatus?.("privacy", `Cleared ${label}`, { key });
      } else {
        setPrivacyNotice(result.errors.map(error => `${error.key}: ${error.error}`).join("; "));
      }
      await refreshPrivacyDiagnostics();
    } catch (error) {
      setPrivacyNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setPrivacyClearBusy(null);
    }
  }, [onRecordStatus, privacyClearBusy, privacyDiagnostics, refreshPrivacyDiagnostics]);

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  const toggleCluster = useCallback((key: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleFinding = useCallback((id: string) => {
    setExpandedFindings(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const recordEventHealthError = useCallback((message: string, details: unknown = {}) => {
    const exactMessage = message || "Unknown Event Health error";
    setEventImportError(exactMessage);
    setLastEventHealthError(exactMessage);
    onRecordStatus?.("event-log", `Event Health error: ${exactMessage}`, details);
  }, [onRecordStatus]);

  const resetEventHealthDetails = useCallback(() => {
    setEventImportError("");
    setLiveScanNotice("");
    setEventAnalysis(null);
    setClusterFindings({});
    setFixResults({});
    setFixChats({});
    setFixChatInputs({});
    setExpandedFindings(new Set());
  }, []);

  const handleImportEventLog = useCallback(async () => {
    if (!window.electron?.importEventLog) return;
    setImportingEvents(true);
    resetEventHealthDetails();
    try {
      const result = await window.electron.importEventLog();
      if (result.ok && result.report) {
        setEventReport(result.report);
        setShowResults(false);
      } else if (!result.canceled) {
        recordEventHealthError(result.error || "Event log import failed.", { phase: "import" });
      }
    } catch (err) {
      recordEventHealthError(err instanceof Error ? err.message : String(err), { phase: "import" });
    } finally {
      setImportingEvents(false);
    }
  }, [recordEventHealthError, resetEventHealthDetails]);

  const toggleLiveEventChannel = useCallback((channel: LiveEventChannel) => {
    setLiveEventChannels(prev => {
      const next = prev.includes(channel)
        ? prev.filter(item => item !== channel)
        : [...prev, channel];
      return next.length > 0 ? next : prev;
    });
  }, []);

  const handleScanLiveEvents = useCallback(async () => {
    if (!window.electron?.scanLiveEvents || scanningLiveEvents) return;
    setScanningLiveEvents(true);
    resetEventHealthDetails();
    try {
      const result = await window.electron.scanLiveEvents({
        channels: liveEventChannels,
        maxEventsPerChannel: liveEventLimit,
      });
      if (result.ok && result.report) {
        setEventReport(result.report);
        setShowResults(false);
        const skipped = (result.channelResults ?? []).filter(channel => !channel.ok);
        setLiveScanNotice(skipped.length > 0
          ? `Scanned available channels. Skipped ${skipped.map(channel => channel.channel).join(", ")}.`
          : `Scanned ${liveEventChannels.join(", ")} live event channels.`
        );
      } else {
        recordEventHealthError(result.error || "Live event scan failed.", {
          phase: "live-scan",
          channels: liveEventChannels,
        });
      }
    } catch (err) {
      recordEventHealthError(err instanceof Error ? err.message : String(err), {
        phase: "live-scan",
        channels: liveEventChannels,
      });
    } finally {
      setScanningLiveEvents(false);
    }
  }, [liveEventChannels, liveEventLimit, recordEventHealthError, resetEventHealthDetails, scanningLiveEvents]);

  const handleAnalyzeEvents = useCallback(async () => {
    if (!eventReport || analyzingEvents || !window.electron?.analyzeEventHealth) return;
    setAnalyzingEvents(true);
    try {
      const forceRefresh = Boolean(eventAnalysis);
      const data = await window.electron.analyzeEventHealth(eventReport, forceRefresh);
      if (!data.error) {
        setEventAnalysis(data);
      } else {
        recordEventHealthError(data.error, { phase: "analyze", fileName: eventReport.fileName });
      }
    } catch (err) {
      recordEventHealthError(err instanceof Error ? err.message : String(err), { phase: "analyze", fileName: eventReport.fileName });
    } finally {
      setAnalyzingEvents(false);
    }
  }, [eventReport, analyzingEvents, eventAnalysis, recordEventHealthError]);

  const handleGetFix = useCallback(async (finding: EventHealthFinding, cluster: EventCluster) => {
    if (!window.electron?.getEventFix) return;
    if (loadingFixes.has(finding.clusterId)) return;
    if (fixResults[finding.clusterId]) return; // already loaded

    setLoadingFixes(prev => new Set(prev).add(finding.clusterId));
    try {
      const result = await window.electron.getEventFix(finding, cluster);
      if (result.error) {
        recordEventHealthError(result.error, { phase: "fix", clusterId: finding.clusterId });
      }
      setFixResults(prev => ({ ...prev, [finding.clusterId]: result }));
    } catch (err) {
      recordEventHealthError(err instanceof Error ? err.message : String(err), { phase: "fix", clusterId: finding.clusterId });
      setFixResults(prev => ({
        ...prev,
        [finding.clusterId]: {
          title: `Fix: ${finding.clusterId}`,
          rootCauses: [],
          steps: finding.safeNextSteps.map((s, i) => ({ label: `Step ${i + 1}`, instruction: s })),
          escalation: "Contact a professional if the issue persists.",
        },
      }));
    } finally {
      setLoadingFixes(prev => { const n = new Set(prev); n.delete(finding.clusterId); return n; });
    }
  }, [loadingFixes, fixResults, recordEventHealthError]);

  const handleCopyCommand = useCallback((cmd: string) => {
    navigator.clipboard.writeText(cmd).catch(() => {});
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(c => c === cmd ? null : c), 2000);
  }, []);

  const handleSendFixChat = useCallback(async (finding: EventHealthFinding, cluster: EventCluster, fix: EventFixResult) => {
    if (!window.electron?.chatEventFix) return;
    const key = finding.clusterId;
    const userText = (fixChatInputs[key] ?? "").trim();
    if (!userText || chattingFixes.has(key)) return;

    const nextMessages: EventFixChatMessage[] = [
      ...(fixChats[key] ?? []),
      { role: "user" as const, text: userText },
    ].slice(-10);

    setFixChats(prev => ({ ...prev, [key]: nextMessages }));
    setFixChatInputs(prev => ({ ...prev, [key]: "" }));
    setChattingFixes(prev => new Set(prev).add(key));

    try {
      const result = await window.electron.chatEventFix(finding, cluster, fix, nextMessages);
      const assistantText = result.reply || "I could not generate a follow-up. Paste the exact error text and try again.";
      setFixChats(prev => ({
        ...prev,
        [key]: [...(prev[key] ?? nextMessages), { role: "assistant" as const, text: assistantText }].slice(-10),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Only surface to the error band if this is an unexpected failure (not a routine Ollama unavailability).
      const isConnectionError = /ECONNREFUSED|ECONNRESET|connect|offline/i.test(message);
      if (!isConnectionError) {
        recordEventHealthError(message, { phase: "fix-chat", clusterId: key });
      }
      setFixChats(prev => ({
        ...prev,
        [key]: [
          ...(prev[key] ?? nextMessages),
          { role: "assistant" as const, text: "I could not reach the local AI helper. If a PowerShell-style command failed in Command Prompt, try opening PowerShell as Administrator and paste the exact error here." },
        ].slice(-10),
      }));
    } finally {
      setChattingFixes(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  }, [chattingFixes, fixChatInputs, fixChats, recordEventHealthError]);

  const buildClusterFinding = useCallback((cluster: EventCluster): EventHealthFinding => {
    const isDcom = /distributedcom/i.test(cluster.provider) && (cluster.eventId === 10010 || cluster.eventId === 10016);
    const isNoise = cluster.category === "likely-noise";
    const severity: EventHealthFinding["severity"] =
      isDcom || isNoise ? "info" :
      cluster.level === 1 ? "critical" :
      cluster.level === 2 ? "warning" :
      "info";
    const confidence: EventHealthFinding["confidence"] =
      isDcom || isNoise ? "low" :
      cluster.level === 1 ? "high" :
      "medium";
    const key = `${cluster.provider}:${cluster.eventId}`;
    let safeNextSteps: string[];
    if (isDcom) {
      safeNextSteps = [
        "Ignore unless symptomatic; DistributedCOM 10010/10016 is usually harmless Windows background noise.",
        "If there are visible symptoms, correlate this timestamp with app crashes, service failures, or user-facing errors.",
        "Install Windows updates and reboot before considering app-specific repair.",
      ];
    } else if (isNoise) {
      safeNextSteps = ["No repair is needed unless this event lines up with a visible failure or repeated user-facing symptom."];
    } else if (key.includes("Service Control Manager")) {
      safeNextSteps = [
        "Check whether the named service recovered and is currently running.",
        "Review nearby Application log events for the same timestamp before changing service configuration.",
      ];
    } else if (key.includes("WindowsUpdateClient")) {
      safeNextSteps = [
        "Close any app named in the event details, then retry the update after a reboot.",
        "Use Settings > Windows Update or Microsoft Store to retry the update from the GUI.",
      ];
    } else if (key.includes("disk:") || key.includes("ntfs:")) {
      safeNextSteps = [
        "Back up important data before running disk repair steps.",
        "Run read-only disk health checks before attempting changes.",
      ];
    } else {
      safeNextSteps = [
        "Review the full event details and nearby events from the same timestamp.",
        "Confirm the issue is recurring or user-visible before changing system settings.",
      ];
    }

    return {
      clusterId: cluster.key,
      severity,
      confidence,
      explanation: cluster.summary,
      evidence: [
        `Provider: ${cluster.provider}`,
        `Event ID: ${cluster.eventId}`,
        `Occurred ${cluster.count} time${cluster.count !== 1 ? "s" : ""}`,
        ...(cluster.firstSeen ? [`First seen: ${new Date(cluster.firstSeen).toLocaleString()}`] : []),
        ...(cluster.sampleMessage ? [cluster.sampleMessage.split("\n")[0].slice(0, 120)] : []),
      ],
      safeNextSteps,
      whenToIgnore: isDcom
        ? "Ignore unless there are correlated app failures, crashes, service startup failures, or user-visible symptoms."
        : isNoise
          ? "If no visible application or system problems are present."
          : "If this is a one-time occurrence with no observable system impact.",
    };
  }, []);

  const handleAnalyzeCluster = useCallback(async (cluster: EventCluster) => {
    if (analyzingClusters.has(cluster.key)) return;
    const fallbackFinding = buildClusterFinding(cluster);
    if (!eventReport || !window.electron?.analyzeEventHealth || cluster.category === "likely-noise") {
      setClusterFindings(prev => ({ ...prev, [cluster.key]: fallbackFinding }));
      return;
    }

    setAnalyzingClusters(prev => new Set(prev).add(cluster.key));
    try {
      const singleClusterReport: EventHealthReport = {
        ...eventReport,
        totalEvents: cluster.count,
        criticalCount: cluster.level === 1 ? cluster.count : 0,
        errorCount: cluster.level === 2 ? cluster.count : 0,
        warningCount: cluster.level === 3 ? cluster.count : 0,
        overallHealth: cluster.category === "needs-attention" ? (cluster.level === 1 ? "urgent" : "attention") : "watch",
        clusters: [cluster],
        fileHash: eventReport.fileHash ? `${eventReport.fileHash}:${cluster.key}` : undefined,
      };
      const data = await window.electron.analyzeEventHealth(singleClusterReport, true);
      const finding = data.findings?.find(f => f.clusterId === cluster.key) ?? fallbackFinding;
      setClusterFindings(prev => ({ ...prev, [cluster.key]: finding }));
    } catch (err) {
      recordEventHealthError(err instanceof Error ? err.message : String(err), { phase: "cluster-analyze", clusterKey: cluster.key });
      setClusterFindings(prev => ({ ...prev, [cluster.key]: fallbackFinding }));
    } finally {
      setAnalyzingClusters(prev => { const n = new Set(prev); n.delete(cluster.key); return n; });
    }
  }, [analyzingClusters, buildClusterFinding, eventReport, recordEventHealthError]);

  const handleClusterAdvice = useCallback((cluster: EventCluster) => {
    const finding = clusterFindings[cluster.key] ?? buildClusterFinding(cluster);
    setClusterFindings(prev => prev[cluster.key] ? prev : { ...prev, [cluster.key]: finding });
    handleGetFix(finding, cluster);
  }, [buildClusterFinding, clusterFindings, handleGetFix]);

  const totalRules = Object.keys(rules).filter(name => rules[name].action !== "NONE").length;
  const bannedCount = Object.values(rules).filter(r => r.action === "BAN").length;
  const cautionRunning = runningProcesses.filter(p => {
    if (p.trust !== "unknown") return false;
    const ruleKey = normalizeProcessName(p.name);
    return !isHandledByRule(rules[ruleKey]);
  }).length;

  const ruleEntries = useMemo(() => {
    return Object.entries(rules)
      .filter(([, config]) => config.action !== "NONE")
      .map(([name, config]) => ({ name, ...config }));
  }, [rules]);

  const filteredRules = useMemo(() => {
    return ruleEntries.filter(r => {
      const matchesSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = filterAction === "ALL" || r.action === filterAction;
      return matchesSearch && matchesFilter;
    });
  }, [ruleEntries, searchQuery, filterAction]);

  const cautionProcesses = useMemo(() => {
    const seen = new Set<string>();
    return runningProcesses.filter(p => {
      if (p.trust !== "unknown") return false;
      const ruleKey = normalizeProcessName(p.name);
      if (isHandledByRule(rules[ruleKey])) return false;
      if (seen.has(ruleKey)) return false;
      seen.add(ruleKey);
      return true;
    });
  }, [runningProcesses, rules]);

  const activeProfile = profiles.find(profile => profile.id === activeProfileId);
  const aiSetupLabel =
    aiSetupPhase === "pulling" ? "Setting up AI" :
    aiSetupPhase === "starting" ? "Starting AI" :
    aiSetupPhase === "error" ? "AI retry needed" :
    "Analyze";
  const processAnalyzeDisabled = !aiAvailable;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Security & Safeguards Center</h1>
        <div className={styles.safeguardBanner}>
          <span className={styles.safeguardIcon}>!</span>
          <div className={styles.safeguardInfo}>
            <div className={styles.safeguardTitle}>System Safeguards Active</div>
            <div className={styles.safeguardText}>
              Core Windows system processes (e.g. <code>svchost.exe</code>, <code>explorer.exe</code>, <code>lsass.exe</code>) are automatically protected and locked from accidental banning.
            </div>
          </div>
        </div>
      </div>

      {/* Windows Event Health */}
      <div className={styles.eventHealthPane}>
        <div className={styles.paneHeader}>
          <div className={styles.eventHealthIntro}>
            <span className={styles.eventHealthKicker}>Windows Event Health</span>
            <span className={styles.eventHealthTitle}>Scan live Windows events or review a saved .evtx log</span>
            <span className={styles.eventHealthStatus}>
              {eventReport
                ? `${eventReport.fileName} loaded - ${eventReport.totalEvents.toLocaleString()} events clustered`
                : "Ready for live System/Application scanning or a saved Windows Event Viewer export."}
            </span>
            {eventReport && (
              <span
                className={styles.healthBadge}
                style={{ background: `${HEALTH_COLORS[eventReport.overallHealth]}22`, color: HEALTH_COLORS[eventReport.overallHealth], borderColor: `${HEALTH_COLORS[eventReport.overallHealth]}44` }}
              >
                {HEALTH_LABELS[eventReport.overallHealth]}
              </span>
            )}
          </div>
          <div className={styles.eventHealthActions}>
            {eventReport && (
              <button
                type="button"
                className={styles.analyzeBtn}
                disabled={analyzingEvents}
                onClick={handleAnalyzeEvents}
              >
                {analyzingEvents ? "Analyzing..." : eventAnalysis ? "Re-analyze" : "Analyze"}
              </button>
            )}
            <button
              type="button"
              className={styles.liveScanBtn}
              disabled={scanningLiveEvents || importingEvents}
              onClick={handleScanLiveEvents}
            >
              {scanningLiveEvents ? "Scanning..." : "Scan Live Events"}
            </button>
            <button
              type="button"
              className={styles.importBtn}
              disabled={importingEvents || scanningLiveEvents}
              onClick={handleImportEventLog}
            >
              {importingEvents ? "Importing..." : "Import .evtx"}
            </button>
          </div>
        </div>
        <div className={styles.liveEventOptions}>
          <div className={styles.channelToggles} aria-label="Live event channels">
            {LIVE_EVENT_CHANNELS.map(channel => (
              <label key={channel} className={styles.channelToggle}>
                <input
                  type="checkbox"
                  checked={liveEventChannels.includes(channel)}
                  onChange={() => toggleLiveEventChannel(channel)}
                  disabled={scanningLiveEvents}
                />
                <span>{channel}</span>
              </label>
            ))}
          </div>
          <label className={styles.eventLimitControl}>
            <span>Events per channel</span>
            <select
              value={liveEventLimit}
              onChange={event => setLiveEventLimit(Number(event.target.value))}
              disabled={scanningLiveEvents}
            >
              <option value={250}>250</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </label>
        </div>
        {eventImportError && <div className={styles.errorText}>{eventImportError}</div>}
        {liveScanNotice && <div className={styles.noticeText}>{liveScanNotice}</div>}
        {lastEventHealthError && lastEventHealthError !== eventImportError && (
          <div className={styles.persistentErrorText}>Last Event Health error: {lastEventHealthError}</div>
        )}

        {!eventReport ? (
          <div className={styles.emptyText}>
            Scan live channels or import a saved Windows Event Viewer .evtx file to see deterministic clusters and optional AI-enhanced health findings here.
          </div>
        ) : (
          <div className={styles.eventReportBody}>
            <div className={styles.eventMeta}>
              {eventReport.totalEvents.toLocaleString()} events - {eventReport.fileName}
              {eventReport.dateRange && (
                <> - {new Date(eventReport.dateRange.from).toLocaleDateString()} to {new Date(eventReport.dateRange.to).toLocaleDateString()}</>
              )}
              - {eventReport.clusters.length} unique finding{eventReport.clusters.length !== 1 ? "s" : ""}
            </div>
            <div className={styles.eventStats}>
              <span>Critical <strong>{eventReport.criticalCount.toLocaleString()}</strong></span>
              <span>Errors <strong>{eventReport.errorCount.toLocaleString()}</strong></span>
              <span>Warnings <strong>{eventReport.warningCount.toLocaleString()}</strong></span>
              <span>Needs attention <strong>{eventReport.clusters.filter(c => c.category === "needs-attention").length.toLocaleString()}</strong></span>
              <span>Likely noise <strong>{eventReport.clusters.filter(c => c.category === "likely-noise").length.toLocaleString()}</strong></span>
            </div>

            {eventReport.overallHealth === "good" && !showResults ? (
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: "4px 0" }}>
                <span style={{ flex: 1, fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", lineHeight: 1.5, minWidth: "200px" }}>
                  No critical or warning clusters detected. This log appears healthy.
                </span>
                <button
                  type="button"
                  className={styles.importBtn}
                  onClick={() => {
                    setShowResults(true);
                    setExpandedCategories(prev => new Set([...prev, "likely-noise"]));
                  }}
                >
                  Review Results
                </button>
              </div>
            ) : (
              <>
                {(["needs-attention", "watch", "likely-noise"] as const).map(cat => {
                  const catClusters: EventCluster[] = eventReport.clusters.filter(c => c.category === cat);
                  if (catClusters.length === 0) return null;
                  const isCatExpanded = expandedCategories.has(cat);
                  return (
                    <div key={cat} className={styles.categorySection}>
                      <div
                        className={`${styles.categoryHeader} ${styles[cat.replace("-", "")]}`}
                        onClick={() => toggleCategory(cat)}
                        style={{ cursor: "pointer", userSelect: "none" }}
                      >
                        <span>{CATEGORY_LABELS[cat]}</span>
                        <span className={styles.categoryCount}>{catClusters.length}</span>
                        <button
                          type="button"
                          className={styles.expandBtn}
                          onClick={e => { e.stopPropagation(); toggleCategory(cat); }}
                          aria-label={isCatExpanded ? "Collapse category" : "Expand category"}
                          style={{ marginLeft: "auto" }}
                        >
                          {isCatExpanded ? "−" : "+"}
                        </button>
                      </div>
                      {isCatExpanded && <div className={styles.clusterList}>
                        {catClusters.map(cluster => {
                          const lc = LEVEL_COLORS[cluster.level] ?? LEVEL_COLORS[4];
                          const isExpanded = expandedClusters.has(cluster.key);
                          const clusterFinding = clusterFindings[cluster.key];
                          const isAnalyzingCluster = analyzingClusters.has(cluster.key);
                          const isActionableCluster = cluster.category !== "likely-noise";
                          return (
                            <div key={cluster.key} className={styles.clusterRow}>
                              <button
                                type="button"
                                className={styles.clusterMain}
                                onClick={() => toggleCluster(cluster.key)}
                                aria-expanded={isExpanded}
                              >
                                <span className={styles.levelBadge} style={{ background: lc.bg, color: lc.color }}>
                                  {cluster.levelName}
                                </span>
                                <span className={styles.clusterProvider}>
                                  {cluster.provider.replace(/^Microsoft-Windows-/, "")} - {cluster.eventId}
                                </span>
                                <span className={styles.clusterCount}>&times;{cluster.count}</span>
                                <span className={styles.clusterSummary}>{cluster.summary}</span>
                                <span className={styles.expandPill} aria-hidden="true">
                                  {isExpanded ? "Collapse" : "Expand"}
                                  <svg
                                    className={`${styles.expandGlyph}${isExpanded ? ` ${styles.expandGlyphOpen}` : ""}`}
                                    viewBox="0 0 10 10"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    width="10"
                                    height="10"
                                  >
                                    <path d="M3 2l4 3-4 3" />
                                  </svg>
                                </span>
                              </button>
                              {isExpanded && (
                                <div className={styles.clusterDetails}>
                                  <div><span className={styles.detailLabel}>Provider:</span> {cluster.provider}</div>
                                  {cluster.firstSeen && (
                                    <div><span className={styles.detailLabel}>First seen:</span> {new Date(cluster.firstSeen).toLocaleString()}</div>
                                  )}
                                  {cluster.lastSeen && cluster.lastSeen !== cluster.firstSeen && (
                                    <div><span className={styles.detailLabel}>Last seen:</span> {new Date(cluster.lastSeen).toLocaleString()}</div>
                                  )}
                                  {cluster.sampleMessage && (
                                    <div className={styles.clusterMessage}>{cluster.sampleMessage.slice(0, 300)}</div>
                                  )}
                                  <div className={styles.findingActions}>
                                    <button
                                      type="button"
                                      className={styles.helpFixBtn}
                                      disabled={isAnalyzingCluster}
                                      onClick={() => handleAnalyzeCluster(cluster)}
                                    >
                                      {isAnalyzingCluster ? "Analyzing..." : isActionableCluster ? "Analyze this" : "Explain this"}
                                    </button>
                                    {isActionableCluster && !fixResults[cluster.key] && !loadingFixes.has(cluster.key) && (
                                      <button
                                        type="button"
                                        className={styles.helpFixBtn}
                                        onClick={() => handleClusterAdvice(cluster)}
                                      >
                                        Help me fix this
                                      </button>
                                    )}
                                    {!isActionableCluster && clusterFinding && !fixResults[cluster.key] && !loadingFixes.has(cluster.key) && (
                                      <button
                                        type="button"
                                        className={styles.secondaryFixBtn}
                                        onClick={() => handleClusterAdvice(cluster)}
                                      >
                                        Help me fix anyway
                                      </button>
                                    )}
                                  </div>
                                  {clusterFinding && (
                                    <div className={styles.clusterInsight}>
                                      <div className={styles.findingDetailTitle}>Cluster analysis</div>
                                      <div>{clusterFinding.explanation}</div>
                                      {clusterFinding.whenToIgnore && (
                                        <div className={styles.findingIgnore}>When to ignore: {clusterFinding.whenToIgnore}</div>
                                      )}
                                      {clusterFinding.evidence.length > 0 && (
                                        <ul className={styles.findingDetailList}>
                                          {clusterFinding.evidence.map((e, i) => <li key={i}>{e}</li>)}
                                        </ul>
                                      )}
                                    </div>
                                  )}
                                  {loadingFixes.has(cluster.key) && (
                                    <div className={styles.fixLoading}>
                                      <span className={styles.fixSpinner} />
                                      Generating advice...
                                    </div>
                                  )}
                                  {fixResults[cluster.key] && renderFixPanel(
                                    fixResults[cluster.key],
                                    cluster.key,
                                    copiedCmd,
                                    handleCopyCommand,
                                    fixChats[cluster.key] ?? [],
                                    fixChatInputs[cluster.key] ?? "",
                                    chattingFixes.has(cluster.key),
                                    value => setFixChatInputs(prev => ({ ...prev, [cluster.key]: value })),
                                    () => handleSendFixChat(clusterFinding ?? buildClusterFinding(cluster), cluster, fixResults[cluster.key]),
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>}
                    </div>
                  );
                })}
              </>
            )}

            {eventAnalysis && (
              <div className={styles.findingsSection}>
                <div className={styles.findingsHeader}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text)" }}>Health Findings</span>
                  <span className={styles.modelBadge}>
                    {eventAnalysis.offline
                      ? "Deterministic"
                      : `AI - ${eventAnalysis.model ?? "unknown"}`}
                  </span>
                </div>
                <p className={styles.findingSummary}>{eventAnalysis.summary}</p>
                {eventAnalysis.findings.length === 0 ? (
                  <div className={styles.emptyText}>No actionable findings identified.</div>
                ) : (
                  <div className={styles.findingList}>
                    {eventAnalysis.findings.map(finding => {
                      const isExpanded = expandedFindings.has(finding.clusterId);
                      const sevClass =
                        finding.severity === "critical" ? styles.severityCritical :
                        finding.severity === "warning" ? styles.severityWarning :
                        styles.severityInfo;
                      const cluster = eventReport.clusters.find(c => c.key === finding.clusterId);
                      const fix = fixResults[finding.clusterId];
                      const isLoadingFix = loadingFixes.has(finding.clusterId);
                      return (
                        <div key={finding.clusterId} className={styles.findingCard}>
                          <div
                            className={styles.findingMain}
                            onClick={() => toggleFinding(finding.clusterId)}
                            style={{ cursor: "pointer" }}
                          >
                            <span className={sevClass}>{finding.severity}</span>
                            <span className={styles.confText}>{finding.confidence} conf</span>
                            <span className={styles.findingId}>{finding.clusterId}</span>
                            <span className={styles.findingExplanation}>{finding.explanation}</span>
                            <button
                              type="button"
                              className={styles.expandBtn}
                              onClick={e => { e.stopPropagation(); toggleFinding(finding.clusterId); }}
                              aria-label={isExpanded ? "Collapse" : "Expand"}
                            >
                              {isExpanded ? "−" : "+"}
                            </button>
                          </div>
                          {isExpanded && (
                            <div className={styles.findingDetail}>
                              {finding.evidence.length > 0 && (
                                <div className={styles.findingDetailSection}>
                                  <div className={styles.findingDetailTitle}>Evidence</div>
                                  <ul className={styles.findingDetailList}>
                                    {finding.evidence.map((e, i) => <li key={i}>{e}</li>)}
                                  </ul>
                                </div>
                              )}
                              {finding.whenToIgnore && (
                                <div className={styles.findingIgnore}>
                                  When to ignore: {finding.whenToIgnore}
                                </div>
                              )}

                              {/* Fix panel */}
                              {!fix && !isLoadingFix && cluster && (
                                <div className={styles.findingActions}>
                                  <button
                                    type="button"
                                    className={styles.helpFixBtn}
                                    onClick={() => handleGetFix(finding, cluster)}
                                  >
                                    Help me fix this
                                  </button>
                                </div>
                              )}
                              {isLoadingFix && (
                                <div className={styles.fixLoading}>
                                  <span className={styles.fixSpinner} />
                                  Generating fix instructions...
                                </div>
                              )}
                              {fix && cluster && renderFixPanel(
                                fix,
                                finding.clusterId,
                                copiedCmd,
                                handleCopyCommand,
                                fixChats[finding.clusterId] ?? [],
                                fixChatInputs[finding.clusterId] ?? "",
                                chattingFixes.has(finding.clusterId),
                                value => setFixChatInputs(prev => ({ ...prev, [finding.clusterId]: value })),
                                () => handleSendFixChat(finding, cluster, fix),
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricVal}>{totalRules}</span>
          <span className={styles.metricLabel}>Total Custom Rules</span>
        </div>
        <div className={`${styles.metricCard} ${bannedCount > 0 ? styles.alertBan : ""}`}>
          <span className={styles.metricVal}>{bannedCount}</span>
          <span className={styles.metricLabel}>Blacklisted Programs</span>
        </div>
        <div className={`${styles.metricCard} ${cautionRunning > 0 ? styles.alertCaution : ""}`}>
          <span className={styles.metricVal}>{cautionRunning}</span>
          <span className={styles.metricLabel}>Unknown Running Processes</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricVal} style={{ color: auditEvents.length > 0 ? "var(--verified)" : undefined }}>
            {auditEvents.length}
          </span>
          <span className={styles.metricLabel}>Logged Events</span>
        </div>
      </div>

      <div className={styles.profilePane}>
        <div className={styles.profileInfo}>
          <span className={styles.paneTitle}>Process Profiles</span>
          <span className={styles.profileDescription}>
            {activeProfile ? activeProfile.description : "Manual rule editing is active."}
          </span>
        </div>
        <div className={styles.profileControls}>
          <select
            className={styles.profileSelect}
            value={activeProfileId}
            onChange={e => onApplyProfile?.(e.target.value)}
          >
            <option value="manual">Manual Rules</option>
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
          <input
            className={styles.profileNameInput}
            value={profileName}
            onChange={e => setProfileName(e.target.value)}
            placeholder="Save current rules as..."
          />
          <button
            type="button"
            className={styles.btnSaveProfile}
            disabled={!profileName.trim()}
            onClick={() => {
              const name = profileName.trim();
              if (!name) return;
              onSaveProfile?.(name);
              setProfileName("");
            }}
          >
            Save Profile
          </button>
        </div>
      </div>

      <div className={styles.privacyPane}>
        <div className={styles.paneHeader}>
          <div className={styles.privacyIntro}>
            <span className={styles.paneTitle}>Privacy & Diagnostics</span>
            <span className={styles.privacyPath}>{privacyDiagnostics?.userDataPath ?? "Desktop app diagnostics unavailable"}</span>
          </div>
          <button
            type="button"
            className={styles.importBtn}
            disabled={privacyLoading}
            onClick={() => refreshPrivacyDiagnostics().catch(() => {})}
          >
            {privacyLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {privacyDiagnostics && (
          <>
            <div className={styles.privacyAiPanel}>
              <div>
                <span className={styles.privacyLabel}>Local AI provider</span>
                <strong>{privacyDiagnostics.localAiProvider}</strong>
              </div>
              <div>
                <span className={styles.privacyLabel}>Readiness</span>
                <strong>{privacyDiagnostics.localAiStatus.phase}</strong>
              </div>
            </div>
            <div className={styles.privacyPayloads}>
              {privacyDiagnostics.localAiPayloads.map(payload => <span key={payload}>{payload}</span>)}
            </div>
            <div className={styles.privacyStoreGrid}>
              {privacyDiagnostics.stores.map(store => (
                <div key={store.key} className={styles.privacyStoreCard}>
                  <div className={styles.privacyStoreHeader}>
                    <span className={styles.privacyStoreTitle}>{store.label}</span>
                    <span className={styles.privacyStoreSize}>{formatBytes(store.sizeBytes)}</span>
                  </div>
                  <div className={styles.privacyStoreDesc}>{store.description}</div>
                  <div className={styles.privacyStorePath}>{store.path}</div>
                  <div className={styles.privacyStoreFooter}>
                    <span>{store.exists ? (store.modifiedAt ? `Updated ${new Date(store.modifiedAt).toLocaleString()}` : "Stored locally") : "No local file yet"}</span>
                    <button
                      type="button"
                      className={styles.privacyClearBtn}
                      disabled={!store.clearable || privacyClearBusy !== null}
                      onClick={() => handleClearPrivacyStore(store.key)}
                    >
                      {privacyClearBusy === store.key ? "Clearing..." : "Clear"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {privacyNotice && <div className={styles.noticeText}>{privacyNotice}</div>}
      </div>

      <div className={styles.layoutGrid}>
        <div className={styles.leftPane}>
          <div className={styles.paneHeader}>
            <span className={styles.paneTitle}>Custom Access Policies</span>
            <div className={styles.filters}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search rules..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <select
                className={styles.filterSelect}
                value={filterAction}
                onChange={e => setFilterAction(e.target.value as any)}
              >
                <option value="ALL">All Actions</option>
                <option value="ALLOW">ALLOW</option>
                <option value="LIMITED">LIMITED</option>
                <option value="BAN">BANNED</option>
              </select>
            </div>
          </div>

          <div className={styles.rulesTable}>
            <div className={styles.tableHeader}>
              <div className={styles.colName}>Process Name</div>
              <div className={styles.colAction}>Policy</div>
              <div className={styles.colTimer}>Auto-Cleanup</div>
              <div className={styles.colButtons}>Actions</div>
            </div>
            <div className={styles.tableBody}>
              {filteredRules.length === 0 ? (
                <div className={styles.emptyText}>No custom policies found. Banned apps will appear here once blacklisted.</div>
              ) : (
                filteredRules.map(rule => (
                  <div key={rule.name} className={styles.tableRow}>
                    <div className={styles.colName}>
                      <span className={styles.processName}>{rule.name}</span>
                    </div>
                    <div className={styles.colAction}>
                      <span className={`${styles.badge} ${styles[(rule.action || "NONE").toLowerCase()]}`}>
                        {rule.action || "NONE"}
                      </span>
                    </div>
                    <div className={styles.colTimer}>
                      {rule.autoKillMins ? `${rule.autoKillMins} mins` : "Disabled"}
                    </div>
                    <div className={styles.colButtons}>
                      <button
                        type="button"
                        className={styles.btnAnalyze}
                        disabled={processAnalyzeDisabled}
                        title={processAnalyzeDisabled ? aiSetupLabel : "Analyze process"}
                        onClick={() => {
                          if (processAnalyzeDisabled) return;
                          const proc = runningProcesses.find(p => p.name.toLowerCase() === rule.name.toLowerCase());
                          onAnalyze(rule.name, proc ? proc.id : 0);
                        }}
                      >
                        {processAnalyzeDisabled ? aiSetupLabel : "Analyze"}
                      </button>
                      <button
                        type="button"
                        className={styles.btnUnban}
                        onClick={() => onRemoveRule(rule.name)}
                      >
                        Remove Rule
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className={styles.rightPane}>
          <div className={styles.paneHeader}>
            <span className={styles.paneTitle}>Unknown / Caution Processes</span>
          </div>
          <div className={styles.cautionList}>
            {cautionProcesses.length === 0 ? (
              <div className={styles.emptyText}>No unknown processes currently running. Your system is fully vetted!</div>
            ) : (
              cautionProcesses.map(proc => (
                <div key={proc.id} className={styles.cautionItem}>
                  <div className={styles.cautionDetails}>
                    <span className={styles.cautionName}>{proc.name}</span>
                    <span className={styles.cautionInfo}>PID: {proc.id} | RAM: {proc.ramMB} MB</span>
                  </div>
                  <button
                    type="button"
                    className={styles.btnInspect}
                    disabled={processAnalyzeDisabled}
                    title={processAnalyzeDisabled ? aiSetupLabel : "Inspect and analyze process"}
                    onClick={() => onAnalyze(proc.name, proc.id)}
                  >
                    {processAnalyzeDisabled ? aiSetupLabel : "Inspect & Vett"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Activity Log */}
      <div className={styles.activityPane}>
        <div className={styles.paneHeader}>
          <span className={styles.paneTitle}>Recent Activity</span>
          <span className={styles.activityCount}>{auditEvents.length} event{auditEvents.length !== 1 ? "s" : ""}</span>
        </div>
        <div className={styles.activityList}>
          {auditEvents.length === 0 ? (
            <div className={styles.emptyText}>No events recorded this session.</div>
          ) : (
            auditEvents.map(event => {
              const meta = EVENT_COLORS[event.type] ?? { bg: "rgba(255,255,255,0.06)", color: "var(--text-muted)", label: event.type.toUpperCase() };
              return (
                <div key={event.id} className={styles.activityRow}>
                  <span className={styles.activityBadge} style={{ background: meta.bg, color: meta.color }}>
                    {meta.label}
                  </span>
                  <span className={styles.activityMsg}>{event.message}</span>
                  <span className={styles.activityTime}>
                    {new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}
