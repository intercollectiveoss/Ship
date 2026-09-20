// ship
// designed and built by onyxpowered.

export function computeStartWaves(blocks) {
  const remaining = new Map(Object.keys(blocks).map((name) => [name, new Set(blocks[name].dependsOn ?? [])]));
  const waves = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()].filter(([, deps]) => deps.size === 0).map(([name]) => name);
    if (ready.length === 0) {
      throw new Error(`dependency cycle detected among: ${[...remaining.keys()].join(', ')}`);
    }
    ready.sort();
    waves.push(ready);
    for (const name of ready) remaining.delete(name);
    for (const deps of remaining.values()) {
      for (const name of ready) deps.delete(name);
    }
  }
  return waves;
}

export function flattenStartOrder(blocks) {
  return computeStartWaves(blocks).flat();
}

export function dependentsOf(blocks, name) {
  return Object.entries(blocks)
    .filter(([, block]) => (block.dependsOn ?? []).includes(name))
    .map(([dependentName]) => dependentName);
}

export function directDependenciesOf(blocks, name) {
  return [...(blocks[name]?.dependsOn ?? [])];
}

export function transitiveDependentsOf(blocks, name) {
  const result = new Set();
  const queue = [name];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependent of dependentsOf(blocks, current)) {
      if (!result.has(dependent)) {
        result.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return [...result];
}
