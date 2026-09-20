// ship
// designed and built by onyxpowered.

export const DEFAULT_MAX_TREE_NODES = 2000;

export async function resolveDescendants(rootPid, getChildren, { maxNodes = DEFAULT_MAX_TREE_NODES } = {}) {
  const visited = new Set([rootPid]);
  const queue = [rootPid];
  let truncated = false;

  while (queue.length > 0) {
    if (visited.size >= maxNodes) {
      truncated = true;
      break;
    }
    const current = queue.shift();
    let children;
    try {
      children = await getChildren(current);
    } catch {
      children = [];
    }
    for (const child of children ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      queue.push(child);
      if (visited.size >= maxNodes) {
        truncated = true;
        break;
      }
    }
  }

  return { pids: visited, truncated };
}

export async function resolveDescendantsForRoots(rootPids, getChildren, options = {}) {
  const cache = new Map();
  const cachedGetChildren = async (pid) => {
    if (cache.has(pid)) return cache.get(pid);
    const children = await getChildren(pid);
    cache.set(pid, children);
    return children;
  };

  const result = new Map();
  for (const rootPid of rootPids) {
    result.set(rootPid, await resolveDescendants(rootPid, cachedGetChildren, options));
  }
  return result;
}

export function buildChildrenLookup(parentPidByPid) {
  const childrenByParent = new Map();
  for (const [pid, ppid] of parentPidByPid) {
    if (ppid === null || ppid === undefined) continue;
    if (!childrenByParent.has(ppid)) {
      childrenByParent.set(ppid, []);
    }
    childrenByParent.get(ppid).push(pid);
  }
  return (pid) => childrenByParent.get(pid) ?? [];
}
