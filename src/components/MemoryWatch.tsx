"use client";
import { useMemo, useState } from "react";
import type { PageFileConfiguration, ProcessInfo, SystemStats } from "@/lib/types";
import { isPageFileConfigurationHealthy } from "@/lib/pageFileAdvisor";
import styles from "./MemoryWatch.module.css";

type History = Record<string, { cpu: number; ram: number }[]>;
type GuardianLevel = "ok" | "warn" | "critical";

export interface MemoryGuardianState {
  level: GuardianLevel;
  pressure: number;
  freeRamMB: number;
  commitFreeMB: number;
  pageFileRecommended: boolean;
  message: string;
}

interface Props {
  processes: ProcessInfo[];
  processHistory: History;
  latestStats?: SystemStats | null;
  guardian?: MemoryGuardianState;
  pageFileConfiguration?: PageFileConfiguration;
  pageFileScanning?: boolean;
  onScanPageFile?: () => void;
  onSelect: (process: ProcessInfo) => void;
  onLimitGroup?: (name: string, pids: number[]) => void;
  onKillGroup?: (name: string, pids: number[], killTree: boolean) => void;
}

interface MemoryRow {
  key: string;
  name: string;
  ramMB: number;
  cpu: number;
  count: number;
  deltaMB: number;
  trust: ProcessInfo["trust"];
  representative: ProcessInfo;
  pids: number[];
  canKill: boolean;
}

const PROTECTED_KILL_NAMES = new Set([
  "csrss",
  "explorer",
  "lsass",
  "memory compression",
  "registry",
  "services",
  "smss",
  "svchost",
  "system",
  "taskfish",
  "wininit",
  "winlogon",
]);

function normalizeName(name: string) {
  return (name || "").toLowerCase().replace(/\.exe$/i, "");
}

function fmtRam(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function fmtPercent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function storageTierLabel(tier: PageFileConfiguration["volumes"][number]["performanceTier"]) {
  return tier === "nvme" ? "NVMe" : tier === "ssd" ? "SSD" : tier === "hdd" ? "HDD" : "Other";
}

function buildRows(processes: ProcessInfo[], processHistory: History): MemoryRow[] {
  const byName = new Map<string, MemoryRow>();

  for (const proc of processes) {
    const key = normalizeName(proc.name);
    const existing = byName.get(key);
    if (!existing) {
      const history = processHistory[key] ?? [];
      const first = history[0]?.ram ?? proc.ramMB;
      const last = history[history.length - 1]?.ram ?? proc.ramMB;
      byName.set(key, {
        key,
        name: proc.name,
        ramMB: proc.ramMB,
        cpu: proc.cpu,
        count: 1,
        deltaMB: last - first,
        trust: proc.trust,
        representative: proc,
        pids: proc.id > 0 ? [proc.id] : [],
        canKill: !PROTECTED_KILL_NAMES.has(key),
      });
      continue;
    }

    existing.ramMB += proc.ramMB;
    existing.cpu += proc.cpu;
    existing.count += 1;
    if (proc.id > 0) existing.pids.push(proc.id);
    if (proc.ramMB > existing.representative.ramMB) {
      existing.representative = proc;
      existing.name = proc.name;
      existing.trust = proc.trust;
    }
  }

  return [...byName.values()];
}

function MemoryList({
  title,
  rows,
  mode,
  onSelect,
  onLimitGroup,
  onKillGroup,
}: {
  title: string;
  rows: MemoryRow[];
  mode: "usage" | "climb";
  onSelect: (process: ProcessInfo) => void;
  onLimitGroup?: (name: string, pids: number[]) => void;
  onKillGroup?: (name: string, pids: number[], killTree: boolean) => void;
}) {
  return (
    <div className={styles.list}>
      <div className={styles.listTitle}>{title}</div>
      {rows.length === 0 ? (
        <div className={styles.empty}>Watching for movement</div>
      ) : (
        rows.map((row) => (
          <div
            key={`${mode}-${row.key}`}
            className={styles.row}
          >
            <button
              type="button"
              className={styles.rowMain}
              onClick={() => onSelect(row.representative)}
              title={`Open ${row.name}`}
            >
              <span className={`${styles.dot} ${styles[row.trust]}`} />
              <span className={styles.name}>
                {row.name}
                {row.count > 1 && <span className={styles.count}>x{row.count}</span>}
              </span>
              <span className={styles.value}>{fmtRam(mode === "climb" ? Math.max(row.deltaMB, 0) : row.ramMB)}</span>
            </button>
            {onLimitGroup && row.pids.length > 0 ? (
              <button
                type="button"
                className={styles.limitBtn}
                onClick={() => onLimitGroup(row.name, row.pids)}
                title={`Move ${row.name} group to Idle priority`}
              >
                Idle
              </button>
            ) : (
              <span className={styles.limitSpacer} aria-hidden="true" />
            )}
            {onKillGroup && row.canKill && row.pids.length > 0 ? (
              <div className={styles.killActions} aria-label={`${row.name} kill actions`}>
                <button
                  type="button"
                  className={`${styles.targetBtn} ${styles.killBtn}`}
                  onClick={() => onKillGroup(row.name, row.pids, false)}
                  title={`Kill ${row.name} process group only`}
                  aria-label={`Kill ${row.name} process group only`}
                >
                  <span aria-hidden="true">⊙</span>
                </button>
                <button
                  type="button"
                  className={`${styles.targetBtn} ${styles.killTreeBtn}`}
                onClick={() => onKillGroup(row.name, row.pids, true)}
                title={`Kill ${row.name} process trees`}
                aria-label={`Kill ${row.name} process trees`}
              >
                  <span aria-hidden="true">☠</span>
                </button>
              </div>
            ) : (
              <span className={styles.killActions} aria-hidden="true" />
            )}
          </div>
        ))
      )}
    </div>
  );
}

export default function MemoryWatch({ processes, processHistory, latestStats, guardian, pageFileConfiguration, pageFileScanning = false, onScanPageFile, onSelect, onLimitGroup, onKillGroup }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const rows = useMemo(() => buildRows(processes, processHistory), [processes, processHistory]);
  const pageFileHealthy = isPageFileConfigurationHealthy(pageFileConfiguration);
  const totalRam = rows.reduce((sum, row) => sum + row.ramMB, 0);
  const highest = [...rows].sort((a, b) => b.ramMB - a.ramMB).slice(0, 5);
  const climbers = [...rows]
    .filter((row) => row.deltaMB >= 10)
    .sort((a, b) => b.deltaMB - a.deltaMB)
    .slice(0, 5);

  return (
    <section className={`${styles.panel} ${collapsed ? styles.panelCollapsed : ""}`} aria-label="Memory watch">
      <button
        type="button"
        className={styles.summary}
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
        aria-controls="memory-guardian-content"
      >
        <span className={styles.summaryLead}>
          <span className={styles.title}>Memory Guardian</span>
          <span className={`${styles.summaryStatus} ${guardian && guardian.level !== "ok" ? styles[guardian.level] : ""}`}>
            {guardian?.level === "critical" ? "Critical" : guardian?.level === "warn" ? "Attention" : "Stable"}
          </span>
        </span>
        <span className={styles.total}>
          <span>{fmtRam(totalRam)}</span>
          <small>tracked</small>
        </span>
        <span className={`${styles.chevron} ${collapsed ? "" : styles.chevronOpen}`} aria-hidden="true">⌄</span>
      </button>
      {!collapsed && (
        <div id="memory-guardian-content" className={styles.panelContent}>
          {guardian && (
        <div className={`${styles.guardian} ${styles[guardian.level]}`}>
          <div className={styles.guardianCopy}>
            <strong>{guardian.message}</strong>
            <span>
              Free RAM {fmtRam(guardian.freeRamMB)} · commit headroom {fmtRam(guardian.commitFreeMB)} · pressure {fmtPercent(guardian.pressure)}
            </span>
          </div>
          <div className={styles.guardianStats}>
            <span>{latestStats?.pageFileRecommended ? "Pagefile headroom low" : "Pagefile ok"}</span>
          </div>
        </div>
          )}
          <div className={`${styles.pageFileAdvisor} ${pageFileConfiguration ? styles[pageFileConfiguration.advice.kind] : ""} ${pageFileHealthy ? styles.pageFileHealthy : ""}`}>
          <div className={styles.pageFileHeading}>
            <div>
              <div className={styles.listTitle}>Pagefile Advisor</div>
              {pageFileHealthy && (
                <strong className={styles.pageFileStatus}>
                  <span className={styles.pageFileStatusLight} aria-hidden="true" />
                  OK
                </strong>
              )}
            </div>
            {onScanPageFile && (
              <button
                type="button"
                className={styles.pageFileScanButton}
                onClick={onScanPageFile}
                disabled={pageFileScanning}
                title="Run a one-time Windows pagefile check"
              >
                {pageFileScanning ? "Scanning..." : pageFileConfiguration ? "Rescan" : "Scan"}
              </button>
            )}
          </div>
          {pageFileConfiguration && !pageFileHealthy && (
            <>
              <div className={styles.pageFileResultHeading}>
                <strong>{pageFileConfiguration.advice.title}</strong>
                <span className={styles.pageFileMode}>
                  {pageFileConfiguration.management === "automatic" ? "Automatic" :
                    pageFileConfiguration.management === "system-managed" ? "System managed" :
                      pageFileConfiguration.management === "custom" ? "Custom" :
                        pageFileConfiguration.management === "none" ? "None" : "Unavailable"}
                </span>
              </div>
              {pageFileConfiguration.files.length > 0 && (
                <div className={styles.pageFileMetrics}>
                  <span>{fmtRam(pageFileConfiguration.totalAllocatedMB)} allocated</span>
                  <span>{fmtRam(pageFileConfiguration.totalCurrentUsageMB)} in use</span>
                  <span>{fmtRam(pageFileConfiguration.totalPeakUsageMB)} peak</span>
                  <span>{fmtRam(pageFileConfiguration.totalDriveFreeMB)} free on pagefile drive</span>
                </div>
              )}
              <p>{pageFileConfiguration.advice.detail}</p>
              {pageFileConfiguration.files.map(file => (
                <span key={file.path} className={styles.pageFilePath} title={file.path}>
                  {file.path}{file.driveFreeMB !== undefined ? ` · ${fmtRam(file.driveFreeMB)} free` : ""}
                </span>
              ))}
              <div className={`${styles.pageFilePlacement} ${styles[pageFileConfiguration.placement.kind]}`}>
                <div className={styles.pageFilePlacementHeading}>
                  <div className={styles.listTitle}>Placement</div>
                  <strong>{pageFileConfiguration.placement.title}</strong>
                </div>
                <p>{pageFileConfiguration.placement.detail}</p>
                {pageFileConfiguration.placement.candidateDrives.length > 0 && (
                  <span className={styles.pageFileCandidates}>
                    Fast candidates: {pageFileConfiguration.placement.candidateDrives.join(", ")} · requires {fmtRam(pageFileConfiguration.placement.requiredFreeMB)} free
                  </span>
                )}
                {pageFileConfiguration.volumes.length > 0 && (
                  <div className={styles.volumeSurvey} aria-label="Storage volume survey">
                    {pageFileConfiguration.volumes.map(volume => (
                      <span
                        key={volume.drive}
                        className={`${styles.volumeChip} ${styles[volume.performanceTier]} ${volume.containsPageFile ? styles.currentPageFileVolume : ""}`}
                        title={`${volume.diskName || volume.label || volume.drive} · ${volume.busType || "unknown bus"}${volume.mediaType ? ` · ${volume.mediaType}` : ""}`}
                      >
                        <b>{volume.drive}</b> {storageTierLabel(volume.performanceTier)} · {fmtRam(volume.freeMB)} free{volume.containsPageFile ? " · pagefile" : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          </div>
          <div className={`${styles.title} ${styles.memoryUsersTitle}`}>Top memory users</div>
          <div className={styles.grid}>
            <MemoryList title="Highest RAM" rows={highest} mode="usage" onSelect={onSelect} onLimitGroup={onLimitGroup} onKillGroup={onKillGroup} />
            <MemoryList title="Climbing" rows={climbers} mode="climb" onSelect={onSelect} onLimitGroup={onLimitGroup} onKillGroup={onKillGroup} />
          </div>
        </div>
      )}
    </section>
  );
}
