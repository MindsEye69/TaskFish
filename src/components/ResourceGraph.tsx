import React from "react";
import styles from "./ResourceGraph.module.css";

interface Props {
  data: number[];
  color: string;
  label: string;
  value: string;
  max?: number;
}

export default function ResourceGraph({ data, color, label, value, max = 100 }: Props) {
  // We want to draw a sparkline
  const width = 100;
  const height = 24;
  
  const points = data.map((val, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * width;
    const y = height - (Math.min(val, max) / max) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className={styles.container}>
      <div className={styles.info}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
      </div>
      <div className={styles.graphWrap}>
        <svg viewBox={`0 0 ${width} ${height}`} className={styles.svg} preserveAspectRatio="none">
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
