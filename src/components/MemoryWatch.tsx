"use client";
import { useMemo } from "react";
import type { ProcessInfo } from "@/lib/types";
import styles from "./MemoryWatch.module.css";

type History = Record<string, { cpu: number; ram: number }[]>;

interface Props {
  processes: ProcessInfo[];
  processHistory: History;
  onSelect: (process: ProcessInfo) => void;
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
}

function normalizeName(name: string) {
  return (name || "").toLowerCase().replace(/\.exe$/i, "");
}

function fmtRam(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
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
      });
      continue;
    }

    existing.ramMB += proc.ramMB;
    existing.cpu += proc.cpu;
    existing.count += 1;
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
}: {
  title: string;
  rows: MemoryRow[];
  mode: "usage" | "climb";
  onSelect: (process: ProcessInfo) => void;
}) {
  return (
    <div className={styles.list}>
      <div className={styles.listTitle}>{title}</div>
      {rows.length === 0 ? (
        <div className={styles.empty}>Watching for movement</div>
      ) : (
        rows.map((row) => (
          <button
            key={`${mode}-${row.key}`}
            type="button"
            className={styles.row}
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
        ))
      )}
    </div>
  );
}

export default function MemoryWatch({ processes, processHistory, onSelect }: Props) {
  const rows = useMemo(() => buildRows(processes, processHistory), [processes, processHistory]);
  const totalRam = rows.reduce((sum, row) => sum + row.ramMB, 0);
  const highest = [...rows].sort((a, b) => b.ramMB - a.ramMB).slice(0, 5);
  const climbers = [...rows]
    .filter((row) => row.deltaMB >= 10)
    .sort((a, b) => b.deltaMB - a.deltaMB)
    .slice(0, 5);

  return (
    <section className={styles.panel} aria-label="Memory watch">
      <div className={styles.summary}>
        <div>
          <div className={styles.eyebrow}>Memory Watch</div>
          <div className={styles.title}>Top memory users</div>
        </div>
        <div className={styles.total}>
          <span>{fmtRam(totalRam)}</span>
          <small>tracked</small>
        </div>
      </div>
      <div className={styles.grid}>
        <MemoryList title="Highest RAM" rows={highest} mode="usage" onSelect={onSelect} />
        <MemoryList title="Climbing" rows={climbers} mode="climb" onSelect={onSelect} />
      </div>
    </section>
  );
}
