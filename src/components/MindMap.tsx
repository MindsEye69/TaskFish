"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProcessInfo, TreeNode } from "@/lib/types";
import { findNode, collectTree } from "@/lib/processTree";
import styles from "./MindMap.module.css";

interface Props {
  selected: TreeNode;
  allProcesses: ProcessInfo[];
  roots: TreeNode[];
  onNavigate: (node: TreeNode) => void;
  onAnalyze: (node: TreeNode) => void;
  onKilled: (ids: number[]) => void;
}

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export default function MindMap({ selected, allProcesses, roots, onNavigate, onAnalyze, onKilled }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(wrapRef);
  const [killing, setKilling] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const cx = w / 2;
  const cy = h / 2;

  // Find the full TreeNode for selected (to get real children)
  const treeNode = findNode(roots, selected.id) ?? selected;
  const children = treeNode.children;

  // Find parent
  const parent = allProcesses.find((p) => p.id === selected.ppid && p.id !== selected.id);
  const parentTree = parent ? findNode(roots, parent.id) : null;

  // Radial child positions — fan on right side if ≤ 8, full circle otherwise
  const childRadius = Math.min(w, h) * 0.34;
  const useFan = children.length <= 10;
  const fanStart = useFan ? -Math.PI * 0.65 : 0;
  const fanEnd   = useFan ?  Math.PI * 0.65 : Math.PI * 2;

  const childPositions = children.map((child, i) => {
    const t = children.length === 1 ? 0.5 : i / (children.length - 1);
    const angle = fanStart + t * (fanEnd - fanStart);
    return {
      child,
      x: cx + childRadius * Math.cos(angle),
      y: cy + childRadius * Math.sin(angle),
    };
  });

  // Parent position — upper-left
  const parentX = cx - childRadius * 0.75;
  const parentY = cy - childRadius * 0.55;

  const handleKill = useCallback(async () => {
    setKilling(true);
    setConfirm(false);
    try {
      const dead = collectTree(treeNode).map((n) => n.id);
      
      if (selected.id < 0) {
        // It's a virtual group node, kill all its direct children
        await Promise.all(
          treeNode.children.map((child) =>
            window.electron
              ? window.electron.killProcess(child.id, true)
              : fetch("/api/kill", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ pid: child.id, killTree: true }),
                })
          )
        );
      } else {
        if (window.electron) {
          await window.electron.killProcess(selected.id, true);
        } else {
          await fetch("/api/kill", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pid: selected.id, killTree: true }),
          });
        }
      }
      
      onKilled(dead);
    } finally {
      setKilling(false);
    }
  }, [selected.id, treeNode, onKilled]);

  const SAFE_SYSTEM = ["system", "lsass", "csrss", "winlogon", "wininit", "services", "smss"];
  const isSafeToKill = !SAFE_SYSTEM.includes(selected.name.toLowerCase());

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {/* SVG line layer */}
      <svg className={styles.svg} viewBox={`0 0 ${w} ${h}`}>
        {/* Lines to children */}
        {childPositions.map(({ child, x, y }) => (
          <g key={child.id}>
            <path
              className={styles.line}
              d={`M ${cx} ${cy} Q ${(cx + x) / 2} ${cy} ${x} ${y}`}
            />
            <circle className={styles.connector} cx={x} cy={y} r={4} />
          </g>
        ))}
        {/* Line to parent */}
        {parentTree && (
          <path
            className={styles.line}
            d={`M ${cx} ${cy} Q ${(cx + parentX) / 2} ${cy - 40} ${parentX} ${parentY}`}
            style={{ strokeDasharray: "3 8" }}
          />
        )}
      </svg>

      {/* Parent chip */}
      {parentTree && (
        <div className={styles.parent} style={{ left: parentX, top: parentY }}>
          <div className={styles.parentChip} onClick={() => onNavigate(parentTree)}>
            <span className={styles.parentLabel}>parent</span>
            {parentTree.name}
          </div>
        </div>
      )}

      {/* Child nodes */}
      {childPositions.map(({ child, x, y }, i) => (
        <div
          key={child.id}
          className={styles.child}
          style={{ left: x, top: y, "--delay": `${i * 0.04}s` } as React.CSSProperties}
          onClick={() => onNavigate(child)}
        >
          <div className={`${styles.childCard} ${styles[child.category]}`}>
            <div className={styles.childTop}>
              <span className={`${styles.childDot} ${styles[child.trust]}`} />
              <span className={styles.childName}>{child.name}</span>
              <span className={styles.childRam}>{child.ramMB}MB</span>
            </div>
            {child.children.length > 0 && (
              <div className={styles.childSubs}>
                +{child.children.length} subprocess{child.children.length !== 1 ? "es" : ""}
              </div>
            )}
          </div>
        </div>
      ))}

      {children.length === 0 && (
        <div className={styles.noChildren}>No subprocesses</div>
      )}

      {/* Center node */}
      <div className={styles.center} style={{ left: cx, top: cy }}>
        <div className={styles.centerCircle}>
          <div className={`${styles.ring} ${styles[selected.trust]}`} />
          <span className={styles.centerName}>{selected.name}</span>
          <span className={styles.centerRam}>{selected.ramMB} MB</span>
          <span className={styles.centerCpu}>CPU {selected.cpu}s</span>
        </div>

        <div className={styles.centerActions}>
          <button className={styles.analyzeBtn} onClick={() => onAnalyze(selected)}>
            Analyze
          </button>
          {isSafeToKill && (
            <button
              className={styles.killBtn}
              disabled={killing}
              onClick={() => setConfirm(true)}
            >
              {killing ? "Killing…" : `Kill${children.length > 0 ? " Tree" : ""}`}
            </button>
          )}
        </div>
      </div>

      {/* Kill confirm */}
      {confirm && (
        <div className={styles.confirmOverlay} onClick={() => setConfirm(false)}>
          <div className={styles.confirmBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.confirmTitle}>Kill {selected.name}?</div>
            <div className={styles.confirmMsg}>
              {children.length > 0
                ? `This will terminate "${selected.name}" and all ${collectTree(treeNode).length - 1} of its subprocesses. This cannot be undone.`
                : `This will terminate "${selected.name}". This cannot be undone.`}
            </div>
            <div className={styles.confirmBtns}>
              <button className={styles.confirmCancel} onClick={() => setConfirm(false)}>Cancel</button>
              <button className={styles.confirmKill} onClick={handleKill}>
                Kill {children.length > 0 ? "Tree" : "Process"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
