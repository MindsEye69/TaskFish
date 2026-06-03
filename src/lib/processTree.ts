import type { ProcessInfo, TreeNode } from "./types";

export function buildTree(flat: ProcessInfo[]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  flat.forEach((p) => map.set(p.id, { ...p, children: [] }));

  const roots: TreeNode[] = [];
  map.forEach((node) => {
    const parent = map.get(node.ppid);
    if (parent && parent.id !== node.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

export function flattenTree(nodes: TreeNode[]): ProcessInfo[] {
  const result: ProcessInfo[] = [];
  function walk(n: TreeNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/** Get all descendants of a node (including itself) */
export function collectTree(node: TreeNode): TreeNode[] {
  const result: TreeNode[] = [node];
  node.children.forEach((c) => result.push(...collectTree(c)));
  return result;
}

/** Find a node by id anywhere in the tree */
export function findNode(nodes: TreeNode[], id: number): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** Group nodes by name into virtual nodes, preserving tree hierarchy */
export function groupNodes(nodes: TreeNode[]): TreeNode[] {
  const nameGroups = new Map<string, TreeNode[]>();
  
  // 1. Collect all instances of each name (Smart Grouping)
  nodes.forEach((n) => {
    const rawName = n.name || "Unknown";
    const cleanName = rawName.toLowerCase().replace(/\.exe$/i, "");
    
    // Group by name for user/background processes. 
    // Only group by name+ppid for 'system' processes to keep different services distinct.
    const key = n.category === "system" ? `${cleanName}-${n.ppid}` : cleanName;
    
    const arr = nameGroups.get(key) || [];
    arr.push(n);
    nameGroups.set(key, arr);
  });

  const result: TreeNode[] = [];
  let groupId = -10000;

  nameGroups.forEach((instances, name) => {
    const totalRam = instances.reduce((sum, c) => sum + c.ramMB, 0);
    const totalCpu = instances.reduce((sum, c) => sum + c.cpu, 0);
    const totalHandles = instances.reduce((sum, c) => sum + c.handles, 0);
    
    // 2. Preserve all original children that are NOT the same name
    // (If they are the same name, they are already part of this group)
    const otherChildren: TreeNode[] = [];
    instances.forEach(inst => {
      inst.children.forEach(child => {
        if (child.name !== name) {
          otherChildren.push(child);
        }
      });
    });

    const first = instances[0];
    // Use the actual process name, NOT the grouping key (which may include ppid for system processes)
    const displayName = (first.name || "Unknown").toLowerCase().replace(/\.exe$/i, "");

    result.push({
      id: groupId--,
      name: displayName,
      ramMB: Math.round(totalRam * 10) / 10,
      cpu: Math.round(totalCpu * 10) / 10,
      handles: totalHandles,
      ppid: 0,
      trust: first.trust,
      category: first.category,
      vendor: first.vendor,          // carry signer company through group nodes
      children: [...instances, ...otherChildren], 
    });
  });

  return result;
}

const HELPER_NAMES = new Set(["conhost", "cmd", "werfault", "werfaultsecure"]);

function normalizeProcessName(name: string) {
  return (name || "").toLowerCase().replace(/\.exe$/i, "");
}

function isHelperProcess(name: string) {
  return HELPER_NAMES.has(normalizeProcessName(name));
}

function isClearParentProcess(proc: ProcessInfo) {
  return proc.trust !== "unknown" && proc.category !== "unknown";
}

/**
 * Like groupNodes, but absorbs known helper processes (conhost, cmd) into
 * the group node of their closest clear non-helper ancestor. Orphaned helpers
 * and helpers owned by unknown parents stay as their own group.
 */
export function groupWithHelpers(flat: ProcessInfo[]): TreeNode[] {
  const groups = groupNodes(flat.map(p => ({ ...p, children: [] } as TreeNode)));

  const pidMap = new Map(flat.map(p => [p.id, p]));
  const pidToGroup = new Map<number, TreeNode>();
  for (const group of groups) {
    const groupName = normalizeProcessName(group.name);
    for (const child of group.children) {
      if (normalizeProcessName(child.name) === groupName) {
        pidToGroup.set(child.id, group);
      }
    }
  }

  const resolveClearParentGroup = (proc: ProcessInfo): TreeNode | null => {
    const seen = new Set<number>([proc.id]);
    let parent = pidMap.get(proc.ppid);

    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      if (isHelperProcess(parent.name)) {
        parent = pidMap.get(parent.ppid);
        continue;
      }

      if (!isClearParentProcess(parent)) return null;
      return pidToGroup.get(parent.id) ?? null;
    }

    return null;
  };

  const toRemove = new Set<TreeNode>();

  for (const group of groups) {
    if (!isHelperProcess(group.name)) continue;

    const helperName = normalizeProcessName(group.name);
    const remaining: TreeNode[] = [];

    for (const child of group.children) {
      const parentGroup = resolveClearParentGroup(child);
      if (!parentGroup || parentGroup === group) {
        remaining.push(child);
        continue;
      }

      parentGroup.children.push(child);
      parentGroup.ramMB = Math.round((parentGroup.ramMB + child.ramMB) * 10) / 10;
      parentGroup.cpu = Math.round((parentGroup.cpu + child.cpu) * 10) / 10;
      parentGroup.handles += child.handles;
      if (!parentGroup.helperCounts) parentGroup.helperCounts = {};
      parentGroup.helperCounts[helperName] = (parentGroup.helperCounts[helperName] || 0) + 1;
    }

    if (remaining.length === 0) {
      toRemove.add(group);
    } else {
      group.children = remaining;
      group.ramMB = Math.round(remaining.reduce((s, c) => s + c.ramMB, 0) * 10) / 10;
      group.cpu = Math.round(remaining.reduce((s, c) => s + c.cpu, 0) * 10) / 10;
      group.handles = remaining.reduce((s, c) => s + c.handles, 0);
    }
  }

  return groups.filter(g => !toRemove.has(g));
}

/** Recursively count all unique process IDs in a tree branch */
export function countAllPids(node: TreeNode): number {
  const pids = new Set<number>();
  function walk(n: TreeNode) {
    if (n.id > 0) pids.add(n.id); // ignore virtual group IDs
    n.children.forEach(walk);
  }
  walk(node);
  return pids.size;
}
