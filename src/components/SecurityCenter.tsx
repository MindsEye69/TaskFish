"use client";
import { useState, useMemo } from "react";
import type { ProcessInfo, ProcessProfile, RuleConfig } from "@/lib/types";
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
}

const EVENT_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  ban:         { bg: "rgba(248,113,113,0.12)", color: "#f87171", label: "BAN" },
  limited:     { bg: "rgba(245,158,11,0.12)",  color: "#f59e0b", label: "LIMITED" },
  rule:        { bg: "rgba(96,165,250,0.12)",   color: "#60a5fa", label: "RULE" },
  "auto-kill": { bg: "rgba(248,113,113,0.12)", color: "#f87171", label: "AUTO-KILL" },
  kill:        { bg: "rgba(248,113,113,0.12)", color: "#f87171", label: "KILL" },
  unknown:     { bg: "rgba(245,158,11,0.12)",  color: "#f59e0b", label: "UNKNOWN" },
  scan:        { bg: "rgba(34,197,94,0.12)",   color: "#22c55e", label: "SCAN" },
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
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAction, setFilterAction] = useState<"ALL" | "ALLOW" | "LIMITED" | "BAN">("ALL");
  const [profileName, setProfileName] = useState("");

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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>🛡 Security & Safeguards Center</h1>
        <div className={styles.safeguardBanner}>
          <span className={styles.safeguardIcon}>🛡</span>
          <div className={styles.safeguardInfo}>
            <div className={styles.safeguardTitle}>System Safeguards Active</div>
            <div className={styles.safeguardText}>
              Core Windows system processes (e.g. <code>svchost.exe</code>, <code>explorer.exe</code>, <code>lsass.exe</code>) are automatically protected and locked from accidental banning.
            </div>
          </div>
        </div>
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
                        onClick={() => {
                          const proc = runningProcesses.find(p => p.name.toLowerCase() === rule.name.toLowerCase());
                          onAnalyze(rule.name, proc ? proc.id : 0);
                        }}
                      >
                        Analyze
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
                    onClick={() => onAnalyze(proc.name, proc.id)}
                  >
                    Inspect & Vett
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
