// ship
// designed and built by onyxpowered.

export const CHANNEL_STATES = Object.freeze(['ok', 'degraded', 'down']);

export function createSystemSample(cpuPercent, totalBytes, usedBytes, freeBytes, ageMs) {
  return Object.freeze({
    cpuPercent,
    memory: Object.freeze({ totalBytes, usedBytes, freeBytes }),
    age: ageMs,
  });
}

export function createProcessSample(cpuPercent, rssBytes, alive, firstSample, ageMs, stale) {
  return Object.freeze({ cpuPercent, rssBytes, alive, firstSample, ageMs, stale });
}

export function createTick(timestampNs, system, perProcess, systemChannel, perProcessChannel) {
  if (!CHANNEL_STATES.includes(systemChannel) || !CHANNEL_STATES.includes(perProcessChannel)) {
    throw new Error(`invalid channel state: ${systemChannel}/${perProcessChannel}`);
  }
  return Object.freeze({
    timestamp: timestampNs,
    system,
    perProcess: Object.freeze({ ...perProcess }),
    health: Object.freeze({ systemChannel, perProcessChannel }),
  });
}

export function isValidTick(value) {
  return (
    value != null &&
    typeof value.timestamp === 'bigint' &&
    value.system != null &&
    typeof value.system.cpuPercent !== 'undefined' &&
    value.perProcess != null &&
    value.health != null &&
    CHANNEL_STATES.includes(value.health.systemChannel) &&
    CHANNEL_STATES.includes(value.health.perProcessChannel)
  );
}
