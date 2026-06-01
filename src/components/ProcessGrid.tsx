"use client";
import { useMemo, useState } from "react";
import type { TreeNode, RuleConfig, AiSetupPhase } from "@/lib/types";
import { buildVendorGroups } from "@/lib/vendors";
import ProcessCard from "./ProcessCard";
import VendorBadge from "./VendorBadge";
import styles from "./ProcessGrid.module.css";

type Filter = "all" | "trusted" | "verified" | "background" | "unknown";
type Sort   = "ram" | "cpu" | "name" | "children";

interface Props {
  roots: TreeNode[];
  rules: Record<string, RuleConfig>;
  processHistory?: Record<string, { cpu: number; ram: number }[]>;
  systemTotalRam?: number;  // total system RAM in MB for arc scaling
  onSelect: (node: TreeNode) => void;
  onAnalyze: (node: TreeNode) => void;
  onQuickVerify: (node: TreeNode) => void;
  aiAvailable?: boolean;
  aiSetupPhase?: AiSetupPhase;
}

function historyKey(name: string) {
  return (name || "").toLowerCase().replace(/\.exe$/i, "");
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",        label: "All"        },
  { key: "trusted",    label: "System"     },
  { key: "verified",   label: "Apps"       },
  { key: "background", label: "Background" },
  { key: "unknown",    label: "Unknown"    },
];

const TIER_KEYS = ["unknown", "user", "system", "background"] as const;
type TierKey = typeof TIER_KEYS[number];

const TIER_META: Record<TierKey, { label: string; catClass: string }> = {
  unknown:    { label: "Unknown",    catClass: "unknown"    },
  user:       { label: "Apps",       catClass: "user"       },
  system:     { label: "System",     catClass: "system"     },
  background: { label: "Background", catClass: "background" },
};

function effectiveTier(node: TreeNode, rule?: RuleConfig): TierKey {
  if (rule?.manualControl) {
    if (node.category === "system")     return "system";
    if (node.category === "background") return "background";
    return "user";
  }
  if (rule && rule.action !== "NONE") {
    if (rule.action === "BAN")     return "unknown";
    if (rule.action === "LIMITED") return "background";
    return node.category === "system" ? "system" : "user";
  }
  if (node.category === "system")     return "system";
  if (node.category === "background") return "background";
  if (node.trust === "unknown")       return "unknown";
  return "user";
}

const FEATURED_MIN_MB  = 250;
const FEATURED_PER_TIER = 2;

function fmtRam(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function getFeaturedIds(nodes: TreeNode[]): Set<number> {
  const ids = new Set<number>();
  [...nodes]
    .sort((a, b) => b.ramMB - a.ramMB)
    .slice(0, FEATURED_PER_TIER)
    .forEach(n => { if (n.ramMB >= FEATURED_MIN_MB) ids.add(n.id); });
  return ids;
}

function sortNodes(nodes: TreeNode[], sort: Sort): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (sort === "ram")      return b.ramMB - a.ramMB;
    if (sort === "cpu")      return b.cpu - a.cpu;
    if (sort === "children") return b.children.length - a.children.length;
    return a.name.localeCompare(b.name);
  });
}

export default function ProcessGrid({
  roots,
  rules,
  processHistory = {},
  systemTotalRam = 20000,
  onSelect,
  onAnalyze,
  onQuickVerify,
  aiAvailable = true,
  aiSetupPhase = "idle",
}: Props) {
  const [filter, setFilter]           = useState<Filter>("all");
  const [sort, setSort]               = useState<Sort>("ram");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [vendorGrouped, setVendorGrouped] = useState(true);

  const toggleExpand = (id: number) => setExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const flat   = useMemo(() => roots, [roots]);
  const maxRam = useMemo(() => Math.max(...flat.map(n => n.ramMB), 1), [flat]);

  const counts: Record<Filter, number> = useMemo(() => ({
    all:        flat.length,
    trusted:    flat.filter(n => n.trust === "trusted").length,
    verified:   flat.filter(n => n.trust === "verified").length,
    background: flat.filter(n => effectiveTier(n, rules[historyKey(n.name)]) === "background").length,
    unknown:    flat.filter(n => effectiveTier(n, rules[historyKey(n.name)]) === "unknown").length,
  }), [flat, rules]);

  // Build tiers; rule-aware placement.
  const tiers = useMemo(() =>
    TIER_KEYS
      .map(key => ({
        key,
        ...TIER_META[key],
        nodes: sortNodes(flat.filter(n => effectiveTier(n, rules[historyKey(n.name)]) === key), sort),
      }))
      .filter(t => t.nodes.length > 0),
  [flat, rules, sort]);

  const displayed = useMemo(() => {
    if (filter === "all") return [];
    const list = filter === "unknown" || filter === "background"
      ? flat.filter(n => effectiveTier(n, rules[historyKey(n.name)]) === filter)
      : filter === "verified"
        ? flat.filter(n => n.trust === "verified")
        : flat.filter(n => n.trust === filter);
    return sortNodes(list, sort);
  }, [flat, filter, rules, sort]);

  const renderCard = (node: TreeNode, featured: boolean, inUnknownTier = false) => {
    const isExpanded  = expandedIds.has(node.id);
    const hasChildren = node.children.length > 0;
    return (
      <div
        key={node.id}
        className={[
          styles.groupBlock,
          isExpanded ? styles.groupExpanded : "",
          featured && !isExpanded ? styles.featuredBlock : "",
        ].join(" ")}
      >
        <ProcessCard
          node={node}
          maxRam={maxRam}
          rule={rules[historyKey(node.name)] || { action: "NONE", autoKillMins: null }}
          history={processHistory[historyKey(node.name)]}
          isExpandable={hasChildren}
          isExpanded={isExpanded}
          onExpand={() => toggleExpand(node.id)}
          onClick={() => onSelect(node)}
          onAnalyze={() => onAnalyze(node)}
          analyzeDisabled={!aiAvailable}
          aiSetupPhase={aiSetupPhase}
          onQuickVerify={inUnknownTier ? () => onQuickVerify(node) : undefined}
          featured={featured}
        />
        {isExpanded && (
          <div className={styles.childGrid}>
            {node.children.map(child => (
              <ProcessCard
                key={child.id}
                node={child}
                maxRam={maxRam}
                rule={rules[historyKey(child.name)] || { action: "NONE", autoKillMins: null }}
                history={processHistory[historyKey(child.name)]}
                onClick={() => onSelect(child)}
                onAnalyze={() => onAnalyze(child)}
                analyzeDisabled={!aiAvailable}
                aiSetupPhase={aiSetupPhase}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.filters}>
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            className={`${styles.filterBtn} ${filter === key ? `${styles.active} ${styles[key]}` : ""}`}
            onClick={() => setFilter(key)}
          >
            {key !== "all" && <span className={`${styles.filterDot} ${styles[key]}`} />}
            {label}
            <span className={styles.count}>{counts[key]}</span>
          </button>
        ))}
        <div className={styles.sortWrap}>
          <span className={styles.sortLabel}>Sort</span>
          <select className={styles.sortSelect} value={sort} onChange={e => setSort(e.target.value as Sort)}>
            <option value="ram">RAM</option>
            <option value="cpu">CPU</option>
            <option value="name">Name</option>
            <option value="children">Children</option>
          </select>
        </div>
        {/* Vendor group toggle; only relevant in "all" view. */}
        {filter === "all" && (
          <button
            className={`${styles.groupToggle} ${vendorGrouped ? styles.groupToggleOn : ""}`}
            onClick={() => setVendorGrouped(v => !v)}
            title={vendorGrouped ? "Switch to individual process view" : "Group by vendor"}
          >
            {vendorGrouped ? "Grouped" : "All Processes"}
          </button>
        )}
      </div>

      <div className={styles.content}>
        {filter === "all" ? (
          tiers.length === 0 ? (
            <div className={styles.empty}>No processes found.</div>
          ) : (
            tiers.map(tier => {
              const isUnknown   = tier.key === "unknown";
              // Vendor grouping applies to user + background tiers only
              const canGroup = vendorGrouped && (tier.key === "user" || tier.key === "background");

              const totalRam = tier.nodes.reduce((s, n) => s + n.ramMB, 0);

              return (
                <div
                  key={tier.key}
                  className={`${styles.tier}${isUnknown ? ` ${styles.tierUnknown}` : ""}`}
                >
                  <div className={styles.tierHeader}>
                    <span className={`${styles.tierDot} ${styles[tier.catClass]}`} />
                    <span className={styles.tierName}>{tier.label}</span>
                    <span className={styles.tierCount}>{tier.nodes.length}</span>
                    <span className={styles.tierRam}>{fmtRam(totalRam)}</span>
                    <div className={styles.tierLine} />
                  </div>

                  {canGroup ? (() => {
                    const { vendors, ungrouped } = buildVendorGroups(tier.nodes);
                    const featuredIds = getFeaturedIds(ungrouped);
                    return (
                      <div>
                        {/* Globally trusted badge row. */}
                        {vendors.length > 0 && (
                          <div className={styles.trustedSection}>
                            <div className={styles.trustedHeader}>
                              <span className={styles.trustedLabel}>Globally Trusted</span>
                              <span className={styles.trustedMeta}>
                                {vendors.length} compan{vendors.length !== 1 ? "ies" : "y"}
                                {" / "}
                                {vendors.reduce((s, v) => s + v.processes.length, 0)} processes
                              </span>
                            </div>
                            <div className={styles.badgeGrid}>
                              {vendors.map(group => (
                                <VendorBadge
                                  key={group.vendorId}
                                  group={group}
                                  systemTotalRam={systemTotalRam}
                                  rules={rules}
                                  onSelect={onSelect}
                                  onAnalyze={onAnalyze}
                                  aiAvailable={aiAvailable}
                                  aiSetupPhase={aiSetupPhase}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Individual ungrouped cards. */}
                        {ungrouped.length > 0 && (
                          <div className={styles.tierGrid}>
                            {ungrouped.map(node => renderCard(node, featuredIds.has(node.id), isUnknown))}
                          </div>
                        )}
                      </div>
                    );
                  })() : (
                    <div className={styles.tierGrid}>
                      {(() => {
                        const featuredIds = getFeaturedIds(tier.nodes);
                        return tier.nodes.map(node =>
                          renderCard(node, featuredIds.has(node.id), isUnknown)
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : (
          displayed.length === 0 ? (
            <div className={styles.empty}>No processes match this filter.</div>
          ) : (
            <div className={styles.grid}>
              {(() => {
                const featuredIds = getFeaturedIds(displayed);
                return displayed.map(node => renderCard(node, featuredIds.has(node.id)));
              })()}
            </div>
          )
        )}
      </div>
    </div>
  );
}
