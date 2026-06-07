import React from "react";
import styles from "./ResourceGraph.module.css";

interface Props {
  data: number[];
  color: string;
  label: string;
  value: string;
  max?: number;
}

const MIN_POINTS = 20;

export default function ResourceGraph({ data, color, label, value, max = 100 }: Props) {
  const uid = label.toLowerCase().replace(/\W+/g, "-");
  const W = 130;
  const H = 40;

  // Always maintain MIN_POINTS width so the graph fills the canvas
  const padded =
    data.length >= MIN_POINTS
      ? data.slice(-MIN_POINTS)
      : [...Array(MIN_POINTS - data.length).fill(0), ...data];

  const toY = (v: number) =>
    H - 2 - (Math.min(Math.max(v, 0), max) / max) * (H - 6);

  const pts = padded.map(
    (v, i) => [(i / (MIN_POINTS - 1)) * W, toY(v)] as [number, number]
  );

  const linePts = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPts = `0,${H} ${linePts} ${W},${H}`;

  const [lx, ly] = pts[pts.length - 1] ?? [W, H];
  const peak = Math.max(...padded);
  const isPeaking = peak > 0 && padded[padded.length - 1] >= peak * 0.88;

  const fillId = `fill-${uid}`;
  const glowId = `glow-${uid}`;
  const peakGlowId = `pglow-${uid}`;

  return (
    <div className={styles.container}>
      <div className={styles.info}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value} style={{ color }}>{value}</span>
      </div>
      <div className={styles.graphWrap}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={styles.svg}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            {/* Soft gradient fill under the line */}
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.30" />
              <stop offset="75%" stopColor={color} stopOpacity="0.04" />
              <stop offset="100%" stopColor={color} stopOpacity="0.00" />
            </linearGradient>

            {/* Line glow bloom */}
            <filter id={glowId} x="-20%" y="-40%" width="140%" height="180%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Stronger glow for peak dot */}
            <filter id={peakGlowId} x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Faint horizontal reference lines */}
          {[0.33, 0.66].map((f) => (
            <line
              key={f}
              x1={0}
              y1={H * f}
              x2={W}
              y2={H * f}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="0.5"
            />
          ))}

          {/* Area fill */}
          <polygon points={areaPts} fill={`url(#${fillId})`} />

          {/* Bloom layer — thicker blurred copy of the line */}
          <polyline
            points={linePts}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeOpacity="0.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${glowId})`}
          />

          {/* Crisp main line */}
          <polyline
            points={linePts}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Live-value dot */}
          <circle
            cx={lx}
            cy={ly}
            r={2.5}
            fill={color}
            filter={`url(#${isPeaking ? peakGlowId : glowId})`}
            className={isPeaking ? styles.peakDot : styles.dot}
          />
        </svg>
      </div>
    </div>
  );
}
