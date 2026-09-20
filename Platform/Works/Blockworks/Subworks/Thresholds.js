// ship
// designed and built by onyxpowered.

const MEMORY_UNIT_MULTIPLIERS = Object.freeze({
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
});

const CPU_PATTERN = /^(\d+(?:\.\d+)?)%$/;
const MEMORY_PATTERN = /^(\d+(?:\.\d+)?)(b|kb|mb|gb)$/i;

export const DEFAULT_UNIVERSAL_CEILING = Object.freeze({ cpuPercent: 90, memoryRatio: 0.9 });

export function parseCpuPercent(value) {
  const match = CPU_PATTERN.exec(value);
  if (!match) {
    throw new Error(`invalid cpu allowance: ${JSON.stringify(value)}`);
  }
  return Number(match[1]);
}

export function parseMemoryBytes(value) {
  const match = MEMORY_PATTERN.exec(value);
  if (!match) {
    throw new Error(`invalid memory allowance: ${JSON.stringify(value)}`);
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return Math.round(amount * MEMORY_UNIT_MULTIPLIERS[unit]);
}

export function evaluatePerBlockBreach(sample, allowance = {}) {
  if (sample == null || sample.alive === false || sample.stale) {
    return null;
  }
  const breaches = [];
  if (allowance.cpu !== undefined && sample.cpuPercent !== null && sample.cpuPercent !== undefined) {
    const limit = parseCpuPercent(allowance.cpu);
    if (sample.cpuPercent > limit) {
      breaches.push({ tier: 'per-block', metric: 'cpu', value: sample.cpuPercent, limit });
    }
  }
  if (allowance.memory !== undefined) {
    const limit = parseMemoryBytes(allowance.memory);
    if (sample.rssBytes > limit) {
      breaches.push({ tier: 'per-block', metric: 'memory', value: sample.rssBytes, limit });
    }
  }
  return breaches.length > 0 ? breaches : null;
}

export function evaluateUniversalBreach(systemSample, ceiling = DEFAULT_UNIVERSAL_CEILING) {
  if (systemSample == null) return null;
  const breaches = [];
  if (ceiling.cpuPercent !== undefined && systemSample.cpuPercent > ceiling.cpuPercent) {
    breaches.push({ tier: 'universal', metric: 'cpu', value: systemSample.cpuPercent, limit: ceiling.cpuPercent });
  }
  if (ceiling.memoryRatio !== undefined && systemSample.memory) {
    const ratio = systemSample.memory.usedBytes / systemSample.memory.totalBytes;
    if (ratio > ceiling.memoryRatio) {
      breaches.push({ tier: 'universal', metric: 'memory', value: ratio, limit: ceiling.memoryRatio });
    }
  }
  return breaches.length > 0 ? breaches : null;
}
