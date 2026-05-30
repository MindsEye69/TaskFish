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
