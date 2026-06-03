"use client";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import type { AnalysisResult, ProcessInfo, TreeNode, RuleConfig, ProcessProfile, AiSetupPhase } from "@/lib/types";
import { MANUAL_PROFILE_ID } from "@/lib/profiles";
import { buildTree, findNode, groupWithHelpers } from "@/lib/processTree";
import Header from "@/components/Header";
import ProcessGrid from "@/components/ProcessGrid";
import MindMap from "@/components/MindMap";
import AnalysisDrawer from "@/components/AnalysisDrawer";
import SecurityCenter from "@/components/SecurityCenter";

interface ApiResponse {
  processes: ProcessInfo[];
  totalRAM: number;
  totalCPU: number;
  unknownCount: number;
  error?: string;
}

type ProcessHistory = Record<string, { cpu: number; ram: number }[]>;
type AuditEvent = { id: string; ts: number; type: string; message: string; details?: unknown };

const DEFAULT_SETTINGS = {
  graphPollMs: 3000,
  processPollMs: 5000,
  notificationsEnabled: true,
  rulesActive: true,
};

function normalizeName(name: string) {
  return (name || "").toLowerCase().replace(/\.exe$/i, "");
}

function processMatches(node: TreeNode, query: string): boolean {
  const lower = query.trim().toLowerCase();
  if (!lower) return true;
  const fields = [
    node.name,
    normalizeName(node.name),
    String(node.id),
    node.vendor ?? "",
    node.execPath ?? "",
    node.category,
    node.trust,
  ];
  return fields.some(field => field.toLowerCase().includes(lower))
    || node.children.some(child => processMatches(child, lower));
}

export default function Home() {
  const [processes, setProcesses]       = useState<ProcessInfo[]>([]);
  const [roots, setRoots]               = useState<TreeNode[]>([]);
  const [groups, setGroups]             = useState<TreeNode[]>([]);
  const [rules, setRules]               = useState<Record<string, RuleConfig>>({});

  const [totalRAM, setTotalRAM]          = useState(0);
  const [unknownCount, setUnknownCount] = useState(0);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);

  const [view, setView]               = useState<"list" | "map" | "security">("list");
  const [selected, setSelected]       = useState<TreeNode | null>(null);
  const [analysisTarget, setAnalysisTarget] = useState<{ name: string; pid: number } | null>(null);
  const [analyzeKey, setAnalyzeKey] = useState(0);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [graphPollMs, setGraphPollMs] = useState(3000);
  const [processPollMs, setProcessPollMs] = useState(5000);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [gameModeActive, setGameModeActive] = useState(false);
  const [rulesActive, setRulesActive] = useState(true);
  const [profiles, setProfiles] = useState<ProcessProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState(MANUAL_PROFILE_ID);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiSetupPhase, setAiSetupPhase] = useState<AiSetupPhase>("idle");
  const [aiSetupError, setAiSetupError] = useState<string | undefined>();
  const [aiPullProgress, setAiPullProgress] = useState<{ completed: number; total: number } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  
  const [statsHistory, setStatsHistory] = useState<{ cpu: number, ram: number }[]>([]);
  const [processHistory, setProcessHistory] = useState<ProcessHistory>({});
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rulesRef = useRef<Record<string, RuleConfig>>({});
  const rulesActiveRef = useRef(true);
  const idleTrackerRef = useRef<Record<string, { lastCpu: number, idleSince: number }>>({});
  const isFetchingRef = useRef(false);
  const isStatsFetchingRef = useRef(false);
  const aiSetupRequestedRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const notifiedUnknownRef = useRef<Set<string>>(new Set());
  const gameModePidsRef = useRef<Set<number>>(new Set());
  const webLimitedPidsRef = useRef<Set<number>>(new Set());
  const enforcementActionCooldownRef = useRef<Record<string, number>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem("taskfish-settings");
      if (!raw) return;
      const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      setGraphPollMs(parsed.graphPollMs);
      setProcessPollMs(parsed.processPollMs);
      setNotificationsEnabled(parsed.notificationsEnabled);
      setRulesActive(parsed.rulesActive ?? true);
    } catch {}
  }, []);

  useEffect(() => {
    if (!window.electron) return;
    window.electron.getBackgroundEnforcement()
      .then(({ rulesActive }) => setRulesActive(rulesActive))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!window.electron?.onOpenSecurityCenter) return;
    return window.electron.onOpenSecurityCenter(() => {
      setSelected(null);
      setView("security");
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("taskfish-settings", JSON.stringify({ graphPollMs, processPollMs, notificationsEnabled, rulesActive }));
    } catch {}
  }, [graphPollMs, processPollMs, notificationsEnabled, rulesActive]);

  useEffect(() => { rulesActiveRef.current = rulesActive; }, [rulesActive]);

  useEffect(() => {
    if (window.electron) {
      window.electron.getAuditLog()
        .then(entries => setAuditEvents(entries.slice(-30).reverse()))
        .catch(() => {});
      return;
    }
    fetch("/api/audit")
      .then(r => r.ok ? r.json() : { events: [] })
      .then(data => setAuditEvents((data.events ?? []).slice(-30).reverse()))
      .catch(() => {});
  }, []);

  const addAuditEvent = useCallback((type: string, message: string, details: unknown = {}, persist = true) => {
    const event = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, ts: Date.now(), type, message, details };
    setAuditEvents(prev => [event, ...prev].slice(0, 30));
    if (!persist) return;
    if (window.electron) {
      window.electron.appendAudit(type, message, details).catch(() => {});
      return;
    }
    fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, message, details }),
    }).catch(() => {});
  }, []);

  const handleToggleRules = useCallback(() => {
    setRulesActive(prev => {
      const next = !prev;
      addAuditEvent("rules", next ? "Rule enforcement enabled" : "Rule enforcement paused", {}, false);
      window.electron?.setBackgroundEnforcement(next).catch(() => {});
      return next;
    });
  }, [addAuditEvent]);

  const sendNotification = useCallback(async (title: string, body: string) => {
    if (!notificationsEnabled) return;
    if (window.electron) {
      await window.electron.notify(title, body).catch(() => {});
      return;
    }
    if ("Notification" in window) {
      const show = () => new Notification(title, { body });
      if (Notification.permission === "granted") show();
      else if (Notification.permission !== "denied") {
        const permission = await Notification.requestPermission();
        if (permission === "granted") show();
      }
    }
  }, [notificationsEnabled]);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const startAiSetup = useCallback((force = false) => {
    if (!window.electron?.startAiService) return;
    if (aiSetupRequestedRef.current && !force) return;
    aiSetupRequestedRef.current = true;
    setAiSetupPhase("starting");
    setAiSetupError(undefined);
    setAiAvailable(false);
    window.electron.startAiService().catch(() => {
      setAiSetupPhase("error");
      setAiSetupError("AI setup retry failed");
      setAiAvailable(false);
    });
  }, []);

  const refreshAiAvailability = useCallback(async () => {
    try {
      if (window.electron) {
        const status = await window.electron.getAiStatus?.() ?? { phase: "idle" };
        const reportedPhase = (status.phase ?? "idle") as AiSetupPhase;
        const phase = reportedPhase === "idle" && aiSetupRequestedRef.current ? "starting" : reportedPhase;
        setAiSetupPhase(phase);
        setAiSetupError(status.error);
        if (phase === "ready") {
          setAiAvailable(true);
          return true;
        }
        setAiAvailable(false);
        return false;
      }

      const res = await fetch("/api/analyze/status");
      const data = await res.json() as { available?: boolean };
      const available = data.available === true;
      setAiAvailable(available);
      setAiSetupPhase(available ? "ready" : "error");
      setAiSetupError(available ? undefined : "Ollama is not running or no model is installed");
      return available;
    } catch {
      setAiAvailable(false);
      setAiSetupPhase("error");
      setAiSetupError("AI status check failed");
      return false;
    }
  }, []);

  const updateProcessHistory = useCallback((current: ProcessInfo[]) => {
    setProcessHistory(prev => {
      const next: ProcessHistory = {};
      for (const proc of current) {
        const key = normalizeName(proc.name);
        next[key] = [...(prev[key] ?? []), { cpu: proc.cpu, ram: proc.ramMB }].slice(-60);
      }
      return next;
    });
  }, []);

  const checkAutoKill = useCallback((currentGroups: TreeNode[]) => {
    const now = Date.now();
    const tracker = idleTrackerRef.current;
    const currentRules = rulesRef.current;
    
    for (const g of currentGroups) {
      const rule = currentRules[g.name];
      if (rule && rule.autoKillMins) {
        const targetName = normalizeName(g.name);
        const killTargets = g.children.filter(child => normalizeName(child.name) === targetName && child.id > 0);
        const state = tracker[g.name];
        if (!state) {
          tracker[g.name] = { lastCpu: g.cpu, idleSince: now };
        } else {
          if (state.lastCpu === g.cpu) {
            const idleMins = (now - state.idleSince) / 60000;
            if (idleMins >= rule.autoKillMins) {
              if (killTargets.length === 0) {
                delete tracker[g.name];
                continue;
              }
              addAuditEvent("auto-kill", `Auto-killed ${g.name} after ${rule.autoKillMins} idle minute(s)`);
              sendNotification("TaskFish auto-kill", `${g.name} was inactive for ${rule.autoKillMins} minute(s).`);
              killTargets.forEach(child => {
                if (window.electron) {
                  window.electron.killProcess(child.id, true).catch(() => {});
                } else {
                  fetch("/api/kill", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ pid: child.id, killTree: true })
                  });
                }
              });
              delete tracker[g.name];
            }
          } else {
            tracker[g.name] = { lastCpu: g.cpu, idleSince: now };
          }
        }
      } else {
        delete tracker[g.name];
      }
    }
  }, [addAuditEvent, sendNotification]);

  const enforceRules = useCallback(async (currentProcesses: ProcessInfo[], currentRules: Record<string, RuleConfig>) => {
    const processRefs = currentProcesses.map(p => ({ id: p.id, name: normalizeName(p.name) }));
    if (window.electron) {
      const result = await window.electron.enforceRules(processRefs, currentRules).catch(() => null);
      const now = Date.now();
      for (const action of result?.actions ?? []) {
        const key = `${action.type}:${action.name}:${action.pid}`;
        if ((enforcementActionCooldownRef.current[key] ?? 0) > now) continue;
        enforcementActionCooldownRef.current[key] = now + 60000;
        addAuditEvent(action.type.toLowerCase(), `${action.name} rule applied`, action, false);
        if (action.type === "BAN") continue;
        const notificationTitle =
          action.type === "LIMITED" ? "TaskFish limited a process" :
          "TaskFish safety guard";
        const notificationBody =
          action.type === "LIMITED" ? `${action.name} was moved to idle priority.` :
          `${action.name} was protected from an unsafe rule.`;
        sendNotification(notificationTitle, notificationBody);
      }
      return;
    }

    const currentLimited = new Set<number>();
    for (const proc of processRefs) {
      const rule = currentRules[proc.name];
      if (!rule || rule.action === "NONE") continue;
      if (rule.action === "BAN") {
        await fetch("/api/kill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid: proc.id, killTree: true }),
        });
        addAuditEvent("ban", `Blocked banned process ${proc.name}`, { pid: proc.id });
      } else if (rule.action === "LIMITED") {
        currentLimited.add(proc.id);
        await fetch("/api/process-control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid: proc.id, priority: "Idle" }),
        });
        if (!webLimitedPidsRef.current.has(proc.id)) {
          addAuditEvent("limited", `Limited ${proc.name} to idle priority`, { pid: proc.id });
        }
      }
    }
    for (const pid of [...webLimitedPidsRef.current]) {
      if (!currentLimited.has(pid)) {
        await fetch("/api/process-control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid, priority: "Normal" }),
        }).catch(() => null);
      }
    }
    webLimitedPidsRef.current = currentLimited;
  }, [addAuditEvent, sendNotification]);

  const fetchRules = useCallback(async () => {
    try {
      let data;
      if (window.electron) {
        data = { rules: await window.electron.getRules() };
      } else {
        const res = await fetch("/api/rules");
        data = await res.json();
      }
      if (data.rules) {
        const normalized: Record<string, RuleConfig> = {};
        Object.entries(data.rules).forEach(([name, val]) => {
          if (typeof val === "string") {
            normalized[name] = { action: val as any, autoKillMins: null };
          } else if (val && typeof val === "object") {
            normalized[name] = {
              action: (val as any).action || "NONE",
              autoKillMins: (val as any).autoKillMins !== undefined ? (val as any).autoKillMins : null,
              ...(val as any).manualControl && { manualControl: true },
              ...(val as any).overrideTrust && { overrideTrust: (val as any).overrideTrust },
            };
          } else {
            normalized[name] = { action: "NONE", autoKillMins: null };
          }
        });
        setRules(normalized);
        rulesRef.current = normalized;
        return normalized;
      }
    } catch (e) {
      console.error("Failed to fetch rules", e);
    }
    return rulesRef.current;
  }, []);

  const fetchProfiles = useCallback(async () => {
    try {
      const data = window.electron
        ? { profiles: await window.electron.getProfiles() }
        : await fetch("/api/profiles").then(r => r.json());
      if (data.profiles) {
        setProfiles(data.profiles.profiles ?? []);
        setActiveProfileId(data.profiles.activeProfileId ?? MANUAL_PROFILE_ID);
      }
    } catch (e) {
      console.error("Failed to fetch profiles", e);
    }
  }, []);

  const replaceRules = useCallback((nextRules: Record<string, RuleConfig>) => {
    setRules(nextRules);
    rulesRef.current = nextRules;
  }, []);

  const handleSaveProfile = useCallback(async (name: string) => {
    try {
      const result = window.electron
        ? { profiles: await window.electron.saveProfile(name, rulesRef.current) }
        : await fetch("/api/profiles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "save", name, rules: rulesRef.current }),
          }).then(r => r.json());

      if (result.error) {
        showToast(result.error);
        return;
      }

      setProfiles(result.profiles.profiles ?? []);
      setActiveProfileId(result.profiles.activeProfileId ?? MANUAL_PROFILE_ID);
      addAuditEvent("profile", `Saved profile ${name}`, { name, rules: Object.keys(rulesRef.current).length }, !window.electron);
      showToast(`${name} profile saved`);
    } catch (e) {
      console.error("Failed to save profile", e);
      showToast("Profile could not be saved");
    }
  }, [addAuditEvent, showToast]);

  const fetchProcesses = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (!hasLoadedOnceRef.current) setLoading(true);
    setError(null);
    try {
      let data: ApiResponse;
      if (window.electron) {
        data = await window.electron.getProcesses();
      } else {
        const res = await fetch("/api/processes");
        data = await res.json();
      }

      if (!data) {
        setError("Received no data from system");
        return;
      }
      if (data.error) {
        throw new Error(data.error);
      }

      const flatRoots = buildTree(data.processes || []);
      const newGroups = groupWithHelpers(data.processes || []);

      setProcesses(data.processes);
      setRoots(flatRoots);
      setGroups(newGroups);
      setTotalRAM(data.totalRAM);
      setUnknownCount(data.unknownCount);
      setLastUpdated(new Date());
      updateProcessHistory(data.processes || []);
      const currentRules = await fetchRules();

      const unknownNames = new Set((data.processes || [])
        .filter(p => p.trust === "unknown")
        .map(p => normalizeName(p.name)));
      for (const name of unknownNames) {
        if (!notifiedUnknownRef.current.has(name)) {
          notifiedUnknownRef.current.add(name);
          addAuditEvent("unknown", `New unknown process detected: ${name}`);
          sendNotification("TaskFish found an unknown process", name);
        }
      }

      if (rulesActiveRef.current) {
        await enforceRules(data.processes || [], currentRules);
        checkAutoKill(newGroups);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load processes");
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [fetchRules, checkAutoKill, updateProcessHistory, enforceRules, addAuditEvent, sendNotification]);

  const handleApplyProfile = useCallback(async (profileId: string) => {
    if (profileId === MANUAL_PROFILE_ID) {
      setActiveProfileId(MANUAL_PROFILE_ID);
      showToast("Manual rules active");
      return;
    }

    try {
      const result = window.electron
        ? await window.electron.applyProfile(profileId)
        : await fetch("/api/profiles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "apply", profileId }),
          }).then(r => r.json());

      if (!result.ok) {
        showToast(result.error || "Profile could not be applied");
        return;
      }

      replaceRules(result.rules ?? {});
      setProfiles(result.profiles?.profiles ?? profiles);
      setActiveProfileId(result.profiles?.activeProfileId ?? profileId);
      const profileName = (result.profiles?.profiles ?? profiles).find((p: ProcessProfile) => p.id === profileId)?.name ?? "Profile";
      addAuditEvent("profile", `Applied profile ${profileName}`, { profileId }, !window.electron);
      showToast(`${profileName} profile applied`);
      fetchProcesses();
    } catch (e) {
      console.error("Failed to apply profile", e);
      showToast("Profile could not be applied");
    }
  }, [addAuditEvent, fetchProcesses, profiles, replaceRules, showToast]);

  const fetchStats = useCallback(async () => {
    if (isStatsFetchingRef.current) return;
    try {
      isStatsFetchingRef.current = true;
      let data;
      if (window.electron) {
        data = await window.electron.getStats();
      } else {
        const res = await fetch("/api/stats");
        data = await res.json();
      }
      if (!data.error) {
        setStatsHistory(prev => {
          const next = [...prev, { cpu: data.cpu, ram: data.ram }];
          return next.slice(-20); // Keep last 20 data points
        });
      }
    } catch (e) {
      // ignore
    } finally {
      isStatsFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchProcesses();
    intervalRef.current = setInterval(fetchProcesses, processPollMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchProcesses, processPollMs]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  useEffect(() => {
    fetchStats();
    statsIntervalRef.current = setInterval(fetchStats, graphPollMs);
    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, [fetchStats, graphPollMs]);

  useEffect(() => {
    if (!window.electron) return;
    const unsubStatus = window.electron.onAiSetupStatus?.((status) => {
      const phase = status.phase as AiSetupPhase;
      setAiSetupPhase(phase);
      setAiSetupError(status.error);
      if (phase === "ready") setAiAvailable(true);
      else setAiAvailable(false);
    });
    const unsubProgress = window.electron.onPullProgress?.((progress) => {
      if (!progress.total || progress.status === "success") {
        setAiPullProgress(null);
        return;
      }
      if (progress.completed != null && progress.total > 0) {
        setAiPullProgress({ completed: progress.completed, total: progress.total });
      }
    });
    return () => {
      unsubStatus?.();
      unsubProgress?.();
    };
  }, []);

  useEffect(() => {
    refreshAiAvailability();
    startAiSetup();
  }, [refreshAiAvailability, startAiSetup]);

  useEffect(() => {
    if (view === "map" && selected) {
      const updatedSelected = findNode(roots, selected.id) ?? groups.find(g => g.id === selected.id);
      if (!updatedSelected) {
        setView("list");
        setSelected(null);
      } else {
        setSelected(updatedSelected);
      }
    }
  }, [processes, selected, roots, groups, view]);

  const handleRuleChange = useCallback(async (name: string, config: RuleConfig) => {
    const ruleName = normalizeName(name);
    const ESSENTIAL_PROCESSES = [
      "explorer.exe", "svchost.exe", "lsass.exe", "csrss.exe", 
      "services.exe", "wininit.exe", "winlogon.exe", "smss.exe",
      "taskfish.exe", "node.exe"
    ];
    if (config.action === "BAN" && (ESSENTIAL_PROCESSES.includes(name.toLowerCase()) || ESSENTIAL_PROCESSES.includes(`${ruleName}.exe`))) {
      alert(`Safety Guard Blocked: Banning "${name}" is prevented. Terminating this core system process will crash or lock your Windows operating system.`);
      return;
    }

    setRules(prev => ({ ...prev, [ruleName]: config }));
    rulesRef.current = { ...rulesRef.current, [ruleName]: config };
    try {
      if (window.electron) {
        await window.electron.saveRule(ruleName, config);
      } else {
        await fetch("/api/rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: ruleName, config }),
        });
      }
      addAuditEvent("rule", `Rule updated for ${ruleName}: ${config.action}`, { name: ruleName, config }, !window.electron);
      await fetchRules();
    } catch (e) {
      console.error("Failed to update rule", e);
    }
  }, [fetchRules, addAuditEvent]);

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, name: "" });
  const [scanResults, setScanResults] = useState<{ name: string; verdict: string; action: string }[]>([]);
  const [showScanReport, setShowScanReport] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [applyingRules, setApplyingRules] = useState(false);

  const handleApplySuggestions = useCallback(async () => {
    const toApply = scanResults.filter(r => selectedSuggestions.has(r.name) && r.action !== "NONE");
    if (toApply.length === 0) return;
    setApplyingRules(true);
    try {
      for (const r of toApply) {
        await handleRuleChange(r.name, { action: r.action as any, autoKillMins: null });
      }
      addAuditEvent("rule", `Bulk applied ${toApply.length} suggested rule(s)`, { count: toApply.length });
      setShowScanReport(false);
      setSelectedSuggestions(new Set());
      showToast(`Applied ${toApply.length} rule${toApply.length !== 1 ? "s" : ""}`);
    } finally {
      setApplyingRules(false);
    }
  }, [scanResults, selectedSuggestions, handleRuleChange, addAuditEvent, showToast]);

  const handleDeepScan = useCallback(async (forceRescanInput: unknown = false) => {
    const forceRescan = forceRescanInput === true;
    if (isScanning) return;

    const available = await refreshAiAvailability();
    if (!available) {
      const message =
        aiSetupPhase === "pulling" ? "AI model is still downloading" :
        aiSetupPhase === "starting" ? "AI engine is starting" :
        aiSetupError || "AI unavailable - install/start Ollama and pull a model";
      showToast(message);
      return;
    }

    const currentRules = await fetchRules();
    const toScan = [...processes.reduce((map, proc) => {
      const rule = currentRules[normalizeName(proc.name)];
      if (proc.trust === "unknown" && (!rule || rule.action === "NONE")) {
        map.set(normalizeName(proc.name), proc.name);
      }
      return map;
    }, new Map<string, string>()).values()];

    if (toScan.length === 0) {
      showToast("No unknown processes to scan");
      return;
    }

    setIsScanning(true);
    setShowScanReport(false);
    setScanResults([]);
    setScanProgress({ current: 0, total: toScan.length, name: "" });

    const newResults: { name: string; verdict: string; action: string; title: string; tip: string }[] = [];
    let nextIndex = 0;
    let completed = 0;

    const analyzeOne = async (name: string) => {
      setScanProgress(p => ({ ...p, name }));
      try {
        let res: (AnalysisResult & { error?: string }) | null = null;
        if (window.electron) {
          res = await window.electron.analyzeProcess(name);
        } else {
          res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, forceRescan }),
          }).then(r => r.json());
        }

        if (res && !res.error) {
          if (window.electron) await window.electron.saveAnalysis(name, res);

          const action = res.verdict === "essential" ? "ALLOW" : (res.suggestedRule?.action ?? "NONE");

          newResults.push({
            name,
            verdict: res.verdict ?? "caution",
            action,
            title: res.title ?? name,
            tip: res.tip ?? "",
          });
          addAuditEvent("scan", `Analyzed ${name}: ${res.verdict ?? "caution"}`, { name, verdict: res.verdict ?? "caution", suggestedRule: action });
        }
      } catch (e) {
        console.error(`Failed to analyze ${name}`, e);
      } finally {
        completed += 1;
        setScanProgress(p => ({ ...p, current: completed }));
      }
    };

    const worker = async () => {
      while (nextIndex < toScan.length) {
        const name = toScan[nextIndex];
        nextIndex += 1;
        await analyzeOne(name);
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(3, toScan.length) }, worker));
    } finally {
      if (window.electron) {
        await window.electron.writeScanLog(newResults);
      }

      setIsScanning(false);
      setScanProgress({ current: 0, total: 0, name: "" });
    }

    const finalResults = newResults.map(r => ({ name: r.name, verdict: r.verdict, action: r.action }));
    setScanResults(finalResults);
    setSelectedSuggestions(new Set(finalResults.filter(r => r.action !== "NONE").map(r => r.name)));
    setShowScanReport(true);
    addAuditEvent("scan", `Batch scan complete: ${newResults.length} process(es) analyzed`, { scanned: newResults.length, total: toScan.length });
    showToast(`Batch scan complete - ${newResults.length} processes analyzed`);
    sendNotification("TaskFish Batch Scan", `${newResults.length} process analysis result(s) are ready.`);
    fetchProcesses();
  }, [processes, isScanning, fetchProcesses, fetchRules, addAuditEvent, sendNotification, refreshAiAvailability, showToast, aiSetupError, aiSetupPhase]);

  const handleGameMode = useCallback(async () => {
    const limitedGroups = groups.filter(g => {
      const rule = rulesRef.current[normalizeName(g.name)];
      return rule && rule.action === "LIMITED";
    });

    if (limitedGroups.length === 0) {
      alert("No processes are flagged as LIMITED.");
      return;
    }

    const targetPids = limitedGroups.flatMap(g => g.children.filter(child => child.id > 0).map(child => child.id));
    if (targetPids.length === 0) return;

    if (gameModeActive) {
      for (const pid of gameModePidsRef.current) {
        if (window.electron) {
          await window.electron.setProcessPriority(pid, "Normal").catch(() => null);
        } else {
          await fetch("/api/process-control", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pid, priority: "Normal" })
          }).catch(() => null);
        }
      }
      gameModePidsRef.current = new Set();
      setGameModeActive(false);
      addAuditEvent("game-mode", "Game Mode released limited processes");
      return;
    }

    for (const pid of targetPids) {
      if (window.electron) {
        await window.electron.setProcessPriority(pid, "Idle").catch(() => null);
      } else {
        await fetch("/api/process-control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid, priority: "Idle" })
        }).catch(() => null);
      }
    }
    gameModePidsRef.current = new Set(targetPids);
    setGameModeActive(true);
    addAuditEvent("game-mode", `Game Mode limited ${targetPids.length} process(es)`);
    sendNotification("TaskFish Game Mode", `${targetPids.length} limited process(es) moved to idle priority.`);
    setTimeout(fetchProcesses, 1500);
  }, [groups, gameModeActive, fetchProcesses, addAuditEvent, sendNotification]);

  const handleNavigate = useCallback((node: TreeNode) => {
    const fresh = findNode(roots, node.id) ?? groups.find(g => g.id === node.id);
    setSelected(fresh ?? node);
  }, [roots, groups]);

  const openAnalysis = useCallback((name: string, pid: number) => {
    if (!aiAvailable) {
      const message =
        aiSetupPhase === "pulling" ? "AI model is still downloading" :
        aiSetupPhase === "starting" ? "AI engine is starting" :
        aiSetupError || "AI setup is unavailable";
      showToast(message);
      return;
    }
    setAnalysisTarget({ name, pid });
    setAnalyzeKey(k => k + 1);
  }, [aiAvailable, aiSetupError, aiSetupPhase, showToast]);

  const banCount = useMemo(() => Object.values(rules).filter(r => r.action === "BAN").length, [rules]);

  const displayedGroups = useMemo(() => {
    if (!searchQuery) return groups;
    return groups.filter(g => processMatches(g, searchQuery));
  }, [groups, searchQuery]);

  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Header
        totalProcesses={processes.length}
        statsHistory={statsHistory}
        unknownCount={unknownCount}
        loading={loading}
        onRefresh={fetchProcesses}
        view={view}
        banCount={banCount}
        onOpenSecurity={() => setView("security")}
        selectedName={selected?.name}
        onBack={() => {
          setView("list");
          setSelected(null);
        }}
        lastUpdated={lastUpdated}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onGameMode={handleGameMode}
        gameModeActive={gameModeActive}
        onDeepScan={handleDeepScan}
        isScanning={isScanning}
        scanProgress={scanProgress}
        aiAvailable={aiAvailable}
        aiSetupPhase={aiSetupPhase}
        onOpenSettings={() => setShowSettings(true)}
        rulesActive={rulesActive}
        onToggleRules={handleToggleRules}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onApplyProfile={handleApplyProfile}
      />

      {toastMessage && (
        <div style={{
          position: "fixed",
          top: "84px",
          right: "24px",
          zIndex: 1200,
          background: "rgba(15, 23, 42, 0.94)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "10px 14px",
          fontSize: "13px",
          fontWeight: 700,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}>
          {toastMessage}
        </div>
      )}

      {/* AI setup progress overlay */}
      {(aiSetupPhase === "starting" || aiSetupPhase === "pulling") && (
        <div style={{
          position: "fixed", top: "80px", left: "24px",
          background: "var(--bg-card)", border: "1px solid rgba(168,85,247,0.4)",
          borderRadius: "12px", zIndex: 1001, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px",
          width: "280px", WebkitAppRegion: "no-drag",
        } as React.CSSProperties}>
          <span style={{ fontWeight: 700, fontSize: "13px", color: "#a855f7" }}>
            {aiSetupPhase === "starting" ? "Starting AI engine..." : "Downloading AI model..."}
          </span>
          {aiSetupPhase === "pulling" && (
            <>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                {aiPullProgress && aiPullProgress.total > 0
                  ? `${(aiPullProgress.completed / 1024 / 1024).toFixed(0)} / ${(aiPullProgress.total / 1024 / 1024).toFixed(0)} MB`
                  : "llama3.2:1b (~1.3 GB) — first-run setup"}
              </div>
              <div style={{ height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
                <div style={{
                  height: "100%", background: "#a855f7", borderRadius: "2px",
                  width: `${aiPullProgress && aiPullProgress.total > 0 ? Math.round((aiPullProgress.completed / aiPullProgress.total) * 100) : 5}%`,
                  transition: "width 0.5s ease",
                }} />
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                Scan &amp; Analyze will be ready when download completes
              </div>
            </>
          )}
        </div>
      )}

      {aiSetupPhase === "error" && (
        <div style={{
          position: "fixed", top: "80px", left: "24px",
          background: "var(--bg-card)", border: "1px solid rgba(248,113,113,0.45)",
          borderRadius: "12px", zIndex: 1001, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px",
          width: "300px", WebkitAppRegion: "no-drag",
        } as React.CSSProperties}>
          <span style={{ fontWeight: 700, fontSize: "13px", color: "#f87171" }}>
            AI setup needs attention
          </span>
          <span style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.45 }}>
            {aiSetupError || "TaskFish could not start Ollama or install the default AI model."}
          </span>
          <button
            type="button"
            onClick={() => {
              startAiSetup(true);
            }}
            style={{
              marginTop: "2px", alignSelf: "flex-start", border: "1px solid rgba(248,113,113,0.35)",
              background: "rgba(248,113,113,0.1)", color: "#fca5a5", borderRadius: "8px",
              padding: "6px 10px", fontSize: "12px", fontWeight: 700, cursor: "pointer",
            }}
          >
            Retry setup
          </button>
        </div>
      )}

      {/* Scanning progress pill */}
      {isScanning && (
        <div style={{
          position: "fixed", top: "80px", right: "24px", width: "300px",
          background: "var(--bg-card)", border: "1px solid var(--verified)",
          borderRadius: "12px", zIndex: 1001, boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--verified)" }}>Batch Scan...</span>
            <span style={{ fontSize: "12px", opacity: 0.6 }}>{scanProgress.current} / {scanProgress.total}</span>
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            Analyzing: <span style={{ color: "var(--text)", fontWeight: 600 }}>{scanProgress.name}</span>
          </div>
          <div style={{ height: "4px", background: "rgba(255,255,255,0.06)", borderRadius: "2px", overflow: "hidden" }}>
            <div style={{ height: "100%", background: "var(--verified)", borderRadius: "2px",
              width: `${scanProgress.total ? (scanProgress.current / scanProgress.total) * 100 : 0}%`,
              transition: "width 0.3s ease" }} />
          </div>
        </div>
      )}

      {/* Scan results - full-screen modal */}
      {showScanReport && !isScanning && (
        <div style={{
          position: "fixed", top: "40px", bottom: 0, left: 0, right: 0,
          background: "rgba(0,0,0,0.75)",
          zIndex: 200, display: "flex", alignItems: "stretch", justifyContent: "flex-end",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}>
          <div style={{
            width: "min(560px, 100vw)", background: "var(--bg-card)",
            borderLeft: "1.5px solid var(--border)", display: "flex", flexDirection: "column",
            boxShadow: "-16px 0 48px rgba(0,0,0,0.5)"
          }}>
            {/* Header */}
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
              <button onClick={() => setShowScanReport(false)} style={{
                background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)",
                color: "var(--text-muted)", padding: "6px 14px", borderRadius: "8px",
                fontSize: "13px", fontWeight: 600, cursor: "pointer"
              }}>Back</button>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)" }}>Batch Scan Results</div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                  {scanResults.length} process{scanResults.length !== 1 ? "es" : ""} analyzed
                </div>
              </div>
            </div>

            {/* Results list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {scanResults.length === 0 ? (
                <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px" }}>
                  All unknown processes were already in the cache.<br/>
                  <span style={{ fontSize: "12px", opacity: 0.6 }}>Click Analyze on any card to view its report.</span>
                </div>
              ) : (
                scanResults.map(r => {
                  const vc: Record<string, string> = { essential: "var(--trusted)", safe: "var(--verified)", background: "var(--background)", caution: "var(--unknown)" };
                  const color = vc[r.verdict] ?? "var(--text-muted)";
                  const actionColor: Record<string, string> = { ALLOW: "var(--verified)", LIMITED: "var(--background)", BAN: "var(--unknown)" };
                  const hasAction = r.action !== "NONE";
                  const isChecked = selectedSuggestions.has(r.name);
                  return (
                    <div key={r.name}
                      style={{
                        padding: "12px 24px", display: "flex", alignItems: "center", gap: "14px",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        background: isChecked && hasAction ? "rgba(255,255,255,0.02)" : "transparent",
                        transition: "background 0.12s"
                      }}
                    >
                      {hasAction ? (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => setSelectedSuggestions(prev => {
                            const next = new Set(prev);
                            if (next.has(r.name)) next.delete(r.name); else next.add(r.name);
                            return next;
                          })}
                          style={{ width: "15px", height: "15px", flexShrink: 0, cursor: "pointer", accentColor: actionColor[r.action] ?? "var(--verified)" }}
                        />
                      ) : (
                        <span style={{ width: "15px", flexShrink: 0 }} />
                      )}
                      <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}` }} />
                      <span
                        style={{ flex: 1, fontSize: "14px", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}
                        onClick={() => {
                          setShowScanReport(false);
                          const matchingProc = processes.find(p => p.name.toLowerCase() === r.name.toLowerCase());
                          const pid = matchingProc ? matchingProc.id : 0;
                          openAnalysis(r.name, pid);
                        }}
                      >
                        {r.name}
                      </span>
                      <span style={{ fontSize: "11px", fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
                        {r.verdict}
                      </span>
                      {hasAction && (
                        <span style={{
                          fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
                          border: `1px solid ${actionColor[r.action] ?? "var(--text-dim)"}`,
                          color: actionColor[r.action] ?? "var(--text-dim)", flexShrink: 0
                        }}>{r.action}</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: "14px 24px",
              borderTop: "1px solid var(--border)",
              background: "rgba(30, 30, 46, 0.45)",
              backdropFilter: "blur(12px)",
              flexShrink: 0,
            }}>
              {selectedSuggestions.size > 0 && (
                <div style={{ marginBottom: "10px", display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", flex: 1 }}>
                    {selectedSuggestions.size} rule{selectedSuggestions.size !== 1 ? "s" : ""} selected
                  </span>
                  <button
                    onClick={() => setSelectedSuggestions(new Set())}
                    style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: "12px", cursor: "pointer", padding: "2px 6px" }}
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setSelectedSuggestions(new Set(scanResults.filter(r => r.action !== "NONE").map(r => r.name)))}
                    style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: "12px", cursor: "pointer", padding: "2px 6px" }}
                  >
                    All
                  </button>
                </div>
              )}
              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                <button
                  onClick={() => { setShowScanReport(false); handleDeepScan(true); }}
                  style={{
                    background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)",
                    color: "var(--text-muted)", padding: "10px 18px", borderRadius: "8px",
                    fontSize: "13px", fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Rescan Unknowns
                </button>
                <button
                  onClick={handleApplySuggestions}
                  disabled={selectedSuggestions.size === 0 || applyingRules}
                  style={{
                    background: selectedSuggestions.size > 0 ? "var(--verified)" : "rgba(255,255,255,0.04)",
                    border: "none", color: selectedSuggestions.size > 0 ? "#ffffff" : "var(--text-dim)",
                    padding: "10px 20px", borderRadius: "8px",
                    fontSize: "13px", fontWeight: 700, cursor: selectedSuggestions.size > 0 ? "pointer" : "default",
                    boxShadow: selectedSuggestions.size > 0 ? "0 4px 12px rgba(96,165,250,0.25)" : "none",
                    transition: "all 0.15s", opacity: applyingRules ? 0.6 : 1,
                  }}
                >
                  {applyingRules ? "Applying..." : `Apply ${selectedSuggestions.size > 0 ? selectedSuggestions.size : ""} Rule${selectedSuggestions.size !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>

      )}

      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {error && (
          <div style={{ padding: "1rem", color: "#f87171", background: "rgba(248,113,113,0.1)" }}>
            Error: {error}
          </div>
        )}

        {view === "list" ? (
          <ProcessGrid
            roots={displayedGroups}
            rules={rules}
            processHistory={processHistory}
            onSelect={(node) => {
              setSelected(node);
              setView("map");
            }}
            onAnalyze={(node) => openAnalysis(node.name, node.id)}
            onQuickVerify={(node) => handleRuleChange(node.name, { action: "ALLOW", autoKillMins: null })}
            aiAvailable={aiAvailable}
            aiSetupPhase={aiSetupPhase}
          />
        ) : view === "map" ? (
          selected && (
            <MindMap
              selected={selected}
              roots={roots}
              allProcesses={processes}
              onNavigate={handleNavigate}
              onKilled={(deadIds) => {
                const idSet = new Set(deadIds);
                setProcesses((prev) => prev.filter((p) => !idSet.has(p.id)));
                fetchProcesses();
              }}
              onAnalyze={(node) => openAnalysis(node.name, node.id)}
              aiAvailable={aiAvailable}
              aiSetupPhase={aiSetupPhase}
            />
          )
        ) : (
          <SecurityCenter
            rules={rules}
            runningProcesses={processes}
            auditEvents={auditEvents}
            onRemoveRule={(name) => handleRuleChange(name, { action: "NONE", autoKillMins: null })}
            onAnalyze={openAnalysis}
            profiles={profiles}
            activeProfileId={activeProfileId}
            onApplyProfile={handleApplyProfile}
            onSaveProfile={handleSaveProfile}
            aiAvailable={aiAvailable}
            aiSetupPhase={aiSetupPhase}
            onRecordStatus={addAuditEvent}
          />
        )}
      </div>

      {analysisTarget && (
        <AnalysisDrawer
          key={analyzeKey}
          processName={analysisTarget.name}
          processPid={analysisTarget.pid}
          currentRule={rules[normalizeName(analysisTarget.name)] || { action: "NONE", autoKillMins: null }}
          processTrust={processes.find(p => normalizeName(p.name) === normalizeName(analysisTarget.name))?.trust}
          onRuleChange={handleRuleChange}
          onClose={() => setAnalysisTarget(null)}
          auditEvents={auditEvents}
          processHistory={processHistory[normalizeName(analysisTarget.name)] ?? []}
          aiAvailable={aiAvailable}
          aiSetupPhase={aiSetupPhase}
          aiSetupError={aiSetupError}
        />
      )}

      {showSettings && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}>
          <div style={{
            background: "var(--bg-card)", padding: "24px", borderRadius: "16px",
            width: "400px", border: "1px solid var(--border)", boxShadow: "0 10px 40px rgba(0,0,0,0.5)"
          }}>
            <h2 style={{ marginBottom: "16px", color: "var(--text)" }}>Dashboard Settings</h2>
            
            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "14px", color: "var(--text-muted)", marginBottom: "8px" }}>
                Resource Graph Polling Rate
              </label>
              <select
                value={graphPollMs}
                onChange={(e) => setGraphPollMs(Number(e.target.value))}
                style={{
                  width: "100%", padding: "10px", background: "rgba(0,0,0,0.2)",
                  border: "1px solid var(--border)", color: "var(--text)", borderRadius: "8px"
                }}
              >
                <option value={1000}>1 second (Live)</option>
                <option value={2000}>2 seconds</option>
                <option value={3000}>3 seconds (Default)</option>
                <option value={5000}>5 seconds</option>
                <option value={10000}>10 seconds</option>
              </select>
            </div>

            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "14px", color: "var(--text-muted)", marginBottom: "8px" }}>
                Process Refresh Interval
              </label>
              <select
                value={processPollMs}
                onChange={(e) => setProcessPollMs(Number(e.target.value))}
                style={{
                  width: "100%", padding: "10px", background: "rgba(0,0,0,0.2)",
                  border: "1px solid var(--border)", color: "var(--text)", borderRadius: "8px"
                }}
              >
                <option value={2000}>2 seconds</option>
                <option value={5000}>5 seconds (Default)</option>
                <option value={10000}>10 seconds</option>
                <option value={30000}>30 seconds</option>
              </select>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px", color: "var(--text-muted)", fontSize: "14px" }}>
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={(e) => setNotificationsEnabled(e.target.checked)}
              />
              Desktop notifications for rule actions and unknown processes
            </label>

            <div style={{ marginTop: "8px", borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text)", marginBottom: "10px" }}>Recent Events</div>
              <div style={{ maxHeight: "180px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
                {auditEvents.length === 0 ? (
                  <div style={{ color: "var(--text-dim)", fontSize: "12px" }}>No events recorded this session.</div>
                ) : auditEvents.slice(0, 8).map(event => (
                  <div key={event.id} style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", gap: "12px" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.message}</span>
                    <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>{new Date(event.ts).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  background: "var(--verified)", color: "#fff", padding: "8px 24px",
                  borderRadius: "8px", border: "none", cursor: "pointer", fontWeight: "bold"
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
