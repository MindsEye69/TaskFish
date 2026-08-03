import type { EventHealthReport, EventHealthAnalysis, EventHealthFinding, EventCluster } from "./eventLog";

export interface EventFixStep {
  label: string;
  instruction: string;
  command?: string;
  warning?: string;
}

export interface EventFixResult {
  title: string;
  rootCauses: string[];
  steps: EventFixStep[];
  escalation: string;
  error?: string;
}

export interface EventFixChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface EventFixChatResponse {
  reply: string;
  error?: string;
}

export type TrustLevel = "trusted" | "verified" | "background" | "unknown";
export type Category = "system" | "user" | "background" | "unknown";
export type RuleAction = "ALLOW" | "BAN" | "LIMITED" | "NONE";
export type ProcessPriority = "Idle" | "BelowNormal" | "Normal" | "AboveNormal" | "High" | "RealTime";
export type AiSetupPhase = "idle" | "starting" | "pulling" | "ready" | "error";

export interface AiSetupStatus {
  phase: AiSetupPhase;
  model?: string;
  error?: string;
}

export interface RuleConfig {
  action: RuleAction;
  autoKillMins: number | null;
  manualControl?: boolean;
  overrideTrust?: TrustLevel;
  gameMode?: boolean;
}

export interface GameModeTarget {
  pid: number;
  name: string;
}

export interface GameModeSessionResult {
  active: boolean;
  requested: number;
  changed: number;
  restored: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface ProcessInfo {
  id: number;
  name: string;
  ramMB: number;
  cpu: number;    // real % of total CPU (0–100)
  ppid: number;
  handles: number;
  trust: TrustLevel;
  category: Category;
  vendor?: string; // cleaned company name from digital signature (populated async by verifier)
  execPath?: string;
}

export interface SystemStats {
  cpu: number;
  ram: number;
  totalRam?: number;
  freeRam?: number;
  commitUsed?: number;
  commitLimit?: number;
  commitFree?: number;
  commitPressure?: number;
  pageFileUsed?: number;
  pageFileAllocated?: number;
  pageFileRecommended?: boolean;
}

export type PageFileManagement = "automatic" | "system-managed" | "custom" | "none" | "unknown";
export type PageFileAdviceKind = "keep-managed" | "custom-cap" | "free-space" | "missing" | "review" | "unavailable";
export type StoragePerformanceTier = "nvme" | "ssd" | "hdd" | "other" | "unknown";
export type PageFilePlacementKind = "keep-current" | "move-to-faster-storage" | "no-eligible-fast-volume" | "review-volumes";

export interface PageFileEntry {
  path: string;
  drive?: string;
  allocatedMB: number;
  currentUsageMB: number;
  peakUsageMB: number;
  initialSizeMB?: number;
  maximumSizeMB?: number;
  driveFreeMB?: number;
  temporary?: boolean;
}

export interface PageFileAdvice {
  kind: PageFileAdviceKind;
  title: string;
  detail: string;
}

export interface PageFileVolume {
  drive: string;
  label?: string;
  diskNumber?: number;
  diskName?: string;
  busType?: string;
  mediaType?: string;
  sizeMB: number;
  freeMB: number;
  performanceTier: StoragePerformanceTier;
  containsPageFile: boolean;
}

export interface PageFilePlacementAdvice {
  kind: PageFilePlacementKind;
  title: string;
  detail: string;
  candidateDrives: string[];
  requiredFreeMB: number;
}

export interface PageFileConfiguration {
  management: PageFileManagement;
  automaticManaged: boolean;
  totalRamMB: number;
  files: PageFileEntry[];
  totalAllocatedMB: number;
  totalCurrentUsageMB: number;
  totalPeakUsageMB: number;
  totalDriveFreeMB: number;
  advice: PageFileAdvice;
  volumes: PageFileVolume[];
  placement: PageFilePlacementAdvice;
  error?: string;
}

export type WatchdogMode = "off" | "training" | "guard";
export type WatchdogRuleAction = "allow" | "block";

export interface WatchdogRule {
  key: string;
  name: string;
  executablePath?: string;
  action: WatchdogRuleAction;
  updatedAt: number;
}

export interface WatchdogProcessEvent {
  id: string;
  pid: number;
  parentPid: number;
  name: string;
  parentName?: string;
  executablePath?: string;
  detectedAt: number;
  suspended: boolean;
  requiresDecision: boolean;
}

export interface WatchdogState {
  mode: WatchdogMode;
  rules: WatchdogRule[];
  pending: WatchdogProcessEvent[];
  watcherRunning: boolean;
}

export interface ProcessGroup {
  name: string;
  trust: TrustLevel;
  category: Category;
  ramMB: number;
  cpu: number;
  processes: ProcessInfo[];
  rule: RuleConfig;
}

export interface TreeNode extends ProcessInfo {
  children: TreeNode[];
  helperCounts?: Record<string, number>;
}

export interface AnalysisResult {
  name: string;
  verdict: "safe" | "caution" | "essential" | "background";
  title: string;
  description: string;
  tip: string;
  gameModeSafe: boolean;
  suggestedRule?: RuleConfig;
  riskScore?: number;
  threatFlags?: string[];
}

export interface ProcessProfile {
  id: string;
  name: string;
  description: string;
  rules: Record<string, RuleConfig>;
  builtIn?: boolean;
  updatedAt?: number;
}

export interface ProcessProfilesData {
  activeProfileId: string;
  profiles: ProcessProfile[];
}

declare global {
  interface Window {
    electron?: {
      getCachedAnalysis: (name: string) => Promise<AnalysisResult | null>;
      getAllCachedAnalyses: () => Promise<Record<string, AnalysisResult>>;
      saveAnalysis: (name: string, data: AnalysisResult) => Promise<void>;
      writeScanLog: (entries: { name: string; verdict: string; action: string; title: string; tip: string }[]) => Promise<string | null>;
      getProcesses: () => Promise<any>;
      getIcon: (name: string) => Promise<string>;
      killProcess: (pid: number, killTree: boolean) => Promise<void>;
      startAiService: () => Promise<boolean>;
      stopAiService: () => Promise<void>;
      analyzeProcess: (name: string) => Promise<AnalysisResult & { error?: string; recommendedModel?: string }>;
      listModels: () => Promise<string[]>;
      pullModel: (modelName: string) => Promise<{ ok: boolean; error?: string }>;
      onAnalysisStreamChunk: (cb: (chunk: { token: string; done: boolean }) => void) => () => void;
      onPullProgress: (cb: (progress: { status?: string; digest?: string; total?: number; completed?: number }) => void) => () => void;
      onAiSetupStatus: (cb: (status: AiSetupStatus) => void) => () => void;
      getAiStatus: () => Promise<AiSetupStatus>;
      getStartupInfo: (name: string) => Promise<{ isStartupApp: boolean }>;
      getRules: () => Promise<Record<string, RuleConfig>>;
      saveRule: (name: string, config: RuleConfig) => Promise<void>;
      getProfiles: () => Promise<ProcessProfilesData>;
      applyProfile: (profileId: string) => Promise<{ ok: boolean; rules: Record<string, RuleConfig>; profiles: ProcessProfilesData }>;
      saveProfile: (name: string, rules: Record<string, RuleConfig>) => Promise<ProcessProfilesData>;
      enforceRules: (processes: { id: number; name: string }[], rules: Record<string, RuleConfig>) => Promise<{ ok: boolean; actions: { type: string; name: string; pid: number }[] }>;
      getBackgroundEnforcement: () => Promise<{ rulesActive: boolean }>;
      setBackgroundEnforcement: (active: boolean) => Promise<{ rulesActive: boolean }>;
      getWatchdogState: () => Promise<WatchdogState>;
      setWatchdogMode: (mode: WatchdogMode) => Promise<{ ok: boolean; error?: string } & WatchdogState>;
      resolveWatchdogProcess: (eventId: string, action: WatchdogRuleAction) => Promise<{ ok: boolean; error?: string; action?: WatchdogRuleAction; killed?: boolean }>;
      removeWatchdogRule: (key: string) => Promise<{ ok: boolean; error?: string } & Partial<WatchdogState>>;
      onWatchdogProcessDetected: (cb: (event: WatchdogProcessEvent) => void) => () => void;
      onOpenSecurityCenter: (cb: () => void) => () => void;
      setProcessPriority: (pid: number, priority: ProcessPriority) => Promise<{ ok: boolean; error?: string; previousPriority?: ProcessPriority; startedAt?: string }>;
      getGameModeState: () => Promise<GameModeSessionResult>;
      activateGameMode: (targets: GameModeTarget[]) => Promise<GameModeSessionResult>;
      releaseGameMode: () => Promise<GameModeSessionResult>;
      getAuditLog: () => Promise<{ id: string; ts: number; type: string; message: string; details?: any }[]>;
      appendAudit: (type: string, message: string, details?: unknown) => Promise<void>;
      notify: (title: string, body: string) => Promise<void>;
      getStats: () => Promise<SystemStats>;
      getPageFileConfiguration: () => Promise<PageFileConfiguration>;
      getProcessDlls: (pid: number) => Promise<any[]>;
      getProcessNetwork: (pid: number) => Promise<{ tcp: any[], udp: any[] }>;
      getProcessServices: (pid: number) => Promise<any[]>;
      importEventLog: () => Promise<{ ok: boolean; canceled?: boolean; error?: string; report?: EventHealthReport }>;
      scanLiveEvents: (options?: {
        channels?: ("System" | "Application" | "Security")[];
        maxEventsPerChannel?: number;
      }) => Promise<{
        ok: boolean;
        error?: string;
        report?: EventHealthReport;
        channelResults?: { channel: "System" | "Application" | "Security"; ok: boolean; error?: string }[];
      }>;
      analyzeEventHealth: (report: EventHealthReport, forceRefresh?: boolean) => Promise<EventHealthAnalysis & { error?: string }>;
      getEventFix: (finding: EventHealthFinding, cluster: EventCluster) => Promise<EventFixResult>;
      chatEventFix: (finding: EventHealthFinding, cluster: EventCluster, fix: EventFixResult, messages: EventFixChatMessage[]) => Promise<EventFixChatResponse>;
      getAppVersion: () => Promise<string>;
    };
  }
}
