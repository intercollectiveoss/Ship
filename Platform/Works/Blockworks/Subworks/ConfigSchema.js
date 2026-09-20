// ship
// designed and built by onyxpowered.

export const PRIORITY_TIERS = Object.freeze(['high', 'normal', 'low']);

// What a Block can ask ship to provision and wire up before it's spawned --
// see Connectors.js for what each one actually resolves to.
export const KNOWN_CONNECTORS = Object.freeze(['vault']);

const CPU_ALLOWANCE_PATTERN = /^\d+(\.\d+)?%$/;
const MEMORY_ALLOWANCE_PATTERN = /^\d+(\.\d+)?(b|kb|mb|gb)$/i;

export function validateAllowance(name, allowance) {
  if (allowance === undefined) return true;
  if (allowance === null || typeof allowance !== 'object' || Array.isArray(allowance)) {
    throw new Error(`Block "${name}" allowance must be an object`);
  }
  if (allowance.cpu !== undefined) {
    if (typeof allowance.cpu !== 'string' || !CPU_ALLOWANCE_PATTERN.test(allowance.cpu)) {
      throw new Error(`Block "${name}" allowance.cpu must be a percentage string like "50%", got ${JSON.stringify(allowance.cpu)}`);
    }
  }
  if (allowance.memory !== undefined) {
    if (typeof allowance.memory !== 'string' || !MEMORY_ALLOWANCE_PATTERN.test(allowance.memory)) {
      throw new Error(`Block "${name}" allowance.memory must be a size string like "512mb", got ${JSON.stringify(allowance.memory)}`);
    }
  }
  return true;
}

export function validateHealthCheck(name, healthCheck) {
  if (healthCheck === undefined || healthCheck === null) return true;
  if (typeof healthCheck !== 'object' || Array.isArray(healthCheck)) {
    throw new Error(`Block "${name}" healthCheck must be an object`);
  }
  const hasPort = healthCheck.port !== undefined;
  const hasUrl = healthCheck.url !== undefined;
  if (hasPort === hasUrl) {
    throw new Error(`Block "${name}" healthCheck must declare exactly one of "port" or "url"`);
  }
  if (hasPort && (!Number.isInteger(healthCheck.port) || healthCheck.port <= 0 || healthCheck.port > 65535)) {
    throw new Error(`Block "${name}" healthCheck.port must be an integer between 1 and 65535`);
  }
  if (hasUrl && (typeof healthCheck.url !== 'string' || !/^https?:\/\//.test(healthCheck.url))) {
    throw new Error(`Block "${name}" healthCheck.url must be an http:// or https:// string`);
  }
  if (healthCheck.timeoutMs !== undefined && (!Number.isFinite(healthCheck.timeoutMs) || healthCheck.timeoutMs <= 0)) {
    throw new Error(`Block "${name}" healthCheck.timeoutMs must be a positive number`);
  }
  if (healthCheck.intervalMs !== undefined && (!Number.isFinite(healthCheck.intervalMs) || healthCheck.intervalMs <= 0)) {
    throw new Error(`Block "${name}" healthCheck.intervalMs must be a positive number`);
  }
  return true;
}

export function validateBlockConfig(name, block) {
  if (typeof block.command !== 'string' || block.command.length === 0) {
    throw new Error(`Block "${name}" is missing a command`);
  }
  if (block.priority !== undefined && !PRIORITY_TIERS.includes(block.priority)) {
    throw new Error(`Block "${name}" has an invalid priority: ${block.priority}`);
  }
  if (block.dependsOn !== undefined && !Array.isArray(block.dependsOn)) {
    throw new Error(`Block "${name}" dependsOn must be an array of Block names`);
  }
  if (block.expose !== undefined && typeof block.expose !== 'boolean') {
    throw new Error(`Block "${name}" expose must be a boolean`);
  }
  if (block.readyTimeoutMs !== undefined && (!Number.isFinite(block.readyTimeoutMs) || block.readyTimeoutMs <= 0)) {
    throw new Error(`Block "${name}" readyTimeoutMs must be a positive number`);
  }
  if (block.connectors !== undefined) {
    if (!Array.isArray(block.connectors)) {
      throw new Error(`Block "${name}" connectors must be an array of connector names`);
    }
    for (const connector of block.connectors) {
      if (!KNOWN_CONNECTORS.includes(connector)) {
        throw new Error(`Block "${name}" declares unknown connector "${connector}" (known: ${KNOWN_CONNECTORS.join(', ')})`);
      }
    }
  }
  validateAllowance(name, block.allowance);
  validateHealthCheck(name, block.healthCheck);
  return true;
}

export function validateshipConfig(config) {
  if (config.priority !== undefined && !PRIORITY_TIERS.includes(config.priority)) {
    throw new Error(`app-level priority is invalid: ${config.priority}`);
  }
  if (config.blocks == null || typeof config.blocks !== 'object') {
    throw new Error('ship.config.js must declare at least one Block under "blocks"');
  }
  const names = Object.keys(config.blocks);
  if (names.length === 0) {
    throw new Error('ship.config.js must declare at least one Block under "blocks"');
  }
  for (const name of names) {
    validateBlockConfig(name, config.blocks[name]);
  }
  for (const name of names) {
    const dependsOn = config.blocks[name].dependsOn ?? [];
    for (const dep of dependsOn) {
      if (!names.includes(dep)) {
        throw new Error(`Block "${name}" depends on unknown Block "${dep}"`);
      }
    }
  }
  detectDependencyCycle(config.blocks);
  return true;
}

export function detectDependencyCycle(blocks) {
  const visiting = new Set();
  const visited = new Set();

  function visit(name, path) {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`dependency cycle detected: ${[...path, name].join(' -> ')}`);
    }
    visiting.add(name);
    const dependsOn = blocks[name]?.dependsOn ?? [];
    for (const dep of dependsOn) {
      visit(dep, [...path, name]);
    }
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of Object.keys(blocks)) {
    visit(name, []);
  }
}

export function resolveEntryBlock(config) {
  const explicit = Object.entries(config.blocks).filter(([, block]) => block.expose === true);
  if (explicit.length > 0) {
    return explicit.map(([name]) => name);
  }
  const names = Object.keys(config.blocks);
  return names.length === 1 ? names : [];
}
