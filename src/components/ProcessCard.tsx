"use client";
import { useState, useMemo } from "react";
import IconImage from "./IconImage";
import type { TreeNode, RuleConfig, AiSetupPhase } from "@/lib/types";
import { countAllPids } from "@/lib/processTree";
import styles from "./ProcessCard.module.css";

interface Props {
  node: TreeNode;
  maxRam: number;
  rule?: RuleConfig;
  onClick: () => void;
  onAnalyze?: (e: React.MouseEvent) => void;
  onExpand?: (e: React.MouseEvent) => void;
  onQuickVerify?: () => void;
  isExpandable?: boolean;
  isExpanded?: boolean;
  featured?: boolean;
  history?: { cpu: number; ram: number }[];
  analyzeDisabled?: boolean;
  aiSetupPhase?: AiSetupPhase;
}

const TRUST_LABEL: Record<string, string> = {
  trusted: "Trusted",
  verified: "Verified",
  background: "Background",
  unknown: "Unknown",
};

const CATEGORY_RGB: Record<string, string> = {
  system:     "109, 40, 217",
  user:       "3, 105, 161",
  background: "180, 83, 9",
  unknown:    "185, 28, 28",
  verified:   "34, 197, 94",
};

const GLOW_MAX_MB = 1200;

export default function ProcessCard({
  node,
  maxRam,
  rule,
  onClick,
  onAnalyze,
  onExpand,
  onQuickVerify,
  isExpandable,
  isExpanded,
  featured,
  history = [],
  analyzeDisabled = false,
  aiSetupPhase = "idle",
}: Props) {
  const [iconError, setIconError] = useState(false);
  const ramPct = Math.min(100, (node.ramMB / Math.max(maxRam, 1)) * 100);
  const childCount = useMemo(() => {
    const total = countAllPids(node);
    return node.id < 0 ? total : Math.max(0, total - 1);
  }, [node]);
  const sparkPath = useMemo(() => {
    const points = history.slice(-24);
    if (points.length < 2) return "";
    const maxValue = Math.max(5, ...points.map(p => p.cpu), ...points.map(p => p.ram / 1024));
    return points.map((p, i) => {
      const x = (i / Math.max(points.length - 1, 1)) * 100;
      const y = 28 - (Math.max(p.cpu, p.ram / 1024) / maxValue) * 24;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${Math.max(2, Math.min(28, y)).toFixed(1)}`;
    }).join(" ");
  }, [history]);

  const isVerifiedByRule = rule && rule.action !== "NONE";
  const displayTrust = isVerifiedByRule ? "trusted" : node.trust;
  const displayCategory = isVerifiedByRule
    ? rule!.action === "BAN" ? "unknown"
    : rule!.action === "LIMITED" ? "background"
    : "verified"
    : node.category;

  // Glow intensity is driven by absolute MB so high-RAM cards stay vivid.
  const glowIntensity = Math.min(1, node.ramMB / GLOW_MAX_MB);
  const rgb = CATEGORY_RGB[displayCategory] ?? "255, 255, 255";
  const glowStyle: React.CSSProperties = glowIntensity > 0.04 ? {
    borderColor: `rgba(${rgb}, ${0.15 + glowIntensity * 0.65})`,
    boxShadow: glowIntensity > 0.15
      ? `0 0 ${Math.round(glowIntensity * 22)}px rgba(${rgb}, ${glowIntensity * 0.28}), inset 0 1px 0 rgba(${rgb}, 0.07)`
      : undefined,
  } : {};

  return (
    <div
      id={`proc-${node.id}`}
      className={`${styles.card} ${styles[displayCategory]}${featured ? ` ${styles.featured}` : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      style={glowStyle}
    >
      <div className={styles.top}>
        <span className={`${styles.trustDot} ${styles[displayTrust]}`} />
        {isExpandable && (
          <button
            className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ""}`}
            onClick={(e) => { e.stopPropagation(); onExpand?.(e); }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >{">"}</button>
        )}
        {!iconError ? (
          <IconImage
            name={node.name}
            className={styles.icon}
            onIconError={() => setIconError(true)}
            isSystem={node.category === "system"}
          />
        ) : node.category === "system" ? (
          <div className={styles.iconSystem}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M0 3.449L9.75 2.1V11.719H0V3.449zm0 9.15h9.75V22.2L0 20.811V12.599zm10.663-10.596L24 0v11.719H10.663V2.003zm0 10.596H24V24l-13.337-2.1V12.599z" />
            </svg>
          </div>
        ) : (
          <div
            className={styles.iconFallback}
            style={{ background: `rgba(${rgb},0.18)`, color: `rgba(${rgb},0.9)`, borderColor: `rgba(${rgb},0.3)` }}
          >
            {(node.name || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <span className={styles.name}>{node.name}</span>
      </div>

      <div className={styles.meta}>
        <span className={`${styles.badge} ${styles[displayTrust]}`}>
          {isVerifiedByRule ? "Verified (Rule Applied)" : TRUST_LABEL[node.trust]}
        </span>
        {rule && rule.action && rule.action !== "NONE" && (
          <span className={`${styles.ruleBadge} ${styles[(rule.action || "NONE").toLowerCase()]}`}>
            {rule.action}
          </span>
        )}
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>RAM</span>
          <span className={styles.statValue}>{node.ramMB} MB</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>CPU</span>
          <span className={styles.statValue}>
            {node.cpu < 0.1 && node.cpu > 0 ? "<0.1%" : `${node.cpu.toFixed(1)}%`}
          </span>
        </div>
        <div className={styles.ramBar}>
          <div className={styles.ramBarTrack}>
            <div className={styles.ramBarFill} style={{ width: `${ramPct}%` }} />
          </div>
        </div>
      </div>

      {sparkPath && (
        <svg className={styles.sparkline} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
          <path d={sparkPath} />
        </svg>
      )}

      {!isExpanded && node.helperCounts && Object.keys(node.helperCounts).length > 0 && (
        <div className={styles.helperBadges}>
          {Object.entries(node.helperCounts).map(([name, count]) => (
            <span key={name} className={styles.helperBadge}>+{count} {name}</span>
          ))}
        </div>
      )}

      <div className={styles.cardFooter}>
        {childCount > 0 && (
          <div className={styles.children}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <circle cx="2" cy="2" r="1.5" />
              <circle cx="8" cy="5" r="1.5" />
              <circle cx="2" cy="8" r="1.5" />
              <line x1="2" y1="2" x2="8" y2="5" stroke="currentColor" strokeWidth="0.8" />
              <line x1="2" y1="8" x2="8" y2="5" stroke="currentColor" strokeWidth="0.8" />
            </svg>
            {childCount} {node.id < 0
              ? `process${childCount !== 1 ? "es" : ""}`
              : `subprocess${childCount !== 1 ? "es" : ""}`}
          </div>
        )}
        {onQuickVerify && (
          <button
            className={styles.verifyBtn}
            onClick={(e) => { e.stopPropagation(); onQuickVerify(); }}
          >
            Trust
          </button>
        )}
        {onAnalyze && (
          <button
            className={styles.analyzeBtn}
            disabled={analyzeDisabled}
            title={
              analyzeDisabled
                ? aiSetupPhase === "pulling"
                  ? "Downloading AI model"
                  : aiSetupPhase === "starting"
                    ? "Starting AI engine"
                    : "AI setup unavailable"
                : "Analyze process"
            }
            onClick={(e) => { e.stopPropagation(); onAnalyze(e); }}
          >
            {analyzeDisabled && aiSetupPhase === "pulling" ? "Setting up" : "Analyze"}
          </button>
        )}
      </div>
    </div>
  );
}
