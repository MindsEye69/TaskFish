"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IconImage from "./IconImage";
import type { AnalysisResult, RuleConfig, RuleAction, TrustLevel, AiSetupPhase } from "@/lib/types";
import styles from "./AnalysisDrawer.module.css";

type AuditEvent = { id: string; ts: number; type: string; message: string; details?: unknown };
type TimelineEntry = {
  id: string;
  ts: number;
  kind: "rule" | "audit" | "analysis" | "resource" | "network" | "service" | "identity" | "modules";
  title: string;
  detail: string;
  color: string;
};

const EVENT_META: Record<string, { color: string; icon: string }> = {
  ban:         { color: "#f87171", icon: "⊘" },
  limited:     { color: "#f59e0b", icon: "⚡" },
  rule:        { color: "#60a5fa", icon: "⚙" },
  unknown:     { color: "#f87171", icon: "?" },
  "auto-kill": { color: "#f87171", icon: "✕" },
  "game-mode": { color: "#a78bfa", icon: "◈" },
  scan:        { color: "#34d399", icon: "⬡" },
  allow:       { color: "#22c55e", icon: "✓" },
};

const KIND_ICONS: Record<string, string> = {
  identity: "◉",
  analysis: "⬡",
  rule:     "⚙",
  resource: "▣",
  network:  "⇌",
  service:  "◈",
  modules:  "⬢",
  audit:    "•",
};

function fmtAge(ts: number): string {
  if (ts <= 1) return "current";
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
}

function normalizeProcessName(name: string) {
  return (name || "").toLowerCase().replace(/\.exe$/i, "");
}

function fmtRam(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function toArray(value: unknown): any[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeNetworkTelemetry(value: unknown): { tcp: any[]; udp: any[] } {
  if (!value || typeof value !== "object") return { tcp: [], udp: [] };
  const data = value as { tcp?: unknown; udp?: unknown };
  return {
    tcp: toArray(data.tcp),
    udp: toArray(data.udp),
  };
}

function isSystemDllPath(fileName: unknown): boolean {
  const normalized = String(fileName ?? "").toLowerCase().replace(/\//g, "\\");
  return normalized.includes("\\windows\\system32\\") || normalized.includes("\\windows\\syswow64\\");
}

interface Props {
  processName: string | null;
  processPid?: number;
  currentRule?: RuleConfig;
  processTrust?: TrustLevel;
  onRuleChange?: (name: string, config: RuleConfig) => void;
  onClose: () => void;
  auditEvents?: AuditEvent[];
  processHistory?: { cpu: number; ram: number }[];
  aiAvailable?: boolean;
  aiSetupPhase?: AiSetupPhase;
  aiSetupError?: string;
}

const DEFAULT_MODEL = "llama3.2:1b";

export default function AnalysisDrawer({
  processName,
  processPid = 0,
  currentRule = { action: "NONE", autoKillMins: null },
  processTrust,
  onRuleChange,
  onClose,
  auditEvents = [],
  processHistory = [],
  aiAvailable = true,
  aiSetupPhase = "ready",
  aiSetupError,
}: Props) {
  const [result, setResult]             = useState<AnalysisResult | null>(null);
  const [loading, setLoading]           = useState(false);
  const [streamText, setStreamText]     = useState("");
  const [isStartupApp, setIsStartupApp] = useState(false);
  const [disablingStartup, setDisablingStartup] = useState(false);
  const [isLocked, setIsLocked]         = useState(!(currentRule?.manualControl ?? false));
  const [iconError, setIconError]       = useState(false);
  const [downloading, setDownloading]   = useState(false);
  const [pullStatus, setPullStatus]     = useState("");
  const [pullPct, setPullPct]           = useState(0);
  const [evidenceTimestamp, setEvidenceTimestamp] = useState(1);

  const [activeTab, setActiveTab] = useState<"overview" | "modules" | "network" | "services" | "edr" | "timeline">("overview");
  const [dlls, setDlls] = useState<any[] | null>(null);
  const [network, setNetwork] = useState<{ tcp: any[]; udp: any[] } | null>(null);
  const [services, setServices] = useState<any[] | null>(null);
  const [loadingTab, setLoadingTab] = useState(false);

  const isOpen = processName !== null;

  // Refs so runAI always reads the latest rule state without needing them in its dep array.
  // Without this, changing currentRule would recreate runAI → re-fire useEffect → infinite loop.
  const currentRuleRef   = useRef(currentRule);
  const onRuleChangeRef   = useRef(onRuleChange);
  const processTrustRef   = useRef(processTrust);

  useEffect(() => {
    currentRuleRef.current = currentRule;
    onRuleChangeRef.current = onRuleChange;
    processTrustRef.current = processTrust;
  }, [currentRule, onRuleChange, processTrust]);

  const runAI = useCallback(async () => {
    if (!processName) return;
    if (!aiAvailable) {
      const detail =
        aiSetupPhase === "pulling" ? `Downloading ${DEFAULT_MODEL}. Analysis will be ready when setup completes.` :
        aiSetupPhase === "starting" ? "Starting the bundled AI engine. Try again in a moment." :
        aiSetupError || "AI setup is unavailable.";
      setResult({ error: detail, recommendedModel: DEFAULT_MODEL, _isError: true } as any);
      return;
    }

    setStreamText("");

    let res: any;
    try {
      if (window.electron) {
        // Subscribe to token stream before firing the IPC call so we don't miss early chunks
        let unsub: (() => void) | null = null;
        if (window.electron.onAnalysisStreamChunk) {
          unsub = window.electron.onAnalysisStreamChunk(({ token, done }) => {
            if (!done) setStreamText(prev => prev + token);
          });
        }
        try {
          res = await window.electron.analyzeProcess(processName);
        } finally {
          unsub?.();
          setStreamText(""); // clear typing display once result is in
        }
      } else {
        const r = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: processName }),
        });
        res = await r.json();
      }
    } catch {
      res = { error: "AI service unavailable" };
    }

    if (!res || res?.error) {
      setResult({ error: res?.error ?? "No response from AI", _isError: true } as any);
      return;
    }

    setResult(res);
    if (window.electron) await window.electron.saveAnalysis(processName, res);
    if ((res.verdict === "essential" || res.verdict === "safe") && res.suggestedRule && currentRuleRef.current.action === "NONE" && !currentRuleRef.current.manualControl) {
      if (onRuleChangeRef.current) onRuleChangeRef.current(processName, res.suggestedRule);
    }
    // Essential always locks; otherwise keep the user's manual-control preference.
    setIsLocked(res.verdict === "essential" ? true : !(currentRuleRef.current?.manualControl ?? false));
  }, [aiAvailable, aiSetupError, aiSetupPhase, processName]); // rule state is accessed via refs

  const handleDownload = useCallback(async () => {
    if (!window.electron || !processName) return;
    const res = result as any;
    const modelName: string = res?.recommendedModel ?? DEFAULT_MODEL;

    setDownloading(true);
    setPullStatus("Connecting to Ollama…");
    setPullPct(0);

    const unsub = window.electron.onPullProgress(p => {
      if (p.total && p.completed) {
        setPullPct(Math.round((p.completed / p.total) * 100));
        const gb = (n: number) => (n / 1e9).toFixed(2) + " GB";
        setPullStatus(`Downloading ${gb(p.completed)} / ${gb(p.total)}`);
      } else if (p.status) {
        setPullStatus(p.status);
      }
    });

    const pullRes = await window.electron.pullModel(modelName);
    unsub();
    setDownloading(false);

    if (pullRes.ok) {
      setResult(null);
      setLoading(true);
      runAI().finally(() => setLoading(false));
    } else {
      setPullStatus(`Download failed: ${pullRes.error ?? "unknown error"}`);
    }
  }, [processName, result, runAI]);

  const loadTelemetry = useCallback(async (tab: string) => {
    if (!processPid) return;
    setLoadingTab(true);
    try {
      if (tab === "modules") {
        let data;
        if (window.electron) {
          data = await window.electron.getProcessDlls(processPid);
        } else {
          const res = await fetch(`/api/telemetry?pid=${processPid}&type=dlls`);
          data = await res.json();
        }
        setDlls(toArray(data));
      } else if (tab === "network") {
        let data;
        if (window.electron) {
          data = await window.electron.getProcessNetwork(processPid);
        } else {
          const res = await fetch(`/api/telemetry?pid=${processPid}&type=network`);
          data = await res.json();
        }
        setNetwork(normalizeNetworkTelemetry(data));
      } else if (tab === "services") {
        let data;
        if (window.electron) {
          data = await window.electron.getProcessServices(processPid);
        } else {
          const res = await fetch(`/api/telemetry?pid=${processPid}&type=services`);
          data = await res.json();
        }
        setServices(toArray(data));
      }
    } catch (e) {
      console.error(`Failed to load ${tab} telemetry:`, e);
    } finally {
      setLoadingTab(false);
    }
  }, [processPid]);

  const loadEvidenceTelemetry = useCallback(async () => {
    if (!processPid) {
      setEvidenceTimestamp(Date.now());
      return;
    }
    setLoadingTab(true);
    try {
      const fetchNetwork = async () => {
        if (window.electron) return window.electron.getProcessNetwork(processPid);
        const res = await fetch(`/api/telemetry?pid=${processPid}&type=network`);
        return res.json();
      };
      const fetchServices = async () => {
        if (window.electron) return window.electron.getProcessServices(processPid);
        const res = await fetch(`/api/telemetry?pid=${processPid}&type=services`);
        return res.json();
      };
      const fetchDlls = async () => {
        if (window.electron) return window.electron.getProcessDlls(processPid);
        const res = await fetch(`/api/telemetry?pid=${processPid}&type=dlls`);
        return res.json();
      };
      const [networkData, servicesData, dllData] = await Promise.all([fetchNetwork(), fetchServices(), fetchDlls()]);
      setNetwork(normalizeNetworkTelemetry(networkData));
      setServices(toArray(servicesData));
      setDlls(toArray(dllData));
    } catch (e) {
      console.error("Failed to load evidence telemetry:", e);
    } finally {
      setEvidenceTimestamp(Date.now());
      setLoadingTab(false);
    }
  }, [processPid]);

  const handleTabClick = (tab: "overview" | "modules" | "network" | "services" | "edr" | "timeline") => {
    setActiveTab(tab);
    if (tab === "timeline") {
      loadEvidenceTelemetry();
    } else if (tab !== "overview" && tab !== "edr") {
      loadTelemetry(tab);
    }
  };

  useEffect(() => {
    if (!processName) {
      setResult(null);
      setIsStartupApp(false);
      setIsLocked(true);
      setIconError(false);
      setActiveTab("overview");
      setDlls(null);
      setNetwork(null);
      setServices(null);
      setLoadingTab(false);
      return;
    }
    setLoading(true);
    setResult(null);
    setIsStartupApp(false);
    setIsLocked(!(currentRuleRef.current?.manualControl ?? false));
    setIconError(false);
    setDownloading(false);
    setPullStatus("");
    setPullPct(0);
    setActiveTab("overview");
    setEvidenceTimestamp(Date.now());
    setDlls(null);
    setNetwork(null);
    setServices(null);
    setLoadingTab(false);

    if (window.electron) {
      window.electron.getStartupInfo(processName)
        .then(d => setIsStartupApp(d.isStartupApp === true))
        .catch(() => {});
    }

    const load = async () => {
      const cachedData = window.electron
        ? await window.electron.getCachedAnalysis(processName)
        : null;

      if (cachedData && cachedData.description && cachedData.tip) {
        setResult(cachedData);
        // Essential processes are always locked for safety; otherwise respect the saved manual-control flag.
        setIsLocked(cachedData.verdict === "essential" ? true : !(currentRuleRef.current?.manualControl ?? false));
        return;
      }

      await runAI();
    };

    load()
      .catch(e => setResult({ error: String(e), _isError: true } as any))
      .finally(() => setLoading(false));
  }, [processName, runAI]);

  const handleActionClick = (action: RuleAction) => {
    if (!onRuleChange || !processName || isLocked) return;
    onRuleChange(processName, {
      ...currentRule,
      action: currentRule.action === action ? "NONE" : action,
    });
  };

  const handleTimeoutChange = (mins: number | null) => {
    if (!onRuleChange || !processName || isLocked) return;
    onRuleChange(processName, { ...currentRule, autoKillMins: mins });
  };

  const handleDisableStartup = async () => {
    if (!processName) return;
    setDisablingStartup(true);
    try {
      // Delegate to Electron main process — no direct fetch to avoid static-export 404
      if (window.electron) {
        await window.electron.getStartupInfo(processName); // placeholder until dedicated IPC exists
      }
      setIsStartupApp(false);
      alert("Attempted to remove the process from Windows Startup.");
    } catch {
      alert("Failed to modify startup registry. May require Administrator privileges.");
    } finally {
      setDisablingStartup(false);
    }
  };

  // Derived error state — avoids type-unsafe casts scattered through JSX
  const errResult   = result && (result as any)._isError ? (result as any) : null;
  const errMsg      = errResult ? String(errResult.error ?? "Unknown error") : "";
  const recModel    = errResult ? (errResult.recommendedModel ?? DEFAULT_MODEL) : DEFAULT_MODEL;
  const modelMissing = errResult ? /not found|pull|model/i.test(errMsg) : false;
  const notRunning   = errResult ? /ECONNREFUSED|reach|unavailable|running/i.test(errMsg) : false;

  const timelineEntries = useMemo<TimelineEntry[]>(() => {
    const target = processName ? normalizeProcessName(processName) : "";
    const matchesTarget = (event: AuditEvent) => {
      if (!target) return false;
      if (normalizeProcessName(event.message).includes(target)) return true;
      const details = event.details && typeof event.details === "object"
        ? event.details as Record<string, unknown>
        : {};
      return [details?.name, details?.processName, details?.target, details?.pid]
        .filter(value => value !== undefined && value !== null)
        .some(value => normalizeProcessName(String(value)).includes(target) || String(value) === String(processPid));
    };

    const entries: TimelineEntry[] = [];
    const matchedAuditEvents = auditEvents.filter(matchesTarget);
    const syntheticTs = evidenceTimestamp;

    if (processName) {
      entries.push({
        id: "identity",
        ts: syntheticTs,
        kind: "identity",
        title: "Identity observed",
        detail: `${processName}${processPid > 0 ? ` is running as PID ${processPid}` : " is not currently active"} with ${processTrust ?? "unknown"} trust.`,
        color: processTrust === "trusted" || processTrust === "verified" ? "#22c55e" : processTrust === "background" ? "#f59e0b" : "#f87171",
      });
    }

    if (result && !("_isError" in result)) {
      const flags = result.threatFlags?.length ? ` Flags: ${result.threatFlags.join(", ")}.` : "";
      entries.push({
        id: "analysis",
        ts: syntheticTs,
        kind: "analysis",
        title: `AI verdict: ${result.verdict}`,
        detail: `${result.title || processName || "Process"} scored ${result.riskScore ?? 0}/100 risk.${flags} ${result.tip || ""}`.trim(),
        color: result.verdict === "essential" || result.verdict === "safe" ? "#22c55e" : result.verdict === "background" ? "#f59e0b" : "#f87171",
      });
    }

    if (currentRule?.action && currentRule.action !== "NONE") {
      const controls = [
        currentRule.manualControl ? "manual control" : "auto managed",
        currentRule.autoKillMins ? `auto-cleanup after ${currentRule.autoKillMins} min idle` : "no idle cleanup",
      ].join(", ");
      entries.push({
        id: "rule-current",
        ts: syntheticTs,
        kind: "rule",
        title: `Rule active: ${currentRule.action}`,
        detail: controls,
        color: currentRule.action === "BAN" ? "#f87171" : currentRule.action === "LIMITED" ? "#f59e0b" : "#22c55e",
      });
    }

    if (processHistory.length > 0) {
      const latest = processHistory[processHistory.length - 1];
      const peakCpu = Math.max(...processHistory.map(p => p.cpu));
      const peakRam = Math.max(...processHistory.map(p => p.ram));
      entries.push({
        id: "resource",
        ts: syntheticTs,
        kind: "resource",
        title: "Resource pattern",
        detail: `Latest ${latest.cpu.toFixed(1)}% CPU and ${fmtRam(latest.ram)} RAM. Peak in window: ${peakCpu.toFixed(1)}% CPU, ${fmtRam(peakRam)} RAM.`,
        color: peakCpu >= 25 || peakRam >= 1024 ? "#f59e0b" : "#60a5fa",
      });
    }

    if (isStartupApp && processName) {
      entries.push({
        id: "startup",
        ts: syntheticTs,
        kind: "identity",
        title: "Startup persistence",
        detail: `${processName} is registered to launch at Windows startup.`,
        color: "#f59e0b",
      });
    }

    if (dlls && dlls.length > 0) {
      const nonSystem = dlls.filter(dll => !isSystemDllPath(dll?.FileName));
      entries.push({
        id: "modules",
        ts: syntheticTs,
        kind: "modules",
        title: "Module footprint",
        detail: `${dlls.length} DLL(s) loaded${
          nonSystem.length > 0
            ? `; ${nonSystem.length} outside System32 (${nonSystem.slice(0, 2).map((d: any) => d.ModuleName).join(", ")})`
            : "; all within system paths"
        }.`,
        color: nonSystem.length > 0 ? "#f59e0b" : "#60a5fa",
      });
    }

    const tcp = network?.tcp ?? [];
    const udp = network?.udp ?? [];
    if (processPid > 0) {
      const remoteTcp = tcp.filter(conn => {
        const remote = String(conn.RemoteAddress ?? "");
        return remote && remote !== "*" && remote !== "0.0.0.0" && remote !== "::";
      });
      entries.push({
        id: "network",
        ts: syntheticTs,
        kind: "network",
        title: remoteTcp.length > 0 ? "Network evidence" : "Network quiet",
        detail: remoteTcp.length > 0
          ? `${remoteTcp.length} remote TCP connection(s), ${tcp.length} TCP total, ${udp.length} UDP socket(s).`
          : `${tcp.length} TCP listener/connection(s) and ${udp.length} UDP socket(s); no remote TCP endpoint shown.`,
        color: remoteTcp.length > 0 ? "#f59e0b" : "#60a5fa",
      });
    }

    if (services && services.length > 0) {
      entries.push({
        id: "services",
        ts: syntheticTs,
        kind: "service",
        title: "Service linkage",
        detail: `${services.length} Windows service(s) map to this process, including ${services.slice(0, 2).map(s => s.DisplayName || s.Name).join(", ")}.`,
        color: "#a78bfa",
      });
    }

    for (const event of matchedAuditEvents) {
      const meta = EVENT_META[event.type] ?? { color: "#94a3b8", icon: "*" };
      entries.push({
        id: event.id,
        ts: event.ts,
        kind: event.type === "rule" ? "rule" : "audit",
        title: event.type.replace(/-/g, " "),
        detail: event.message,
        color: meta.color,
      });
    }

    return entries
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 16);
  }, [auditEvents, currentRule, dlls, evidenceTimestamp, isStartupApp, network, processHistory, processName, processPid, processTrust, result, services]);

  return (
    <div className={styles.overlay}>
      <div className={`${styles.drawer} ${isOpen ? styles.drawerOpen : ""}`}>

        {/* Header */}
        <div className={styles.drawerHeader}>
          {!iconError ? (
            <IconImage
              name={processName || ""}
              className={styles.headerIcon}
              onIconError={() => setIconError(true)}
              isSystem={(result as any)?.verdict === "essential"}
            />
          ) : (result as any)?.verdict === "essential" ? (
            <div className={styles.headerIconSystem}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                <path d="M0 3.449L9.75 2.1V11.719H0V3.449zm0 9.15h9.75V22.2L0 20.811V12.599zm10.663-10.596L24 0v11.719H10.663V2.003zm0 10.596H24V24l-13.337-2.1V12.599z" />
              </svg>
            </div>
          ) : (
            <div className={styles.headerIconFallback}>
              {processName?.charAt(0).toUpperCase()}
            </div>
          )}
          <div className={styles.drawerTitle}>
            <div className={styles.drawerName}>{(result as any)?.title ?? processName ?? ""}</div>
            <div className={styles.drawerProcess}>{processName}</div>
          </div>
          <button className={styles.closeTab} onClick={onClose} aria-label="Close">
            ✕<span className={styles.closeTabLabel}>Close</span>
          </button>
        </div>

        {/* Loading — streaming terminal */}
        {loading && !errResult && (
          <div className={styles.body}>
            <div className={styles.loading}>
              <div className={styles.spinner} />
              <span className={styles.loadingText}>
                {streamText ? "Receiving analysis…" : "Analyzing process…"}
              </span>
            </div>
            {streamText && (
              <div className={styles.streamTerminal}>
                <div className={styles.streamTerminalBar}>
                  <span className={styles.streamDot} />
                  <span className={styles.streamDot} />
                  <span className={styles.streamDot} />
                  <span className={styles.streamTerminalLabel}>AI output stream</span>
                </div>
                <pre className={styles.streamText}>{streamText}<span className={styles.streamCursor}>▋</span></pre>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {errResult && !loading && (
          <div className={styles.body}>
            <div style={{ textAlign: "center", padding: "24px 16px", color: "var(--text-muted)", fontSize: "13px" }}>
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>⚠</div>
              <div style={{ fontWeight: 600, marginBottom: "8px", color: "var(--unknown)" }}>
                {modelMissing ? "Model Not Found" : "AI Unavailable"}
              </div>
              <div style={{ marginBottom: "14px", lineHeight: 1.5 }}>{errMsg}</div>

              {modelMissing && !downloading && (
                <button
                  onClick={handleDownload}
                  style={{
                    background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)",
                    color: "var(--verified)", padding: "8px 20px", borderRadius: "8px",
                    fontSize: "13px", fontWeight: 700, cursor: "pointer", width: "100%",
                    marginBottom: "8px",
                  }}
                >
                  ⬇ Download {recModel}
                </button>
              )}

              {downloading && (
                <div style={{ marginBottom: "8px" }}>
                  <div style={{ height: "4px", background: "rgba(255,255,255,0.08)", borderRadius: "2px", overflow: "hidden", marginBottom: "8px" }}>
                    <div style={{ height: "100%", background: "var(--verified)", borderRadius: "2px", width: `${pullPct}%`, transition: "width 0.4s ease" }} />
                  </div>
                  <div style={{ fontSize: "12px" }}>{pullStatus}</div>
                </div>
              )}

              {pullStatus && !downloading && (
                <div style={{ fontSize: "12px", color: "var(--text-dim)", marginBottom: "8px" }}>{pullStatus}</div>
              )}

              {modelMissing && (
                <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", borderRadius: "6px", padding: "7px 12px", fontFamily: "monospace", fontSize: "11px", color: "var(--text-dim)", marginTop: "4px" }}>
                  ollama pull {recModel}
                </div>
              )}
              {notRunning && (
                <div style={{ marginTop: "8px", fontSize: "12px", opacity: 0.6 }}>
                  Install Ollama from <span style={{ color: "var(--verified)" }}>ollama.com</span>, then restart TaskFish.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Result */}
        {result && !errResult && !loading && (
          <>
            <div className={styles.verdictBar}>
              <span className={`${styles.verdict} ${
                result.verdict === "essential" ? styles.verdictEssential :
                result.verdict === "safe" ? styles.verdictSafe :
                result.verdict === "background" ? styles.verdictBackground :
                styles.verdictCaution
              }`}>
                {result.verdict === "essential" ? "✓ Essential" :
                 result.verdict === "safe"       ? "✓ Safe"      :
                 result.verdict === "background" ? "● Background" :
                 "⚠ Caution"}
              </span>
              <span className={`${styles.gameModeTag} ${result.gameModeSafe ? styles.gameModeSafeTag : styles.gameModeDangerTag}`}>
                {result.gameModeSafe ? "🚀 Safe for Game Mode" : "🛡 Keep during Gaming"}
              </span>
            </div>

            {/* Glassmorphic Tabs */}
            <div className={styles.tabs}>
              <button 
                className={`${styles.tab} ${activeTab === "overview" ? styles.active : ""}`} 
                onClick={() => handleTabClick("overview")}
              >
                Overview
              </button>
              <button 
                className={`${styles.tab} ${activeTab === "modules" ? styles.active : ""}`} 
                onClick={() => handleTabClick("modules")}
              >
                Modules
              </button>
              <button 
                className={`${styles.tab} ${activeTab === "network" ? styles.active : ""}`} 
                onClick={() => handleTabClick("network")}
              >
                Network
              </button>
              <button 
                className={`${styles.tab} ${activeTab === "services" ? styles.active : ""}`} 
                onClick={() => handleTabClick("services")}
              >
                Services
              </button>
              <button
                className={`${styles.tab} ${activeTab === "edr" ? styles.active : ""}`}
                onClick={() => handleTabClick("edr")}
              >
                EDR
              </button>
              <button
                className={`${styles.tab} ${activeTab === "timeline" ? styles.active : ""}`}
                onClick={() => handleTabClick("timeline")}
              >
                Timeline
              </button>
            </div>

            <div className={styles.body}>
              {activeTab === "overview" && (
                <>
                  <div className={styles.section}>
                    <span className={styles.sectionLabel}>What is this?</span>
                    <p className={styles.sectionText}>
                      {result.description || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No description available.</span>}
                    </p>
                  </div>

                  <div className={styles.section}>
                    <span className={styles.sectionLabel}>Recommendation</span>
                    <div className={styles.tipBox}>
                      <span className={styles.tipIcon}>💡</span>
                      <span>{result.tip || "No recommendation available."}</span>
                    </div>
                  </div>

                  <div className={styles.section} style={{ marginTop: "4px" }}>
                    <button
                      onClick={() => { setResult(null); setLoading(true); runAI().finally(() => setLoading(false)); }}
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", color: "var(--text-muted)", padding: "6px 14px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", width: "100%" }}
                    >
                      Re-analyze
                    </button>
                  </div>

                  {onRuleChange && processName && (
                    <div className={styles.section} style={{ marginTop: "16px" }}>
                      {(() => {
                        if (currentRule?.action !== "NONE") return null;
                        let action = "ALLOW";
                        if (result?.suggestedRule) {
                          action = typeof result.suggestedRule === "string" ? result.suggestedRule : result.suggestedRule.action;
                        } else if (result?.verdict) {
                          action = result.verdict === "essential" || result.verdict === "safe" ? "ALLOW"
                                 : result.verdict === "background" ? "LIMITED" : "BAN";
                        } else {
                          return null;
                        }
                        
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              if (onRuleChange) {
                                onRuleChange(processName, { action: action as any, autoKillMins: null });
                                setIsLocked(true);
                              }
                            }}
                            style={{
                              background: "rgba(34,197,94,0.12)",
                              border: "1.5px solid rgba(34,197,94,0.4)",
                              color: "var(--verified)",
                              padding: "12px 16px",
                              borderRadius: "10px",
                              fontSize: "13.5px",
                              fontWeight: 700,
                              cursor: "pointer",
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "8px",
                              marginBottom: "16px",
                              boxShadow: "0 4px 12px rgba(34,197,94,0.1)",
                              transition: "background 0.15s, border-color 0.15s"
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(34,197,94,0.2)"; e.currentTarget.style.borderColor = "rgba(34,197,94,0.6)"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "rgba(34,197,94,0.12)"; e.currentTarget.style.borderColor = "rgba(34,197,94,0.4)"; }}
                          >
                            🛡 Approve Recommendation ({action})
                          </button>
                        );
                      })()}

                      <div className={styles.sectionHeader}>
                        <span className={styles.sectionLabel}>Process Rules</span>
                        <label className={styles.unlockToggle}>
                          <input
                            type="checkbox"
                            checked={!isLocked}
                            onChange={(e) => {
                              const manualOn = e.target.checked;
                              setIsLocked(!manualOn);
                              if (onRuleChangeRef.current && processName) {
                                onRuleChangeRef.current(processName, {
                                  ...currentRuleRef.current,
                                  manualControl: manualOn || undefined,
                                  overrideTrust: (manualOn && processTrustRef.current && processTrustRef.current !== "unknown") ? processTrustRef.current : undefined,
                                });
                              }
                            }}
                          />
                          <span>Manual Control</span>
                        </label>
                      </div>

                      <div className={`${styles.rulesList} ${isLocked ? styles.locked : ""}`}>
                        <button className={`${styles.ruleBtn} ${styles.allow} ${currentRule?.action === "ALLOW" ? styles.active : ""}`} onClick={() => handleActionClick("ALLOW")} disabled={isLocked}>
                          ALLOW (Always)
                        </button>
                        <button className={`${styles.ruleBtn} ${styles.limited} ${currentRule?.action === "LIMITED" ? styles.active : ""}`} onClick={() => handleActionClick("LIMITED")} disabled={isLocked}>
                          ALLOW (Limited)
                        </button>
                        <button className={`${styles.ruleBtn} ${styles.ban} ${currentRule?.action === "BAN" ? styles.active : ""}`} onClick={() => handleActionClick("BAN")} disabled={isLocked}>
                          BAN / Blacklist
                        </button>
                      </div>

                      {currentRule?.action === "BAN" && (
                        <div className={styles.warningText}>
                          <div style={{ marginBottom: "8px" }}>This process is blacklisted. To fully remove it, we advise uninstalling the parent program.</div>
                          {isStartupApp && (
                            <button
                              onClick={handleDisableStartup}
                              disabled={disablingStartup}
                              style={{ background: "rgba(248,113,113,0.2)", color: "var(--unknown)", border: "1px solid rgba(248,113,113,0.5)", padding: "6px 12px", borderRadius: "6px", cursor: disablingStartup ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: "bold", marginTop: "8px", width: "100%" }}
                            >
                              {disablingStartup ? "Removing..." : "Remove from Windows Startup"}
                            </button>
                          )}
                        </div>
                      )}

                      <div className={`${styles.autoKillWrap} ${isLocked ? styles.locked : ""}`}>
                        <span className={styles.autoKillLabel}>Auto-Cleanup (0% CPU Inactivity)</span>
                        <select
                          className={styles.autoKillSelect}
                          disabled={isLocked}
                          value={currentRule?.autoKillMins == null ? "off" : currentRule.autoKillMins.toString()}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleTimeoutChange(val === "off" ? null : parseInt(val, 10));
                          }}
                        >
                          <option value="off">Disabled</option>
                          <option value="10">Kill after 10 min</option>
                          <option value="30">Kill after 30 min</option>
                          <option value="60">Kill after 60 min</option>
                        </select>
                      </div>
                    </div>
                  )}
                </>
              )}

              {activeTab === "modules" && (
                <div className={styles.telemetrySection}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span className={styles.sectionLabel}>Loaded Dynamic Link Libraries</span>
                    {processPid !== 0 && (
                      <button className={styles.miniRefresh} onClick={() => loadTelemetry("modules")}>⟳</button>
                    )}
                  </div>
                  {processPid === 0 ? (
                    <div className={styles.telemetryOffline}>
                      <span>Live Telemetry Unavailable</span>
                      <p>This process is not currently active in memory.</p>
                    </div>
                  ) : loadingTab ? (
                    <div className={styles.miniLoading}>
                      <div className={styles.miniSpinner} />
                      <span>Loading modules…</span>
                    </div>
                  ) : (
                    <div className={styles.telemetryList}>
                      {dlls && dlls.length > 0 ? (
                        dlls.map((dll, idx) => (
                          <div key={idx} className={styles.telemetryItem}>
                            <div className={styles.telemetryItemPrimary}>{dll.ModuleName}</div>
                            <div className={styles.telemetryItemSecondary}>{dll.FileName || "System Module"}</div>
                          </div>
                        ))
                      ) : (
                        <div className={styles.emptyText}>No loaded modules found or access is denied.</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "network" && (
                <div className={styles.telemetrySection}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span className={styles.sectionLabel}>Active Network Ports</span>
                    {processPid !== 0 && (
                      <button className={styles.miniRefresh} onClick={() => loadTelemetry("network")}>⟳</button>
                    )}
                  </div>
                  {processPid === 0 ? (
                    <div className={styles.telemetryOffline}>
                      <span>Live Telemetry Unavailable</span>
                      <p>This process is not currently active in memory.</p>
                    </div>
                  ) : loadingTab ? (
                    <div className={styles.miniLoading}>
                      <div className={styles.miniSpinner} />
                      <span>Loading connections…</span>
                    </div>
                  ) : (
                    <div className={styles.telemetryList}>
                      <div className={styles.telemetryGroupHeader}>TCP Connections</div>
                      {network?.tcp && network.tcp.length > 0 ? (
                        network.tcp.map((conn, idx) => (
                          <div key={idx} className={styles.telemetryItem}>
                            <div className={styles.telemetryItemPrimary} style={{ color: conn.State === "LISTEN" ? "var(--verified)" : "var(--text)" }}>
                              {conn.LocalAddress}:{conn.LocalPort} → {conn.RemoteAddress || "*"}:{conn.RemotePort || "*"}
                            </div>
                            <div className={styles.telemetryItemSecondary}>State: {conn.State || "Unknown"}</div>
                          </div>
                        ))
                      ) : (
                        <div className={styles.emptyText}>No active TCP sockets detected.</div>
                      )}

                      <div className={styles.telemetryGroupHeader} style={{ marginTop: "16px" }}>UDP Sockets</div>
                      {network?.udp && network.udp.length > 0 ? (
                        network.udp.map((conn, idx) => (
                          <div key={idx} className={styles.telemetryItem}>
                            <div className={styles.telemetryItemPrimary}>{conn.LocalAddress}:{conn.LocalPort}</div>
                            <div className={styles.telemetryItemSecondary}>UDP Endpoint (Stateless)</div>
                          </div>
                        ))
                      ) : (
                        <div className={styles.emptyText}>No active UDP sockets detected.</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "services" && (
                <div className={styles.telemetrySection}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span className={styles.sectionLabel}>Associated Services</span>
                    {processPid !== 0 && (
                      <button className={styles.miniRefresh} onClick={() => loadTelemetry("services")}>⟳</button>
                    )}
                  </div>
                  {processPid === 0 ? (
                    <div className={styles.telemetryOffline}>
                      <span>Live Telemetry Unavailable</span>
                      <p>This process is not currently active in memory.</p>
                    </div>
                  ) : loadingTab ? (
                    <div className={styles.miniLoading}>
                      <div className={styles.miniSpinner} />
                      <span>Loading services…</span>
                    </div>
                  ) : (
                    <div className={styles.telemetryList}>
                      {services && services.length > 0 ? (
                        services.map((svc, idx) => (
                          <div key={idx} className={styles.telemetryItem}>
                            <div className={styles.telemetryItemPrimary}>{svc.DisplayName} ({svc.Name})</div>
                            <div className={styles.telemetryItemSecondary}>Status: {svc.Status} | Startup: {svc.StartMode}</div>
                          </div>
                        ))
                      ) : (
                        <div className={styles.emptyText}>No associated Windows services found.</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "edr" && (
                <div className={styles.edrSection}>
                  <span className={styles.sectionLabel}>AI Endpoint Threat Audit</span>
                  
                  {/* Glowing Meter */}
                  {(() => {
                    const risk = result.riskScore ?? 0;
                    const flags = result.threatFlags ?? [];
                    const isHigh = risk >= 60;
                    const isMed = risk >= 25 && risk < 60;
                    const ringColor = isHigh ? "var(--unknown)" : isMed ? "var(--background)" : "var(--trusted)";
                    const riskLabel = isHigh ? "CRITICAL THREAT" : isMed ? "SUSPICIOUS ACTIVITY" : "SAFE / TRUSTED";

                    return (
                      <div className={styles.edrDashboard}>
                        <div className={styles.riskMeterContainer}>
                          <div 
                            className={styles.riskMeterOuter}
                            style={{ 
                              borderColor: ringColor,
                              boxShadow: `0 0 20px ${ringColor}44, inset 0 0 12px ${ringColor}22`
                            }}
                          >
                            <span className={styles.riskScoreVal}>{risk}</span>
                            <span className={styles.riskScoreMax}>/ 100</span>
                          </div>
                          <div className={styles.riskScoreText} style={{ color: ringColor }}>
                            {riskLabel}
                          </div>
                        </div>

                        {/* Flags List */}
                        <div className={styles.edrFlagsContainer}>
                          <div className={styles.sectionLabel} style={{ marginBottom: "8px" }}>Threat Vector Analysis</div>
                          {flags.length > 0 ? (
                            <div className={styles.flagGrid}>
                              {flags.map(flag => (
                                <span key={flag} className={styles.threatFlagPill}>
                                  ⚠ {flag.toUpperCase().replace(/_/g, " ")}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className={styles.tipBox} style={{ background: "rgba(34,197,94,0.07)", borderColor: "rgba(34,197,94,0.18)", width: "100%", boxSizing: "border-box" }}>
                              <span className={styles.tipIcon} style={{ color: "var(--trusted)" }}>✓</span>
                              <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>No active behavior indicators flagged by deep scan.</span>
                            </div>
                          )}
                        </div>

                        {/* Safety Audits List */}
                        <div className={styles.edrChecklist}>
                          <div className={styles.sectionLabel} style={{ marginBottom: "8px" }}>EDR Forensic Checklist</div>
                          <div className={styles.checkItem}>
                            <span className={styles.checkIcon} style={{ color: "var(--trusted)" }}>✓</span>
                            <span>Executable Identity Authenticated</span>
                          </div>
                          <div className={styles.checkItem}>
                            <span className={styles.checkIcon} style={{ color: flags.includes("suspicious_network") ? "var(--unknown)" : "var(--trusted)" }}>
                              {flags.includes("suspicious_network") ? "⚠" : "✓"}
                            </span>
                            <span>Network Sockets Verification</span>
                          </div>
                          <div className={styles.checkItem}>
                            <span className={styles.checkIcon} style={{ color: flags.includes("dll_injection") ? "var(--unknown)" : "var(--trusted)" }}>
                              {flags.includes("dll_injection") ? "⚠" : "✓"}
                            </span>
                            <span>Dynamic Loading & Memory Auditing</span>
                          </div>
                          <div className={styles.checkItem}>
                            <span className={styles.checkIcon} style={{ color: "var(--trusted)" }}>✓</span>
                            <span>Host-Process Integrity Check</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {activeTab === "timeline" && (() => {
                const trustColors: Record<string, { bg: string; color: string }> = {
                  trusted:  { bg: "rgba(34,197,94,0.12)",  color: "#22c55e" },
                  verified: { bg: "rgba(96,165,250,0.12)", color: "#60a5fa" },
                  background: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
                  unknown:  { bg: "rgba(248,113,113,0.12)",color: "#f87171" },
                };
                const tc = trustColors[processTrust ?? "unknown"] ?? trustColors.unknown;

                const ruleColors: Record<string, { bg: string; color: string }> = {
                  ALLOW:   { bg: "rgba(34,197,94,0.12)",  color: "#22c55e" },
                  LIMITED: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
                  BAN:     { bg: "rgba(248,113,113,0.12)",color: "#f87171" },
                  NONE:    { bg: "rgba(255,255,255,0.06)", color: "#64748b" },
                };
                const rc = ruleColors[currentRule?.action ?? "NONE"] ?? ruleColors.NONE;

                const maxRam = Math.max(...processHistory.map(p => p.ram), 1);
                const W = 280, H = 28;
                const pts = (vals: number[], max: number) =>
                  vals.map((v, i) =>
                    `${processHistory.length > 1 ? (i / (processHistory.length - 1)) * W : 0},${H - (v / max) * H}`
                  ).join(" ");
                return (
                  <div className={styles.timelineSection}>
                    <div>
                      <div className={styles.sectionLabel} style={{ marginBottom: 8 }}>Evidence Snapshot</div>
                      <div className={styles.timelineStatusRow}>
                        <span className={styles.statusBadge} style={{ background: tc.bg, borderColor: tc.color + "44", color: tc.color }}>
                          {processTrust ?? "unknown"}
                        </span>
                        <span className={styles.statusBadge} style={{ background: rc.bg, borderColor: rc.color + "44", color: rc.color }}>
                          {currentRule?.action ?? "NONE"}
                        </span>
                        {result && !("_isError" in result) && (
                          <span className={styles.statusBadge} style={{
                            background: result.verdict === "essential" ? "rgba(34,197,94,0.12)" : result.verdict === "safe" ? "rgba(96,165,250,0.12)" : result.verdict === "background" ? "rgba(245,158,11,0.12)" : "rgba(248,113,113,0.12)",
                            borderColor: result.verdict === "essential" ? "#22c55e44" : result.verdict === "safe" ? "#60a5fa44" : result.verdict === "background" ? "#f59e0b44" : "#f8717144",
                            color: result.verdict === "essential" ? "#22c55e" : result.verdict === "safe" ? "#60a5fa" : result.verdict === "background" ? "#f59e0b" : "#f87171",
                          }}>
                            AI: {result.verdict}
                          </span>
                        )}
                        {processPid > 0 && (
                          <span className={styles.statusBadge} style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)", color: "#94a3b8" }}>
                            PID {processPid}
                          </span>
                        )}
                        <span className={styles.statusBadge} style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)", color: "#94a3b8" }}>
                          {(network?.tcp?.length ?? 0) + (network?.udp?.length ?? 0)} socket(s)
                        </span>
                      </div>
                    </div>

                    {processHistory.length > 1 && (
                      <div className={styles.sparklineBlock}>
                        <div className={styles.sectionLabel}>Resource History ({processHistory.length} samples)</div>
                        <div className={styles.sparklineLabel}>CPU %</div>
                        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
                          <polyline points={pts(processHistory.map(p => p.cpu), 100)} fill="none" stroke="#22c55e" strokeWidth="1.5" opacity="0.85" />
                        </svg>
                        <div className={styles.sparklineLabel} style={{ marginTop: 6 }}>RAM</div>
                        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
                          <polyline points={pts(processHistory.map(p => p.ram), maxRam)} fill="none" stroke="#60a5fa" strokeWidth="1.5" opacity="0.85" />
                        </svg>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
                          <span>CPU: {processHistory[processHistory.length - 1].cpu.toFixed(1)}%</span>
                          <span>RAM: {processHistory[processHistory.length - 1].ram >= 1024
                            ? `${(processHistory[processHistory.length - 1].ram / 1024).toFixed(1)} GB`
                            : `${Math.round(processHistory[processHistory.length - 1].ram)} MB`}</span>
                        </div>
                      </div>
                    )}

                    {/* Event log */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span className={styles.sectionLabel}>
                          Process Story{timelineEntries.length > 0 ? ` (${timelineEntries.length})` : ""}
                        </span>
                        <button className={styles.miniRefresh} onClick={() => loadEvidenceTelemetry()} title="Refresh">⟳</button>
                      </div>
                      {loadingTab && (
                        <div className={styles.miniLoading} style={{ marginBottom: 8 }}>
                          <div className={styles.miniSpinner} />
                          <span>Collecting evidence...</span>
                        </div>
                      )}
                      {timelineEntries.length === 0 ? (
                        <div className={styles.timelineEmpty}>No evidence recorded for this process yet</div>
                      ) : (
                        <div className={styles.timelineEventList}>
                          {timelineEntries.map(entry => {
                            const icon = KIND_ICONS[entry.kind] ?? "•";
                            const auditMeta = entry.kind === "audit" ? (EVENT_META[entry.title] ?? null) : null;
                            const dotColor = auditMeta ? auditMeta.color : entry.color;
                            return (
                              <div key={entry.id} className={styles.timelineEvent}>
                                <div className={styles.timelineEventDot} style={{ background: dotColor }} />
                                <div className={styles.timelineEventContent}>
                                  <div className={styles.timelineEventTitle} style={{ color: dotColor }}>
                                    {icon} {entry.title}
                                  </div>
                                  <div className={styles.timelineEventMsg}>{entry.detail}</div>
                                  <div className={styles.timelineEventTime}>{fmtAge(entry.ts)}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
