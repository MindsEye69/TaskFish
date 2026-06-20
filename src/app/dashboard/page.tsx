"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./dashboard.module.css";

type Tone = "core" | "info" | "optional" | "issue";

interface FlowNode {
  id: string;
  label: string;
  detail: string;
  tone: Tone;
  issue: boolean;
  meta: string;
  actionType?: "command" | "file" | "note";
  actionValue?: string;
}

interface Flow {
  title: string;
  nodes: FlowNode[];
  edges: [string, string][];
  positions?: Record<string, { x: number; y: number }>;
}

interface FileNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children: FileNode[];
  uncommitted: boolean;
}

interface DashboardSnapshot {
  generatedAt: string;
  config: {
    path: string;
    home: string;
    modulesDir: string;
    data: {
      version: number;
      paperSleuthRoot: string;
      projects: {
        id: string;
        name: string;
        path: string;
        ticketFolder: string;
        launch?: {
          mode: string;
          command: string;
          args: string[];
          cwd: string;
          processName: string;
          label: string;
        };
      }[];
      customModulesDir: string;
    };
  };
  project: { id: string; name: string; path: string; ticketFolder?: string };
  projects: { id: string; name: string; path: string; ticketFolder: string; ticketCount: number; configured: boolean }[];
  paperSleuth: {
    root: string;
    ticketsDir: string;
    projectFolder: string;
    projectTicketsPath: string;
    status: string;
  };
  appControl: {
    available: boolean;
    running: boolean;
    pid: number | null;
    label: string;
    command: string;
    mode: string;
    processName: string;
    startedAt: string;
  };
  git: {
    branch: string;
    status: string;
    clean: boolean;
    aheadBehind: string;
    remoteUrl: string;
    uncommitted: { status: string; path: string }[];
    commits: { hash: string; shortHash: string; author: string; relativeDate: string; subject: string; url: string }[];
  };
  codeGraph: { configured: boolean; status: string; issue: boolean };
  graphify: { configured: boolean; status: string; issue: boolean };
  stats: {
    files: number;
    linesOfCode: number;
    sessions: number;
    languages: { name: string; count: number }[];
  };
  notes: { path: string; content: string };
  tickets: {
    id: string;
    title: string;
    severity: string;
    status: string;
    source: string;
    updated: string;
    url: string;
    sourceUrls?: string[];
    path?: string;
    summary?: string;
  }[];
  customModules: {
    id: string;
    title: string;
    summary: string;
    severity: string;
    status: string;
    source: string;
    updated: string;
    content: string;
    url: string;
    path: string;
  }[];
  fileTree: FileNode;
  flows: {
    sessionStart: Flow;
    sessionClose: Flow;
    program: Flow;
  };
  readiness: {
    clear: boolean;
    items: { id: string; label: string; ok: boolean; detail: string }[];
  };
  attention: { id: string; severity: string; title: string; source: string }[];
  procedures: {
    dir: string;
    json: string;
    startup: string;
    close: string;
  };
}

type DashboardResponse = {
  ok: boolean;
  command?: string;
  message?: string;
  snapshot?: DashboardSnapshot;
  error?: string;
};

type GraphMode = "session" | "program";
type SessionProcedure = "sessionStart" | "sessionClose";
type MenuPage = "Overview" | "Notes" | "Files" | "Tickets" | "Commits" | "Stats" | "Settings";
type PortName = "top" | "right" | "bottom" | "left";
type EdgeSelection = { from: string; to: string } | null;
type EdgeTone = "core" | "optional" | "issue" | "selected";
type ModuleId = "graph" | "tickets" | "custom" | "selectedNode" | "graphEditor" | "readiness" | "notes" | "commits" | "stats" | "files";

interface WorkspaceModuleState {
  id: ModuleId;
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
}

const SNAP_GRID = 18;
const MODULE_LAYOUT_KEY = "project-dashboard-module-layout-v1";
const MODULE_LABELS: Record<ModuleId, string> = {
  graph: "Flow Graph",
  tickets: "Paper Sleuth Tickets",
  custom: "Custom Modules",
  selectedNode: "Selected Node",
  graphEditor: "Graph Editor",
  readiness: "Close Readiness",
  notes: "Notes",
  commits: "Recent Commits",
  stats: "Project Stats",
  files: "File Explorer",
};

const DEFAULT_MODULE_LAYOUT: WorkspaceModuleState[] = [
  { id: "graph", x: 0, y: 0, w: 45, h: 36, visible: true },
  { id: "tickets", x: 46, y: 0, w: 20, h: 13, visible: true },
  { id: "custom", x: 0, y: 37, w: 22, h: 13, visible: false },
  { id: "selectedNode", x: 46, y: 14, w: 20, h: 10, visible: true },
  { id: "graphEditor", x: 46, y: 25, w: 20, h: 13, visible: true },
  { id: "readiness", x: 0, y: 37, w: 23, h: 12, visible: false },
  { id: "notes", x: 24, y: 37, w: 22, h: 14, visible: false },
  { id: "commits", x: 47, y: 39, w: 20, h: 13, visible: false },
  { id: "stats", x: 0, y: 50, w: 28, h: 13, visible: false },
  { id: "files", x: 29, y: 52, w: 24, h: 15, visible: false },
];

const NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  open: { x: 52, y: 8 },
  agents: { x: 78, y: 22 },
  codegraph: { x: 50, y: 35 },
  snapshot: { x: 18, y: 51 },
  tickets: { x: 50, y: 57 },
  notes: { x: 82, y: 51 },
  ready: { x: 50, y: 76 },
  begin: { x: 50, y: 8 },
  "close-notes": { x: 18, y: 24 },
  "close-markdown": { x: 18, y: 42 },
  "close-codegraph": { x: 50, y: 38 },
  "close-graphify": { x: 82, y: 42 },
  "close-git": { x: 50, y: 56 },
  "close-gate": { x: 32, y: 71 },
  "close-dashboard": { x: 68, y: 71 },
  closed: { x: 50, y: 88 },
  ui: { x: 18, y: 24 },
  api: { x: 50, y: 20 },
  collector: { x: 50, y: 43 },
  store: { x: 26, y: 68 },
  external: { x: 82, y: 68 },
};

const NODE_SIZE = { width: 28, height: 13.5 };

function severityClass(severity: string) {
  const lower = severity.toLowerCase();
  if (lower.includes("high") || lower.includes("critical")) return styles.high;
  if (lower.includes("low")) return styles.low;
  return styles.medium;
}

function formatDate(value: string) {
  if (!value) return "No snapshot";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function nodePosition(nodeId: string, index: number) {
  return NODE_POSITIONS[nodeId] ?? { x: 20 + (index % 4) * 20, y: 20 + Math.floor(index / 4) * 16 };
}

function nodeSidePoint(position: { x: number; y: number }, side: PortName) {
  const centerY = position.y + NODE_SIZE.height / 2;
  if (side === "right") return { x: position.x + NODE_SIZE.width / 2, y: centerY, dx: 1, dy: 0 };
  if (side === "left") return { x: position.x - NODE_SIZE.width / 2, y: centerY, dx: -1, dy: 0 };
  if (side === "top") return { x: position.x, y: position.y, dx: 0, dy: -1 };
  return { x: position.x, y: position.y + NODE_SIZE.height, dx: 0, dy: 1 };
}

function connectionSides(from: { x: number; y: number }, to: { x: number; y: number }): [PortName, PortName] {
  const fromCenter = { x: from.x, y: from.y + NODE_SIZE.height / 2 };
  const toCenter = { x: to.x, y: to.y + NODE_SIZE.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (Math.abs(dx) > 5 || Math.abs(dx) > Math.abs(dy) * 0.4) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const [fromSide, toSide] = connectionSides(from, to);
  const start = nodeSidePoint(from, fromSide);
  const end = nodeSidePoint(to, toSide);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const handle = fromSide === "left" || fromSide === "right"
    ? Math.max(7, Math.min(20, Math.abs(end.x - start.x) * 0.5))
    : Math.max(7, Math.min(18, distance * 0.42));
  const c1 = { x: start.x + start.dx * handle, y: start.y + start.dy * handle };
  const c2 = { x: end.x + end.dx * handle, y: end.y + end.dy * handle };
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
}

function previewEdgePath(from: { x: number; y: number }, fromPort: PortName, to: { x: number; y: number }) {
  const start = nodeSidePoint(from, fromPort);
  const distance = Math.hypot(to.x - start.x, to.y - start.y);
  const handle = fromPort === "left" || fromPort === "right"
    ? Math.max(7, Math.min(18, Math.abs(to.x - start.x) * 0.5))
    : Math.max(7, Math.min(16, distance * 0.4));
  const c1 = { x: start.x + start.dx * handle, y: start.y + start.dy * handle };
  const c2 = { x: to.x - start.dx * handle, y: to.y - start.dy * handle };
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
}

function edgeToneForNode(node?: FlowNode, selected = false): EdgeTone {
  if (selected) return "selected";
  if (node?.issue || node?.tone === "issue") return "issue";
  if (node?.tone === "optional") return "optional";
  return "core";
}

function edgeColor(tone: EdgeTone) {
  if (tone === "selected") return "#59d686";
  if (tone === "issue") return "#f45d62";
  if (tone === "optional") return "#d6a034";
  return "#72d8ff";
}

function countOpenTickets(snapshot: DashboardSnapshot) {
  return snapshot.tickets.filter(ticket => ticket.status.toLowerCase() !== "closed").length;
}

function mergeModuleLayout(saved: WorkspaceModuleState[]) {
  return DEFAULT_MODULE_LAYOUT.map(module => {
    const match = saved.find(item => item.id === module.id);
    return match ? { ...module, ...match } : module;
  });
}

function clampModule(module: WorkspaceModuleState, workspaceSize: { width: number; height: number }) {
  const maxCols = Math.max(module.w, Math.floor(workspaceSize.width / SNAP_GRID));
  const maxRows = Math.max(module.h, Math.floor(workspaceSize.height / SNAP_GRID));
  const width = Math.max(14, Math.min(module.w, maxCols));
  const height = Math.max(8, Math.min(module.h, maxRows));
  return {
    ...module,
    w: width,
    h: height,
    x: Math.max(0, Math.min(module.x, maxCols - width)),
    y: Math.max(0, Math.min(module.y, maxRows - height)),
  };
}

export default function ProjectDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [editableFlows, setEditableFlows] = useState<DashboardSnapshot["flows"] | null>(null);
  const [graphMode, setGraphMode] = useState<GraphMode>("session");
  const [sessionProcedure, setSessionProcedure] = useState<SessionProcedure>("sessionStart");
  const [activePage, setActivePage] = useState<MenuPage>("Overview");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [notesDraft, setNotesDraft] = useState("");
  const [newNodeLabel, setNewNodeLabel] = useState("");
  const [newNodeDetail, setNewNodeDetail] = useState("");
  const [newNodeActionType, setNewNodeActionType] = useState<FlowNode["actionType"]>("command");
  const [newNodeActionValue, setNewNodeActionValue] = useState("");
  const [selectedEdge, setSelectedEdge] = useState<EdgeSelection>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [configDraft, setConfigDraft] = useState("");
  const [dirtyProcedures, setDirtyProcedures] = useState<Record<SessionProcedure, boolean>>({
    sessionStart: false,
    sessionClose: false,
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [moduleLayout, setModuleLayout] = useState<WorkspaceModuleState[]>(DEFAULT_MODULE_LAYOUT);
  const [moduleLayoutReady, setModuleLayoutReady] = useState(false);
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false);
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 });
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const procedureDirty = graphMode === "session" && dirtyProcedures[sessionProcedure];
  const hasUnsavedProcedureEdits = dirtyProcedures.sessionStart || dirtyProcedures.sessionClose;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODULE_LAYOUT_KEY);
      if (saved) setModuleLayout(mergeModuleLayout(JSON.parse(saved) as WorkspaceModuleState[]));
    } catch {
      setModuleLayout(DEFAULT_MODULE_LAYOUT);
    } finally {
      setModuleLayoutReady(true);
    }
  }, []);

  useEffect(() => {
    if (!moduleLayoutReady) return;
    window.localStorage.setItem(MODULE_LAYOUT_KEY, JSON.stringify(moduleLayout));
  }, [moduleLayout, moduleLayoutReady]);

  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setWorkspaceSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activePage]);

  const visibleModules = moduleLayout.filter(module => module.visible);
  const hiddenModules = moduleLayout.filter(module => !module.visible);

  function updateModuleLayout(id: ModuleId, patch: Partial<WorkspaceModuleState>) {
    const rect = workspaceRef.current?.getBoundingClientRect();
    const liveWorkspaceSize = rect ? { width: rect.width, height: rect.height } : workspaceSize;
    setModuleLayout(current => current.map(module => {
      if (module.id !== id) return module;
      return clampModule({ ...module, ...patch }, liveWorkspaceSize);
    }));
  }

  function showModule(id: ModuleId) {
    updateModuleLayout(id, { visible: true });
    setModuleMenuOpen(false);
  }

  function hideModule(id: ModuleId) {
    if (id === "graph") {
      setMessage("Flow Graph stays pinned as the primary workspace.");
      return;
    }
    updateModuleLayout(id, { visible: false });
  }

  function resetModuleLayout() {
    setModuleLayout(DEFAULT_MODULE_LAYOUT);
    setModuleMenuOpen(false);
  }

  const loadSnapshot = useCallback(async (projectIdOrRoot?: string) => {
    setLoading(true);
    setMessage("");
    const query = projectIdOrRoot
      ? projectIdOrRoot.includes(":") || projectIdOrRoot.includes("\\") || projectIdOrRoot.includes("/")
        ? `?projectRoot=${encodeURIComponent(projectIdOrRoot)}`
        : `?projectId=${encodeURIComponent(projectIdOrRoot)}`
      : "";
    const response = await fetch(`/api/project-dashboard${query}`, { cache: "no-store" });
    const data = (await response.json()) as DashboardResponse;
    if (!data.ok || !data.snapshot) {
      setMessage(data.error ?? "Dashboard snapshot failed.");
      setLoading(false);
      return;
    }
    setSnapshot(data.snapshot);
    setSelectedProjectId(data.snapshot.project.id);
    setConfigDraft(JSON.stringify(data.snapshot.config.data, null, 2));
    setEditableFlows(data.snapshot.flows);
    setNotesDraft(data.snapshot.notes.content);
    setSelectedNodeId(data.snapshot.flows.sessionStart.nodes[0]?.id ?? "");
    setSelectedEdge(null);
    setDirtyProcedures({ sessionStart: false, sessionClose: false });
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const activeFlowKey = graphMode === "program" ? "program" : sessionProcedure;

  const activeFlow = useMemo(() => {
    if (!editableFlows) return null;
    return editableFlows[activeFlowKey];
  }, [activeFlowKey, editableFlows]);

  useEffect(() => {
    setSelectedEdge(null);
  }, [activeFlowKey]);

  const selectedNode = useMemo(() => {
    if (!activeFlow) return null;
    return activeFlow.nodes.find(node => node.id === selectedNodeId) ?? activeFlow.nodes[0] ?? null;
  }, [activeFlow, selectedNodeId]);

  async function runAction(action: "refresh" | "session-start" | "session-close" | "start-app" | "stop-app") {
    if (!snapshot) return;
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/project-dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, projectRoot: snapshot.project.path }),
    });
    const data = (await response.json()) as DashboardResponse;
    if (!data.ok || !data.snapshot) {
      setMessage(data.error ?? `${action} failed.`);
      setLoading(false);
      return;
    }
    setSnapshot(data.snapshot);
    setEditableFlows(data.snapshot.flows);
    setNotesDraft(data.snapshot.notes.content);
    setSelectedEdge(null);
    setDirtyProcedures({ sessionStart: false, sessionClose: false });
    setMessage(data.message ?? (action === "session-close" && !data.snapshot.git.clean
      ? "Session close snapshot written. Git still has uncommitted files."
      : `${action} complete.`));
    setLoading(false);
  }

  async function saveNotes() {
    if (!snapshot) return;
    setLoading(true);
    const response = await fetch("/api/project-dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-notes", projectRoot: snapshot.project.path, content: notesDraft }),
    });
    const data = (await response.json()) as DashboardResponse;
    if (data.ok && data.snapshot) {
      setSnapshot(data.snapshot);
      if (!hasUnsavedProcedureEdits) setEditableFlows(data.snapshot.flows);
      setMessage("notes.md saved.");
    } else {
      setMessage(data.error ?? "Saving notes failed.");
    }
    setLoading(false);
  }

  async function saveConfig() {
    if (!snapshot) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(configDraft);
    } catch (error) {
      setMessage(error instanceof Error ? `Config JSON error: ${error.message}` : "Config JSON is invalid.");
      return;
    }
    setLoading(true);
    const response = await fetch("/api/project-dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-config", projectRoot: snapshot.project.path, config: parsed }),
    });
    const data = (await response.json()) as DashboardResponse;
    if (data.ok && data.snapshot) {
      setSnapshot(data.snapshot);
      setSelectedProjectId(data.snapshot.project.id);
      setConfigDraft(JSON.stringify(data.snapshot.config.data, null, 2));
      setMessage("Dashboard config saved.");
    } else {
      setMessage(data.error ?? "Saving dashboard config failed.");
    }
    setLoading(false);
  }

  async function openProjectFile(filePath: string) {
    if (!snapshot) return;
    if (!filePath) return;
    const response = await fetch("/api/project-dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open-file", projectRoot: snapshot.project.path, path: filePath }),
    });
    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!data.ok) setMessage(data.error ?? "Opening file failed.");
  }

  async function openTicketFile(filePath?: string) {
    if (!filePath) return;
    const response = await fetch("/api/project-dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open-paper-sleuth-ticket", path: filePath }),
    });
    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!data.ok) setMessage(data.error ?? "Opening Paper Sleuth ticket failed.");
  }

  function changeProject(projectId: string) {
    setSelectedProjectId(projectId);
    const project = snapshot?.projects.find(item => item.id === projectId);
    void loadSnapshot(project?.path ?? projectId);
  }

  function updateActiveFlow(updater: (flow: Flow) => Flow) {
    setEditableFlows(current => {
      if (!current) return current;
      return {
        ...current,
        [activeFlowKey]: updater(current[activeFlowKey]),
      };
    });
    if (graphMode === "session") {
      setDirtyProcedures(current => ({ ...current, [sessionProcedure]: true }));
    }
  }

  function moveNode(nodeId: string, position: { x: number; y: number }) {
    updateActiveFlow(flow => ({
      ...flow,
      positions: {
        ...(flow.positions ?? {}),
        [nodeId]: position,
      },
    }));
  }

  function addEdge(fromId: string, toId: string) {
    if (fromId === toId) return;
    updateActiveFlow(flow => {
      const exists = flow.edges.some(([from, to]) => from === fromId && to === toId);
      return exists ? flow : { ...flow, edges: [...flow.edges, [fromId, toId]] };
    });
  }

  function removeEdge(fromId: string, toId: string) {
    updateActiveFlow(flow => ({
      ...flow,
      edges: flow.edges.filter(([from, to]) => from !== fromId || to !== toId),
    }));
    setSelectedEdge(current => current?.from === fromId && current.to === toId ? null : current);
  }

  function removeSelectedEdge() {
    if (!selectedEdge) return;
    removeEdge(selectedEdge.from, selectedEdge.to);
  }

  function addNode() {
    if (graphMode !== "session") {
      setMessage("Procedure editing is available for Session Start and Session Close.");
      return;
    }
    const label = newNodeLabel.trim() || "New Step";
    const id = `${sessionProcedure}-${Date.now().toString(36)}`;
    updateActiveFlow(flow => ({
      ...flow,
      nodes: [
        ...flow.nodes,
        {
          id,
          label,
          detail: newNodeDetail.trim() || "New procedure step",
          tone: "info",
          issue: false,
          meta: "",
          actionType: newNodeActionType,
          actionValue: newNodeActionValue.trim(),
        },
      ],
      positions: {
        ...(flow.positions ?? {}),
        [id]: { x: 50, y: 50 },
      },
    }));
    setSelectedNodeId(id);
    setNewNodeLabel("");
    setNewNodeDetail("");
    setNewNodeActionValue("");
  }

  async function saveProcedure() {
    if (!editableFlows || !snapshot || graphMode !== "session") {
      setMessage("Only Session Start and Session Close procedures can be saved.");
      return;
    }
    setLoading(true);
    const response = await fetch("/api/project-dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save-procedure",
        projectRoot: snapshot.project.path,
        procedure: sessionProcedure,
        flow: editableFlows[sessionProcedure],
      }),
    });
    const data = (await response.json()) as DashboardResponse;
    if (data.ok && data.snapshot) {
      setSnapshot(data.snapshot);
      setEditableFlows(data.snapshot.flows);
      setSelectedEdge(null);
      setDirtyProcedures(current => ({ ...current, [sessionProcedure]: false }));
      setMessage(`${sessionProcedure === "sessionStart" ? "startup.md" : "close.md"} saved outside the repo.`);
    } else {
      setMessage(data.error ?? "Saving procedure failed.");
    }
    setLoading(false);
  }

  function moduleToolbar(id: ModuleId) {
    if (!snapshot) return null;
    if (id === "graph") {
      return (
        <div className={styles.graphTools}>
          <button onClick={() => runAction("session-start")} disabled={loading}>/session start</button>
          <button onClick={() => runAction("session-close")} disabled={loading}>/session close</button>
        </div>
      );
    }
    if (id === "tickets") return <span>{countOpenTickets(snapshot)} open</span>;
    if (id === "custom") return <span>{snapshot.customModules.length} items</span>;
    if (id === "selectedNode") return <span>{selectedNode?.issue ? "Issue" : "Clear"}</span>;
    if (id === "graphEditor") return <span>{graphMode === "session" ? "Editable" : "Read only"}</span>;
    if (id === "readiness") return <span>{snapshot.readiness.clear ? "Clear" : "Blocked"}</span>;
    if (id === "notes") return <span>{loading ? "Saving" : "Local"}</span>;
    if (id === "commits") return <span>{snapshot.git.commits.length} shown</span>;
    if (id === "stats") return <span>Current</span>;
    return <span>{snapshot.stats.files} files</span>;
  }

  function renderModuleContent(id: ModuleId) {
    if (!snapshot) return null;
    if (id === "graph" && activeFlow) {
      return (
        <FlowChart
          editable={graphMode === "session"}
          flow={activeFlow}
          selectedNodeId={selectedNode?.id ?? ""}
          onAddEdge={addEdge}
          onMoveNode={moveNode}
          onRemoveEdge={removeEdge}
          onSelectEdge={setSelectedEdge}
          onSelect={setSelectedNodeId}
          selectedEdge={selectedEdge}
        />
      );
    }

    if (id === "tickets") {
      return (
        <div className={styles.ticketList}>
          {snapshot.tickets.length === 0 && (
            <div className={styles.emptyState}>
              <strong>No open Paper Sleuth tickets</strong>
              <span>{snapshot.paperSleuth.status}</span>
              {snapshot.paperSleuth.projectTicketsPath && <small>{snapshot.paperSleuth.projectTicketsPath}</small>}
            </div>
          )}
          {snapshot.tickets.map(ticket => (
            <article className={`${styles.ticketCard} ${severityClass(ticket.severity)}`} key={ticket.id}>
              <div className={styles.ticketTop}>
                <span>{ticket.severity}</span>
                <span>{ticket.status}</span>
              </div>
              <h3>{ticket.title}</h3>
              <p>Source: {ticket.source}</p>
              {ticket.summary && <p>{ticket.summary}</p>}
              {ticket.updated && <p>Updated: {ticket.updated}</p>}
              <div className={styles.cardActions}>
                <button onClick={() => openTicketFile(ticket.path)} disabled={!ticket.path}>Open Ticket</button>
                {ticket.url ? <a href={ticket.url} target="_blank" rel="noreferrer">Source</a> : <button disabled>Source</button>}
              </div>
            </article>
          ))}
        </div>
      );
    }

    if (id === "custom") {
      return (
        <div className={styles.ticketList}>
          {snapshot.customModules.length === 0 && (
            <div className={styles.emptyState}>
              <strong>No custom modules</strong>
              <span>Drop JSON files into the global or project module folder.</span>
              <small>{snapshot.config.modulesDir}</small>
            </div>
          )}
          {snapshot.customModules.map(module => (
            <article className={`${styles.ticketCard} ${severityClass(module.severity)}`} key={module.id}>
              <div className={styles.ticketTop}>
                <span>{module.severity}</span>
                <span>{module.status}</span>
              </div>
              <h3>{module.title}</h3>
              <p>Source: {module.source}</p>
              {module.summary && <p>{module.summary}</p>}
              {module.content && <p>{module.content}</p>}
              {module.updated && <p>Updated: {module.updated}</p>}
              {module.url && (
                <div className={styles.cardActions}>
                  <a href={module.url} target="_blank" rel="noreferrer">Open</a>
                </div>
              )}
            </article>
          ))}
        </div>
      );
    }

    if (id === "selectedNode") {
      return selectedNode ? (
        <div className={`${styles.nodeInspector} ${selectedNode.issue ? styles.inspectorIssue : ""}`}>
          <h3>{selectedNode.label}</h3>
          <p>{selectedNode.detail}</p>
          <small>{selectedNode.actionType ?? "note"}: {selectedNode.actionValue || "No action value"}</small>
          {selectedNode.meta && <span>{selectedNode.meta}</span>}
        </div>
      ) : null;
    }

    if (id === "graphEditor") {
      return (
        <div className={styles.editorPanel}>
          <input value={newNodeLabel} onChange={event => setNewNodeLabel(event.target.value)} placeholder="New node label" />
          <input value={newNodeDetail} onChange={event => setNewNodeDetail(event.target.value)} placeholder="Step detail" />
          <select value={newNodeActionType} onChange={event => setNewNodeActionType(event.target.value as FlowNode["actionType"])}>
            <option value="command">Command</option>
            <option value="file">File</option>
            <option value="note">Note</option>
          </select>
          <input value={newNodeActionValue} onChange={event => setNewNodeActionValue(event.target.value)} placeholder="Command, file, or note" />
          <div>
            <button onClick={addNode}>Add Node</button>
            <button onClick={removeSelectedEdge} disabled={!selectedEdge || graphMode !== "session"}>Delete Wire</button>
            <button onClick={saveProcedure} disabled={graphMode !== "session" || !procedureDirty || loading}>Save Procedure</button>
          </div>
          <p>Drag nodes to snap to grid dots. Drag from a node port to another node to create an arrow. Click a wire to select it, or right-click a wire to delete it.</p>
          <small>{sessionProcedure === "sessionStart" ? snapshot.procedures.startup : snapshot.procedures.close}</small>
        </div>
      );
    }

    if (id === "readiness") {
      return (
        <div className={styles.readinessList}>
          {snapshot.readiness.items.map(item => (
            <div className={item.ok ? styles.readyItem : styles.blockedItem} key={item.id}>
              <span>{item.ok ? "OK" : "!"}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (id === "notes") {
      return (
        <div className={styles.moduleNotes}>
          <textarea value={notesDraft} onChange={event => setNotesDraft(event.target.value)} spellCheck={false} />
          <div className={styles.footerActions}>
            <span>notes.md</span>
            <button onClick={saveNotes} disabled={loading}>Save notes.md</button>
          </div>
        </div>
      );
    }

    if (id === "commits") {
      return (
        <div className={styles.moduleList}>
          {snapshot.git.commits.map(commit => (
            <a className={styles.commitRow} href={commit.url || undefined} target="_blank" rel="noreferrer" key={commit.hash}>
              <span>{commit.shortHash}</span>
              <div>
                <strong>{commit.subject}</strong>
                <small>{commit.author} - {commit.relativeDate}</small>
              </div>
            </a>
          ))}
        </div>
      );
    }

    if (id === "stats") {
      return (
        <div className={styles.moduleStats}>
          <div className={styles.metricGrid}>
            <Metric label="Files" value={String(snapshot.stats.files)} />
            <Metric label="Sessions" value={String(snapshot.stats.sessions)} />
            <Metric label="Lines" value={`${Math.round(snapshot.stats.linesOfCode / 100) / 10}k`} />
            <Metric label="Tickets" value={String(countOpenTickets(snapshot))} />
          </div>
          <div className={styles.languageBars}>
            {snapshot.stats.languages.map(language => (
              <div key={language.name}>
                <span>{language.name}</span>
                <b style={{ width: `${Math.max(8, (language.count / Math.max(snapshot.stats.files, 1)) * 100)}%` }} />
                <em>{language.count}</em>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className={styles.moduleList}>
        <FileTree node={snapshot.fileTree} depth={0} onOpen={openProjectFile} />
      </div>
    );
  }

  if (!snapshot || !activeFlow || !editableFlows) {
    return (
      <main className={styles.loadingShell}>
        <div className={styles.loadingCard}>
          <div className={styles.logoMark} />
          <h1>Project Dashboard</h1>
          <p>{loading ? "Collecting project data..." : message || "Dashboard unavailable."}</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.logoMark} />
          <span>Project Dashboard</span>
        </div>
        <nav className={styles.nav}>
          {(["Overview", "Notes", "Files", "Tickets", "Commits", "Stats", "Settings"] as MenuPage[]).map(item => (
            <button className={activePage === item ? styles.navActive : ""} key={item} onClick={() => setActivePage(item)}>
              <span className={styles.navIcon}>{item.slice(0, 1)}</span>
              {item}
            </button>
          ))}
        </nav>
        <ProjectCard snapshot={snapshot} />
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <label className={styles.projectPicker}>
            <span>Project:</span>
            <select value={selectedProjectId || snapshot.project.id} onChange={event => changeProject(event.target.value)}>
              {snapshot.projects.map(project => (
                <option value={project.id} key={project.id}>
                  {project.name}{project.ticketCount ? ` (${project.ticketCount})` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.segmented}>
            <button className={graphMode === "session" ? styles.selected : ""} onClick={() => setGraphMode("session")}>
              Session Flow
            </button>
            <button className={graphMode === "program" ? styles.selected : ""} onClick={() => setGraphMode("program")}>
              Program Flow
            </button>
          </div>

          {graphMode === "session" && (
            <div className={styles.segmentedSmall}>
              <button
                className={sessionProcedure === "sessionStart" ? styles.selected : ""}
                onClick={() => setSessionProcedure("sessionStart")}
              >
                Start
              </button>
              <button
                className={sessionProcedure === "sessionClose" ? styles.selected : ""}
                onClick={() => setSessionProcedure("sessionClose")}
              >
                Close
              </button>
            </div>
          )}

          <button className={styles.updateButton} onClick={() => runAction("refresh")} disabled={loading}>
            Update
          </button>
          <div className={styles.appControls} title={snapshot.appControl.available ? snapshot.appControl.command : "No launch target found"}>
            <button
              aria-label={`Start ${snapshot.appControl.label}`}
              className={styles.playButton}
              disabled={loading || !snapshot.appControl.available || snapshot.appControl.running}
              onClick={() => runAction("start-app")}
            >
              <span />
            </button>
            <button
              aria-label={`Stop ${snapshot.appControl.label}`}
              className={styles.stopButton}
              disabled={loading || !snapshot.appControl.available || !snapshot.appControl.running}
              onClick={() => runAction("stop-app")}
            >
              <span />
            </button>
          </div>
          <div className={styles.moduleMenuWrap}>
            <button className={styles.addModuleButton} onClick={() => setModuleMenuOpen(open => !open)}>
              Add Module
            </button>
            {moduleMenuOpen && (
              <div className={styles.moduleMenu}>
                {hiddenModules.map(module => (
                  <button key={module.id} onClick={() => showModule(module.id)}>
                    {MODULE_LABELS[module.id]}
                  </button>
                ))}
                {hiddenModules.length === 0 && <span>All modules are visible</span>}
                <button onClick={resetModuleLayout}>Reset Layout</button>
              </div>
            )}
          </div>
          <span className={styles.timestamp}>Last Snapshot: {formatDate(snapshot.generatedAt)}</span>
          <StatusPill tone={snapshot.codeGraph.issue ? "bad" : "good"}>CodeGraph: {snapshot.codeGraph.status}</StatusPill>
          <StatusPill tone={snapshot.git.clean ? "good" : "bad"}>Repo: {snapshot.git.clean ? "Clean" : "Dirty"}</StatusPill>
          <StatusPill tone="info">Snapshot: Latest</StatusPill>
          {graphMode === "session" && procedureDirty && <span className={styles.dirtyBadge}>Unsaved graph edits</span>}
          {graphMode === "session" && (
            <button className={styles.saveButton} onClick={saveProcedure} disabled={!procedureDirty || loading}>
              SAVE
            </button>
          )}
        </header>

        {activePage === "Overview" ? (
          <section className={styles.moduleWorkspace} ref={workspaceRef}>
            {visibleModules.map(module => (
              <WorkspaceModule
                key={module.id}
                module={module}
                title={module.id === "graph" ? activeFlow.title : MODULE_LABELS[module.id]}
                toolbar={moduleToolbar(module.id)}
                onHide={() => hideModule(module.id)}
                onUpdate={patch => updateModuleLayout(module.id, patch)}
              >
                {renderModuleContent(module.id)}
              </WorkspaceModule>
            ))}
          </section>
        ) : (
          <PagePanel
            activePage={activePage}
            configDraft={configDraft}
            notesDraft={notesDraft}
            onConfigChange={setConfigDraft}
            onNotesChange={setNotesDraft}
            onOpenFile={openProjectFile}
            onOpenTicket={openTicketFile}
            onSaveConfig={saveConfig}
            onSaveNotes={saveNotes}
            snapshot={snapshot}
          />
        )}

        <section className={styles.bottomGrid}>
          <section className={styles.notesPanel}>
            <PanelTitle title="notes.md" action={loading ? "Saving" : "Saved"} />
            <textarea value={notesDraft} onChange={event => setNotesDraft(event.target.value)} spellCheck={false} />
            <div className={styles.footerActions}>
              <span>Markdown</span>
              <button onClick={saveNotes} disabled={loading}>Save notes.md</button>
            </div>
          </section>

          <section className={styles.commitsPanel}>
            <PanelTitle title="Recent Commits" action="View all" />
            {snapshot.git.commits.map(commit => (
              <a className={styles.commitRow} href={commit.url || undefined} target="_blank" rel="noreferrer" key={commit.hash}>
                <span>{commit.shortHash}</span>
                <div>
                  <strong>{commit.subject}</strong>
                  <small>{commit.author} - {commit.relativeDate}</small>
                </div>
              </a>
            ))}
          </section>

          <section className={styles.statsPanel}>
            <PanelTitle title="Project Stats" action="Current" />
            <div className={styles.metricGrid}>
              <Metric label="Files" value={String(snapshot.stats.files)} />
              <Metric label="Sessions" value={String(snapshot.stats.sessions)} />
              <Metric label="Lines" value={`${Math.round(snapshot.stats.linesOfCode / 100) / 10}k`} />
              <Metric label="Tickets" value={String(countOpenTickets(snapshot))} />
            </div>
            <div className={styles.languageBars}>
              {snapshot.stats.languages.map(language => (
                <div key={language.name}>
                  <span>{language.name}</span>
                  <b style={{ width: `${Math.max(8, (language.count / Math.max(snapshot.stats.files, 1)) * 100)}%` }} />
                  <em>{language.count}</em>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.filePanel}>
            <PanelTitle title="File Explorer" action={`${snapshot.stats.files} files`} />
            <FileTree node={snapshot.fileTree} depth={0} onOpen={openProjectFile} />
          </section>
        </section>

        {message && <div className={styles.toast}>{message}</div>}
      </section>
    </main>
  );
}

function WorkspaceModule({
  children,
  module,
  onHide,
  onUpdate,
  title,
  toolbar,
}: {
  children: React.ReactNode;
  module: WorkspaceModuleState;
  onHide: () => void;
  onUpdate: (patch: Partial<WorkspaceModuleState>) => void;
  title: string;
  toolbar: React.ReactNode;
}) {
  type ModuleInteraction = {
    kind: "move" | "resize";
    startX: number;
    startY: number;
    start: WorkspaceModuleState;
  };
  const [interaction, setInteraction] = useState<{
    kind: "move" | "resize";
    startX: number;
    startY: number;
    start: WorkspaceModuleState;
  } | null>(null);
  const interactionRef = useRef<ModuleInteraction | null>(null);

  function clearInteraction() {
    interactionRef.current = null;
    setInteraction(null);
  }

  function beginInteraction(kind: "move" | "resize", event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("button,a,input,select,textarea")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextInteraction = { kind, startX: event.clientX, startY: event.clientY, start: module };
    interactionRef.current = nextInteraction;
    setInteraction(nextInteraction);
  }

  function applyInteraction(clientX: number, clientY: number) {
    const currentInteraction = interactionRef.current ?? interaction;
    if (!currentInteraction) return;
    const dx = Math.round((clientX - currentInteraction.startX) / SNAP_GRID);
    const dy = Math.round((clientY - currentInteraction.startY) / SNAP_GRID);
    if (currentInteraction.kind === "move") {
      onUpdate({ x: currentInteraction.start.x + dx, y: currentInteraction.start.y + dy });
      return;
    }
    onUpdate({
      w: currentInteraction.start.w + dx,
      h: currentInteraction.start.h + dy,
    });
  }

  function updateInteraction(event: React.PointerEvent<HTMLElement>) {
    applyInteraction(event.clientX, event.clientY);
  }

  useEffect(() => {
    if (!interaction) return;
    const handleMove = (event: PointerEvent) => applyInteraction(event.clientX, event.clientY);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", clearInteraction, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", clearInteraction);
    };
  });

  return (
    <section
      className={styles.workspaceModule}
      onPointerCancel={clearInteraction}
      onPointerMove={updateInteraction}
      onPointerUp={clearInteraction}
      style={{
        height: module.h * SNAP_GRID,
        left: module.x * SNAP_GRID,
        top: module.y * SNAP_GRID,
        width: module.w * SNAP_GRID,
      }}
    >
      <header className={styles.moduleHeader} onPointerDown={event => beginInteraction("move", event)}>
        <div>
          <span className={styles.dot} />
          <h2>{title}</h2>
        </div>
        <div className={styles.moduleHeaderActions}>
          {toolbar}
          <button aria-label={`Hide ${title}`} onClick={onHide}>x</button>
        </div>
      </header>
      <div className={styles.moduleContent}>{children}</div>
      <span
        className={styles.moduleResize}
        onPointerCancel={clearInteraction}
        onPointerDown={event => beginInteraction("resize", event)}
        onPointerMove={updateInteraction}
        onPointerUp={clearInteraction}
      />
    </section>
  );
}

function FlowChart({
  editable,
  flow,
  onAddEdge,
  onMoveNode,
  onRemoveEdge,
  selectedNodeId,
  selectedEdge,
  onSelectEdge,
  onSelect,
}: {
  editable: boolean;
  flow: Flow;
  onAddEdge: (fromId: string, toId: string) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onRemoveEdge: (fromId: string, toId: string) => void;
  selectedNodeId: string;
  selectedEdge: EdgeSelection;
  onSelectEdge: (edge: EdgeSelection) => void;
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [wire, setWire] = useState<{ fromId: string; fromPort: PortName; x: number; y: number } | null>(null);
  const positionById = new Map(flow.nodes.map((node, index) => [
    node.id,
    flow.positions?.[node.id] ?? nodePosition(node.id, index),
  ]));

  function snapPosition(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 50 };
    const gridX = (18 / rect.width) * 100;
    const gridY = (18 / rect.height) * 100;
    const rawX = ((clientX - rect.left) / rect.width) * 100;
    const rawY = ((clientY - rect.top) / rect.height) * 100;
    return {
      x: Math.max(4, Math.min(96, Math.round(rawX / gridX) * gridX)),
      y: Math.max(4, Math.min(92, Math.round(rawY / gridY) * gridY)),
    };
  }

  function pointerPercent(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 50 };
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (draggingNodeId) {
      onMoveNode(draggingNodeId, snapPosition(event.clientX, event.clientY));
    }
    if (wire) {
      setWire({ ...wire, ...pointerPercent(event.clientX, event.clientY) });
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (wire) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-node-id]") as HTMLElement | null;
      const toId = target?.dataset.nodeId;
      if (toId) onAddEdge(wire.fromId, toId);
      setWire(null);
    }
    setDraggingNodeId(null);
  }

  return (
    <div
      className={styles.chartCanvas}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={canvasRef}
    >
      <svg className={styles.edges} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          {(["core", "optional", "issue", "selected"] as EdgeTone[]).map(tone => (
            <marker
              id={`arrow-${tone}`}
              key={tone}
              markerHeight="7"
              markerWidth="7"
              orient="auto"
              refX="12"
              refY="6"
              viewBox="0 0 12 12"
            >
              <path d="M 0.5 1 L 12 6 L 0.5 11 Z" fill={edgeColor(tone)} stroke="none" />
            </marker>
          ))}
        </defs>
        {flow.edges.map(([fromId, toId]) => {
          const from = positionById.get(fromId);
          const to = positionById.get(toId);
          const toNode = flow.nodes.find(node => node.id === toId);
          if (!from || !to) return null;
          const selected = selectedEdge?.from === fromId && selectedEdge.to === toId;
          const tone = edgeToneForNode(toNode, selected);
          return (
            <path
              className={selected ? styles.edgeSelected : ""}
              d={edgePath(from, to)}
              key={`${fromId}-${toId}`}
              markerEnd={`url(#arrow-${tone})`}
              style={{ "--edge-color": edgeColor(tone) } as React.CSSProperties}
              onClick={event => {
                event.stopPropagation();
                onSelectEdge({ from: fromId, to: toId });
              }}
              onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
                if (!editable) return;
                onRemoveEdge(fromId, toId);
              }}
            />
          );
        })}
        {wire && positionById.get(wire.fromId) && (
          <path
            className={styles.wirePreview}
            d={previewEdgePath(positionById.get(wire.fromId)!, wire.fromPort, { x: wire.x, y: wire.y })}
            markerEnd="url(#arrow-selected)"
            style={{ "--edge-color": edgeColor("selected") } as React.CSSProperties}
          />
        )}
      </svg>

      {flow.nodes.map((node, index) => {
        const position = positionById.get(node.id) ?? nodePosition(node.id, index);
        return (
          <div
            className={[
              styles.flowNode,
              styles[node.tone],
              node.issue ? styles.nodeIssue : "",
              selectedNodeId === node.id ? styles.nodeSelected : "",
            ].join(" ")}
            data-node-id={node.id}
            key={node.id}
            onClick={() => {
              onSelect(node.id);
              onSelectEdge(null);
            }}
            onPointerDown={event => {
              if (!editable) return;
              if ((event.target as HTMLElement).dataset.port) return;
              setDraggingNodeId(node.id);
              onSelect(node.id);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            role="button"
            style={{ left: `${position.x}%`, top: `${position.y}%` }}
            tabIndex={0}
          >
            {editable && (
              <>
                {(["top", "right", "bottom", "left"] as const).map(port => (
                  <span
                    className={`${styles.nodePort} ${styles[port]}`}
                    data-port={port}
                    key={port}
                    onPointerDown={event => {
                      event.stopPropagation();
                      const percent = pointerPercent(event.clientX, event.clientY);
                      setWire({ fromId: node.id, fromPort: port, ...percent });
                      onSelectEdge(null);
                    }}
                  />
                ))}
              </>
            )}
            <span className={styles.nodeKicker}>{node.tone}</span>
            <strong>{node.label}</strong>
            <small>{node.detail}</small>
            {node.meta && <em>{node.meta}</em>}
          </div>
        );
      })}
    </div>
  );
}

function ProjectCard({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <section className={styles.projectCard}>
      <h2>{snapshot.project.name}</h2>
      <p>{snapshot.project.path}</p>
      <dl>
        <div>
          <dt>Branch</dt>
          <dd>{snapshot.git.branch}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd className={snapshot.git.clean ? styles.goodText : styles.badText}>{snapshot.git.status}</dd>
        </div>
        <div>
          <dt>Ahead / Behind</dt>
          <dd>{snapshot.git.aheadBehind || "0 / 0"}</dd>
        </div>
      </dl>
      {snapshot.git.remoteUrl && <a href={snapshot.git.remoteUrl} target="_blank" rel="noreferrer">Open in GitHub</a>}
    </section>
  );
}

function PagePanel({
  activePage,
  configDraft,
  notesDraft,
  onConfigChange,
  onNotesChange,
  onOpenFile,
  onOpenTicket,
  onSaveConfig,
  onSaveNotes,
  snapshot,
}: {
  activePage: MenuPage;
  configDraft: string;
  notesDraft: string;
  onConfigChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onOpenFile: (path: string) => void;
  onOpenTicket: (path?: string) => void;
  onSaveConfig: () => void;
  onSaveNotes: () => void;
  snapshot: DashboardSnapshot;
}) {
  return (
    <section className={styles.pagePanel}>
      <div className={styles.pageHeader}>
        <div>
          <span className={styles.dot} />
          <h2>{activePage}</h2>
        </div>
        <span>{snapshot.project.name}</span>
      </div>

      {activePage === "Notes" && (
        <section className={styles.pageCard}>
          <textarea value={notesDraft} onChange={event => onNotesChange(event.target.value)} spellCheck={false} />
          <div className={styles.footerActions}>
            <span>Writes local notes.md</span>
            <button onClick={onSaveNotes}>Save notes.md</button>
          </div>
        </section>
      )}

      {activePage === "Files" && (
        <section className={styles.pageCard}>
          <FileTree node={snapshot.fileTree} depth={0} onOpen={onOpenFile} />
        </section>
      )}

      {activePage === "Tickets" && (
        <section className={styles.pageList}>
          {snapshot.tickets.length === 0 && (
            <div className={styles.emptyState}>
              <strong>No open Paper Sleuth tickets</strong>
              <span>{snapshot.paperSleuth.status}</span>
              {snapshot.paperSleuth.projectTicketsPath && <small>{snapshot.paperSleuth.projectTicketsPath}</small>}
            </div>
          )}
          {snapshot.tickets.map(ticket => (
            <article className={`${styles.ticketCard} ${severityClass(ticket.severity)}`} key={ticket.id}>
              <div className={styles.ticketTop}>
                <span>{ticket.severity}</span>
                <span>{ticket.status}</span>
              </div>
              <h3>{ticket.title}</h3>
              <p>Source: {ticket.source}</p>
              {ticket.summary && <p>{ticket.summary}</p>}
              {ticket.updated && <p>Updated: {ticket.updated}</p>}
              <div className={styles.cardActions}>
                <button onClick={() => onOpenTicket(ticket.path)} disabled={!ticket.path}>Open Ticket</button>
                {ticket.url ? <a href={ticket.url} target="_blank" rel="noreferrer">Source</a> : <button disabled>Source</button>}
              </div>
            </article>
          ))}
        </section>
      )}

      {activePage === "Commits" && (
        <section className={styles.pageCard}>
          {snapshot.git.commits.map(commit => (
            <a className={styles.commitRow} href={commit.url || undefined} target="_blank" rel="noreferrer" key={commit.hash}>
              <span>{commit.shortHash}</span>
              <div>
                <strong>{commit.subject}</strong>
                <small>{commit.author} - {commit.relativeDate}</small>
              </div>
            </a>
          ))}
        </section>
      )}

      {activePage === "Stats" && (
        <section className={styles.pageStats}>
          <Metric label="Files" value={String(snapshot.stats.files)} />
          <Metric label="Sessions" value={String(snapshot.stats.sessions)} />
          <Metric label="Lines" value={`${Math.round(snapshot.stats.linesOfCode / 100) / 10}k`} />
          <Metric label="Tickets" value={String(countOpenTickets(snapshot))} />
        </section>
      )}

      {activePage === "Settings" && (
        <section className={styles.pageCard}>
          <dl className={styles.settingsList}>
            <div>
              <dt>Config file</dt>
              <dd>{snapshot.config.path}</dd>
            </div>
            <div>
              <dt>Dashboard home</dt>
              <dd>{snapshot.config.home}</dd>
            </div>
            <div>
              <dt>Custom module folders</dt>
              <dd>{`${snapshot.config.modulesDir}\\global and ${snapshot.config.modulesDir}\\${snapshot.project.id}`}</dd>
            </div>
            <div>
              <dt>Global procedure folder</dt>
              <dd>{snapshot.procedures.dir}</dd>
            </div>
            <div>
              <dt>Startup file</dt>
              <dd>{snapshot.procedures.startup}</dd>
            </div>
            <div>
              <dt>Close file</dt>
              <dd>{snapshot.procedures.close}</dd>
            </div>
          </dl>
          <div className={styles.configEditor}>
            <div className={styles.footerActions}>
              <span>Local machine config</span>
              <button onClick={onSaveConfig}>Save config</button>
            </div>
            <textarea value={configDraft} onChange={event => onConfigChange(event.target.value)} spellCheck={false} />
            <small>{`Custom module JSON: {"id":"build-risk","title":"Build Risk","summary":"Watch installer regressions","severity":"Medium","status":"Open"}`}</small>
          </div>
        </section>
      )}
    </section>
  );
}

function PanelTitle({ title, action }: { title: string; action: string }) {
  return (
    <div className={styles.panelTitle}>
      <h2>{title}</h2>
      <span>{action}</span>
    </div>
  );
}

function StatusPill({ children, tone }: { children: React.ReactNode; tone: "good" | "bad" | "info" }) {
  return <span className={`${styles.statusPill} ${styles[tone]}`}>{children}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FileTree({ node, depth, onOpen }: { node: FileNode; depth: number; onOpen: (path: string) => void }) {
  return (
    <div className={depth === 0 ? styles.fileRoot : styles.fileGroup}>
      {depth > 0 && (
        <button
          className={`${styles.fileItem} ${node.uncommitted ? styles.uncommittedFile : ""}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => onOpen(node.path)}
        >
          <span>{node.type === "dir" ? "DIR" : "FILE"}</span>
          {node.name}
        </button>
      )}
      {node.children.slice(0, depth > 1 ? 16 : 24).map(child => (
        <FileTree depth={depth + 1} key={`${child.path}-${child.type}`} node={child} onOpen={onOpen} />
      ))}
    </div>
  );
}
