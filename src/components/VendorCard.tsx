"use client";
import { useState } from "react";
import type { VendorGroup } from "@/lib/vendors";
import type { RuleConfig } from "@/lib/types";
import ProcessCard from "./ProcessCard";
import styles from "./VendorCard.module.css";

interface Props {
  group: VendorGroup;
  maxRam: number;
  rules: Record<string, RuleConfig>;
  onAnalyze: (name: string, pid: number) => void;
  onSelect: (node: any) => void;
  onQuickVerify?: (node: any) => void;
}

function fmtRam(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export default function VendorCard({ group, maxRam, rules, onAnalyze, onSelect, onQuickVerify }: Props) {
  const [expanded, setExpanded] = useState(false);

  const ramPct = Math.min(100, (group.totalRam / Math.max(maxRam, 1)) * 100);
  const isUnknownGroup = group.trust === "unknown";

  // Best trust color for the accent
  const accentRgb = group.accent;
  const accentColor = group.color;

  return (
    <div
      className={styles.card}
      style={{
        borderColor: expanded
          ? `rgba(${accentRgb}, 0.4)`
          : `rgba(${accentRgb}, 0.18)`,
        boxShadow: expanded
          ? `0 0 24px rgba(${accentRgb}, 0.12), inset 0 1px 0 rgba(${accentRgb}, 0.08)`
          : undefined,
      }}
    >
      {/* Header — always visible */}
      <div
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
      >
        {/* Vendor badge */}
        <div
          className={styles.vendorBadge}
          style={{
            background: `rgba(${accentRgb}, 0.15)`,
            border: `1.5px solid rgba(${accentRgb}, 0.35)`,
            color: accentColor,
          }}
        >
          {group.icon}
        </div>

        {/* Name + subtitle */}
        <div className={styles.vendorInfo}>
          <div className={styles.vendorName}>{group.vendor}</div>
          <div className={styles.vendorSub}>
            {group.processes.length} process{group.processes.length !== 1 ? "es" : ""}
            {isUnknownGroup && (
              <span className={styles.unknownPill}>⚠ Contains unknowns</span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statVal}>{fmtRam(group.totalRam)}</span>
            <span className={styles.statLabel}>RAM</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statVal}>{group.totalCpu.toFixed(1)}%</span>
            <span className={styles.statLabel}>CPU</span>
          </div>
        </div>

        {/* Expand chevron */}
        <button
          className={`${styles.chevron} ${expanded ? styles.chevronOpen : ""}`}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          aria-label={expanded ? "Collapse" : "Expand"}
          style={{ color: accentColor }}
        >
          ▾
        </button>
      </div>

      {/* RAM bar */}
      <div className={styles.ramBarTrack}>
        <div
          className={styles.ramBarFill}
          style={{
            width: `${ramPct}%`,
            background: `linear-gradient(90deg, rgba(${accentRgb},0.7), rgba(${accentRgb},0.4))`,
          }}
        />
      </div>

      {/* Expanded: individual process rows */}
      {expanded && (
        <div className={styles.processesWrap}>
          <div className={styles.processesDivider} style={{ borderColor: `rgba(${accentRgb},0.12)` }} />
          {group.processes.map((node) => (
            <div key={node.id} className={styles.processCardWrap}>
              <ProcessCard
                node={node}
                maxRam={maxRam}
                rule={rules[node.name] || { action: "NONE", autoKillMins: null }}
                onClick={() => onSelect(node)}
                onAnalyze={(e) => { e.stopPropagation(); onAnalyze(node.name, node.id); }}
                onQuickVerify={node.trust === "unknown" && onQuickVerify ? () => onQuickVerify(node) : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
