"use client";
import { useState, useEffect } from "react";
import type { ProcessProfile } from "@/lib/types";
import styles from "./Header.module.css";
import ResourceGraph from "./ResourceGraph";

interface Props {
  totalProcesses: number;
  statsHistory: { cpu: number; ram: number }[];
  unknownCount: number;
  loading: boolean;
  onRefresh: () => void;
  view: "list" | "map" | "security";
  banCount?: number;
  onOpenSecurity?: () => void;
  selectedName?: string;
  onBack: () => void;
  lastUpdated: Date | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onGameMode: () => void;
  gameModeActive?: boolean;
  onDeepScan: (forceRescan?: boolean) => void;
  isScanning?: boolean;
  scanProgress?: { current: number; total: number; name: string };
  aiAvailable?: boolean;
  onOpenSettings: () => void;
  rulesActive?: boolean;
  onToggleRules?: () => void;
  profiles?: ProcessProfile[];
  activeProfileId?: string;
  onApplyProfile?: (profileId: string) => void;
}

export default function Header({
  totalProcesses,
  statsHistory,
  unknownCount,
  loading,
  onRefresh,
  view,
  banCount = 0,
  onOpenSecurity,
  selectedName,
  onBack,
  lastUpdated,
  searchQuery,
  onSearchChange,
  onGameMode,
  gameModeActive = false,
  onDeepScan,
  isScanning = false,
  scanProgress = { current: 0, total: 0, name: "" },
  aiAvailable = true,
  onOpenSettings,
  rulesActive = true,
  onToggleRules,
  profiles = [],
  activeProfileId = "manual",
  onApplyProfile,
}: Props) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (lastUpdated) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [lastUpdated]);

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <div className={styles.brand}>
          <div className={styles.logoGroup}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '64px' }}>
              <img
                src="logo.jpg"
                alt="TaskFish"
                style={{ height: '60px', width: 'auto', objectFit: 'contain' }}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.src.includes('logo.jpg')) {
                    img.src = 'logo.png';
                  }
                }}
              />
            </div>
          </div>
          <span className={styles.version}>v0.1.8</span>
        </div>
        
        {view !== "map" ? (
          <div className={styles.navTabs}>
            <button 
              type="button"
              className={`${styles.navTab} ${view !== "security" ? styles.active : ""}`}
              onClick={onBack}
            >
              Processes
            </button>
            <button 
              type="button"
              className={`${styles.navTab} ${view === "security" ? styles.active : ""}`}
              onClick={onOpenSecurity}
            >
              Security Center
              {banCount > 0 && <span className={styles.banBadge}>{banCount}</span>}
            </button>
          </div>
        ) : (
          <>
            <button type="button" className={styles.backBtn} onClick={onBack}>
              Back
            </button>
            <span className={styles.path}>/ {selectedName}</span>
          </>
        )}
      </div>

      {view === "list" && (
        <div className={styles.center}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search processes..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      )}

      <div className={styles.right}>
        {view === "list" && (
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.deepScanBtn}
              onClick={() => onDeepScan()}
              disabled={isScanning || !aiAvailable || unknownCount === 0}
              title={
                !aiAvailable ? "AI unavailable — install/start Ollama and pull a model" :
                unknownCount === 0 ? "No unknown processes to scan" :
                "Analyze all unknown processes"
              }
            >
              {isScanning ? `Scanning ${scanProgress.current}/${scanProgress.total}` : "Scan Unknowns"}
            </button>
            <button
              type="button"
              className={`${styles.rulesToggleBtn} ${rulesActive ? styles.rulesActive : styles.rulesPaused}`}
              onClick={onToggleRules}
              title={rulesActive ? "Rules enforcing — click to pause" : "Rules paused — click to activate"}
            >
              <span className={`${styles.rulesIndicator} ${rulesActive ? styles.rulesIndicatorActive : ""}`} />
              {rulesActive ? "Rules Active" : "Rules Paused"}
            </button>
            <select
              className={styles.profileSelect}
              value={activeProfileId}
              onChange={(e) => onApplyProfile?.(e.target.value)}
              title="Apply process profile"
            >
              <option value="manual">Manual Rules</option>
              {profiles.map(profile => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <button type="button" className={`${styles.gameModeBtn} ${gameModeActive ? styles.gameModeActive : ""}`} onClick={onGameMode}>
              {gameModeActive ? "Release Game Mode" : "Game Mode"}
            </button>
          </div>
        )}
        <div className={styles.stats}>
          <div className={styles.statItem}>
            <span className={styles.statVal}>{totalProcesses}</span>
            <span className={styles.statLabel}>Procs</span>
          </div>
          {statsHistory.length > 0 && (
            <>
              <ResourceGraph
                label="CPU"
                value={`${statsHistory[statsHistory.length - 1].cpu}%`}
                data={statsHistory.map(s => s.cpu)}
                color="#60a5fa"
                max={100}
              />
              <ResourceGraph
                label="RAM"
                value={`${(statsHistory[statsHistory.length - 1].ram / 1024).toFixed(1)} GB`}
                data={statsHistory.map(s => s.ram)}
                color="#a855f7"
                max={32000} // Assuming ~32GB max for scaling visually, or we can use max of data
              />
            </>
          )}
          {unknownCount > 0 && (
            <div className={`${styles.statItem} ${styles.warning}`}>
              <span className={styles.statVal}>{unknownCount}</span>
              <span className={styles.statLabel}>Unknown</span>
            </div>
          )}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.iconBtn} onClick={onRefresh} disabled={loading} title="Refresh">
            <span className={`${styles.icon} ${loading ? styles.spin : ""}`}>R</span>
          </button>
          <button type="button" className={styles.iconBtn} onClick={onOpenSettings} title="Settings">
            <span className={styles.icon}>Settings</span>
          </button>
          <div className={`${styles.statusDot} ${pulse ? styles.pulse : ""}`} />
        </div>
      </div>
    </header>
  );
}
