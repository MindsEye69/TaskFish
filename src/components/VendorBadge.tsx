"use client";
import { useState, useRef, useEffect } from "react";
import IconImage from "./IconImage";
import type { VendorGroup } from "@/lib/vendors";
import type { RuleConfig, TreeNode, AiSetupPhase } from "@/lib/types";
import styles from "./VendorBadge.module.css";

interface Props {
  group: VendorGroup;
  systemTotalRam: number;  // total system RAM in MB for scaling the arc
  rules: Record<string, RuleConfig>;
  onSelect: (node: TreeNode) => void;
  onAnalyze: (node: TreeNode) => void;
  aiAvailable?: boolean;
  aiSetupPhase?: AiSetupPhase;
}

const TRUST_COLOR: Record<string, string> = {
  unknown:    "#f87171",
  background: "#f59e0b",
  verified:   "#22c55e",
  trusted:    "#60a5fa",
};

function fmtRam(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export default function VendorBadge({
  group,
  systemTotalRam,
  rules,
  onSelect,
  onAnalyze,
  aiAvailable = true,
  aiSetupPhase = "idle",
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [iconError, setIconError] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (expanded && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const pad = 16; // minimum distance from screen edges
      let shift = 0;

      if (rect.left < pad) {
        shift = pad - rect.left;
      } else if (rect.right > window.innerWidth - pad) {
        shift = (window.innerWidth - pad) - rect.right;
      }

      if (shift !== 0) {
        setDropdownStyle({
          left: `calc(50% + ${shift}px)`
        });
      } else {
        setDropdownStyle({ left: "50%" });
      }
    } else {
      setDropdownStyle({});
    }
  }, [expanded]);

  const ramPct    = Math.min(1, group.totalRam / Math.max(systemTotalRam, 1));
  const r         = 36;
  const cx        = 44;
  const cy        = 44;
  const circ      = 2 * Math.PI * r;
  const dashOff   = circ * (1 - ramPct);
  const trustCol  = TRUST_COLOR[group.trust] ?? "#8888aa";
  const hasUnknown = group.trust === "unknown";

  // Unique SVG filter ID per vendor to avoid cross-contamination
  const filterId = `glow-${group.vendorId.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <div className={styles.wrap}>
      {/* ── Circular badge ─────────────────────────────────────────────── */}
      <button
        className={`${styles.badge} ${expanded ? styles.active : ""} ${hasUnknown ? styles.alertBadge : ""}`}
        style={{ "--accent": group.color, "--accent-rgb": group.accent } as React.CSSProperties}
        onClick={() => setExpanded(e => !e)}
        title={`${group.vendor} · ${group.processes.length} process${group.processes.length !== 1 ? "es" : ""} · ${fmtRam(group.totalRam)} RAM`}
      >
        <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
          <defs>
            <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Outer glow ring when hovered (CSS handles opacity) */}
          <circle cx={cx} cy={cy} r={r + 4} fill="none"
            stroke={group.color} strokeWidth="1" opacity="0.12" className={styles.glowRing}
          />

          {/* Background track */}
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke={`rgba(${group.accent},0.15)`} strokeWidth="5"
          />

          {/* RAM usage arc */}
          {ramPct > 0.01 && (
            <circle
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={group.color}
              strokeWidth="5"
              strokeDasharray={circ}
              strokeDashoffset={dashOff}
              strokeLinecap="round"
              transform={`rotate(-90 ${cx} ${cy})`}
              filter={`url(#${filterId})`}
              className={styles.arc}
            />
          )}

          {/* Fallback Icon — centered in circle (only visible if image failed to load) */}
          {iconError && (
            <text
              x={cx} y={cy + 9}
              textAnchor="middle"
              fill={group.color}
              fontSize={group.icon.length > 2 ? "16" : "22"}
              fontWeight="700"
              fontFamily="'Segoe UI', system-ui, sans-serif"
              className={styles.iconText}
            >
              {group.icon}
            </text>
          )}
        </svg>

        {/* Center Logo Icon */}
        {!iconError && group.processes.length > 0 && (
          <IconImage
            name={group.processes[0].name}
            className={styles.centerIcon}
            onIconError={() => setIconError(true)}
            isSystem={group.processes[0].category === "system"}
          />
        )}

        {/* Trust indicator dot — top-right */}
        <span className={styles.trustDot} style={{ background: trustCol }} />

        {/* Process count — bottom-right */}
        <span className={styles.procCount}>{group.processes.length}</span>
      </button>

      {/* Vendor name + RAM */}
      <div className={styles.label}>
        <span className={styles.vendorName}>{group.vendor}</span>
        <span className={styles.vendorRam}>{fmtRam(group.totalRam)}</span>
      </div>

      {/* ── Expanded process list ──────────────────────────────────────── */}
      {expanded && (
        <div ref={dropdownRef} className={styles.dropdown} style={dropdownStyle}>
          <div className={styles.dropdownHeader}>
            <span style={{ color: group.color, fontWeight: 700 }}>{group.vendor}</span>
            <span className={styles.dropCount}>{group.processes.length} processes · {fmtRam(group.totalRam)}</span>
          </div>
          <div className={styles.procList}>
            {[...group.processes]
              .sort((a, b) => b.ramMB - a.ramMB)
              .map(proc => {
                const rule = rules[proc.name];
                return (
                  <div
                    key={proc.id}
                    className={styles.procRow}
                    onClick={e => { e.stopPropagation(); onSelect(proc); }}
                  >
                    <span className={styles.procDot} style={{
                      background: TRUST_COLOR[proc.trust] ?? "#8888aa"
                    }} />
                    <span className={styles.procName}>{proc.name}</span>
                    <span className={styles.procRam}>{fmtRam(proc.ramMB)}</span>
                    {rule && rule.action !== "NONE" && (
                      <span className={`${styles.rulePill} ${styles[rule.action.toLowerCase()]}`}>
                        {rule.action}
                      </span>
                    )}
                    <button
                      className={styles.analyzeBtn}
                      disabled={!aiAvailable}
                      title={
                        !aiAvailable
                          ? aiSetupPhase === "pulling"
                            ? "Downloading AI model"
                            : aiSetupPhase === "starting"
                              ? "Starting AI engine"
                              : "AI setup unavailable"
                          : "Analyze process"
                      }
                      onClick={e => { e.stopPropagation(); onAnalyze(proc); }}
                    >
                      ›
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
