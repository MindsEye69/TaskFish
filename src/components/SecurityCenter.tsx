"use client";
import { useState, useMemo, useCallback } from "react";
import type { AiSetupPhase, ProcessInfo, ProcessProfile, RuleConfig } from "@/lib/types";
import type { EventHealthReport, EventCluster, EventHealthAnalysis } from "@/lib/eventLog";
import styles from "./SecurityCenter.module.css";

type AuditEvent = { id: string; ts: number; type: string; message: string; details?: unknown };

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
  "game-mode": { bg: "rgba(139,92,246,0.12)",  color: "#a78bfa", label: "GAME MODE" },
  safety:      { bg: "rgba(34,197,94,0.12)",   color: "#22c55e", label: "SAFETY" },
  priority:    { bg: "rgba(96,165,250,0.08)",  color: "#93c5fd", label: "PRIORITY" },
  profile:     { bg: "rgba(20,184,166,0.12)",  color: "#2dd4bf", label: "PROFILE" },
};

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
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAction, setFilterAction] = useState<"ALL" | "ALLOW" | "LIMITED" | "BAN">("ALL");
  const [profileName, setProfileName] = useState("");
  const [eventReport, setEventReport] = useState<EventHealthReport | null>(null);
  const [eventImportError, setEventImportError] = useState("");
  const [importingEvents, setImportingEvents] = useState(false);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [eventAnalysis, setEventAnalysis] = useState<EventHealthAnalysis | null>(null);
  const [analyzingEvents, setAnalyzingEvents] = useState(false);
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());

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

  const handleImportEventLog = useCallback(async () => {
    if (!window.electron?.importEventLog) return;
    setImportingEvents(true);
    setEventImportError("");
    setEventAnalysis(null);
    setExpandedFindings(new Set());
    try {
      const result = await window.electron.importEventLog();
      if (result.ok && result.report) {
        setEventReport(result.report);
      } else if (!result.canceled) {
        setEventImportError(result.error || "Event log import failed.");
      }
    } catch (err) {
      setEventImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingEvents(false);
    }
  }, []);

  const handleAnalyzeEvents = useCallback(async () => {
    if (!eventReport || analyzingEvents) return;
    setAnalyzingEvents(true);
    try {
      const res = await fetch("/api/event-health-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: eventReport }),
      });
      if (res.ok) {
        const data = await res.json() as EventHealthAnalysis & { error?: string };
        if (!data.error) setEventAnalysis(data);
      }
    } catch { /* ignore */ } finally {
      setAnalyzingEvents(false);
    }
  }, [eventReport, analyzingEvents]);

  const totalRules = Object.keys(rules).filter(name => rules[name].action !== "NONE").length;
  const bannedCount = Object.values(rules).filter(r => r.action === "BAN").length;
  const cautionRunning = runningProcesses.filter(p => {
    if (p.trust !== "unknown") return false;
    const ruleKey = p.name.toLowerCase().replace(/\.exe$/i, "");
    return !rules[ruleKey]?.manualControl;
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
      if (p.trust !== "unknown" && p.trust !== "background") return false;
      const ruleKey = p.name.toLowerCase().replace(/\.exe$/i, "");
      if (rules[ruleKey]?.manualControl) return false;
      if (seen.has(p.name)) return false;
      seen.add(p.name);
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
            <span className={styles.eventHealthTitle}>Import and review a saved .evtx event log</span>
            <span className={styles.eventHealthStatus}>
              {eventReport
                ? `${eventReport.fileName} imported - ${eventReport.totalEvents.toLocaleString()} events clustered`
                : "Ready for a Windows Event Viewer export. No live event scanning is used."}
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
              className={styles.importBtn}
              disabled={importingEvents}
              onClick={handleImportEventLog}
            >
              {importingEvents ? "Importing..." : "Import .evtx"}
            </button>
          </div>
        </div>
        {eventImportError && <div className={styles.errorText}>{eventImportError}</div>}

        {!eventReport ? (
          <div className={styles.emptyText}>
            Import a saved Windows Event Viewer .evtx file to see deterministic clusters and optional AI-enhanced health findings here.
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

            {(["needs-attention", "watch", "likely-noise"] as const).map(cat => {
              const catClusters: EventCluster[] = eventReport.clusters.filter(c => c.category === cat);
              if (catClusters.length === 0) return null;
              return (
                <div key={cat} className={styles.categorySection}>
                  <div className={`${styles.categoryHeader} ${styles[cat.replace("-", "")]}`}>
                    <span>{CATEGORY_LABELS[cat]}</span>
                    <span className={styles.categoryCount}>{catClusters.length}</span>
                  </div>
                  <div className={styles.clusterList}>
                    {catClusters.map(cluster => {
                      const lc = LEVEL_COLORS[cluster.level] ?? LEVEL_COLORS[4];
                      const isExpanded = expandedClusters.has(cluster.key);
                      return (
                        <div key={cluster.key} className={styles.clusterRow}>
                          <div className={styles.clusterMain}>
                            <span className={styles.levelBadge} style={{ background: lc.bg, color: lc.color }}>
                              {cluster.levelName}
                            </span>
                            <span className={styles.clusterProvider}>
                              {cluster.provider.replace(/^Microsoft-Windows-/, "")} - {cluster.eventId}
                            </span>
                            <span className={styles.clusterCount}>&times;{cluster.count}</span>
                            <span className={styles.clusterSummary}>{cluster.summary}</span>
                            <button
                              type="button"
                              className={styles.expandBtn}
                              onClick={() => toggleCluster(cluster.key)}
                              aria-label={isExpanded ? "Collapse" : "Expand"}
                            >
                              {isExpanded ? "-" : "+"}
                            </button>
                          </div>
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
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

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
                              {isExpanded ? "-" : "+"}
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
                              {finding.safeNextSteps.length > 0 && (
                                <div className={styles.findingDetailSection}>
                                  <div className={styles.findingDetailTitle}>Safe Next Steps</div>
                                  <ul className={styles.findingDetailList}>
                                    {finding.safeNextSteps.map((s, i) => <li key={i}>{s}</li>)}
                                  </ul>
                                </div>
                              )}
                              {finding.whenToIgnore && (
                                <div className={styles.findingIgnore}>
                                  When to ignore: {finding.whenToIgnore}
                                </div>
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
