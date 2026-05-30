import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  getCachedAnalysis: (name: string) => ipcRenderer.invoke("get-cached-analysis", name),
  getAllCachedAnalyses: () => ipcRenderer.invoke("get-all-cached-analyses"),
  saveAnalysis: (name: string, data: any) => ipcRenderer.invoke("save-analysis", name, data),
  writeScanLog: (entries: any[]) => ipcRenderer.invoke("write-scan-log", entries),
  getProcesses: () => ipcRenderer.invoke("get-processes"),
  getIcon: (name: string) => ipcRenderer.invoke("get-icon", name),
  killProcess: (pid: number, killTree: boolean) => ipcRenderer.invoke("kill-process", { pid, killTree }),
  startAiService: () => ipcRenderer.invoke("start-ai-service"),
  stopAiService: () => ipcRenderer.invoke("stop-ai-service"),
  analyzeProcess: (name: string) => ipcRenderer.invoke("analyze-process", name),
  listModels: () => ipcRenderer.invoke("list-models"),
  pullModel: (modelName: string) => ipcRenderer.invoke("pull-model", modelName),
  onPullProgress: (cb: (progress: any) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on("pull-progress", handler);
    return () => ipcRenderer.removeListener("pull-progress", handler);
  },
  getStartupInfo: (name: string) => ipcRenderer.invoke("get-startup-info", name),
  getRules: () => ipcRenderer.invoke("get-rules"),
  saveRule: (name: string, config: any) => ipcRenderer.invoke("save-rule", { name, config }),
  getProfiles: () => ipcRenderer.invoke("get-profiles"),
  applyProfile: (profileId: string) => ipcRenderer.invoke("apply-profile", profileId),
  saveProfile: (name: string, rules: any) => ipcRenderer.invoke("save-profile", { name, rules }),
  enforceRules: (processes: any[], rules: any) => ipcRenderer.invoke("enforce-rules", { processes, rules }),
  getBackgroundEnforcement: () => ipcRenderer.invoke("get-background-enforcement"),
  setBackgroundEnforcement: (active: boolean) => ipcRenderer.invoke("set-background-enforcement", active),
  onOpenSecurityCenter: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("open-security-center", handler);
    return () => ipcRenderer.removeListener("open-security-center", handler);
  },
  setProcessPriority: (pid: number, priority: string) => ipcRenderer.invoke("set-process-priority", { pid, priority }),
  getAuditLog: () => ipcRenderer.invoke("get-audit-log"),
  appendAudit: (type: string, message: string, details: unknown = {}) => ipcRenderer.invoke("append-audit", { type, message, details }),
  notify: (title: string, body: string) => ipcRenderer.invoke("notify", { title, body }),
  getStats: () => ipcRenderer.invoke("get-stats"),
  getProcessDlls: (pid: number) => ipcRenderer.invoke("get-process-dlls", pid),
  getProcessNetwork: (pid: number) => ipcRenderer.invoke("get-process-network", pid),
  getProcessServices: (pid: number) => ipcRenderer.invoke("get-process-services", pid),
});
