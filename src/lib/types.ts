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
      onOpenSecurityCenter: (cb: () => void) => () => void;
      setProcessPriority: (pid: number, priority: "Idle" | "BelowNormal" | "Normal") => Promise<{ ok: boolean; error?: string }>;
      getAuditLog: () => Promise<{ id: string; ts: number; type: string; message: string; details?: any }[]>;
      appendAudit: (type: string, message: string, details?: unknown) => Promise<void>;
      notify: (title: string, body: string) => Promise<void>;
      getStats: () => Promise<{ cpu: number, ram: number }>;
      getProcessDlls: (pid: number) => Promise<any[]>;
      getProcessNetwork: (pid: number) => Promise<{ tcp: any[], udp: any[] }>;
      getProcessServices: (pid: number) => Promise<any[]>;
      importEventLog: () => Promise<{ ok: boolean; canceled?: boolean; error?: string; report?: EventHealthReport }>;
      analyzeEventHealth: (report: EventHealthReport, forceRefresh?: boolean) => Promise<EventHealthAnalysis & { error?: string }>;
      getEventFix: (finding: EventHealthFinding, cluster: EventCluster) => Promise<EventFixResult>;
      chatEventFix: (finding: EventHealthFinding, cluster: EventCluster, fix: EventFixResult, messages: EventFixChatMessage[]) => Promise<EventFixChatResponse>;
      getAppVersion: () => Promise<string>;
    };
  }
}
