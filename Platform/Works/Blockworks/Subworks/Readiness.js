// ship
// designed and built by onyxpowered.

import { probeHealthCheck } from './Health.js';

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_INTERVAL_MS = 250;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollUntil(predicate, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    sleepFn = defaultSleep,
    now = Date.now,
  } = options;
  const deadline = now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleepFn(Math.min(intervalMs, remaining));
  }
}

export async function waitForDependencies(dependsOn, isBlockReady, options = {}) {
  if (dependsOn.length === 0) return true;
  const ready = await pollUntil(async () => {
    for (const name of dependsOn) {
      if (!(await isBlockReady(name))) return false;
    }
    return true;
  }, options);
  if (!ready) {
    throw new Error(
      `dependency wait timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms waiting on: ${dependsOn.join(', ')}`,
    );
  }
  return true;
}

export async function waitForHealthCheck(healthCheck, options = {}) {
  if (!healthCheck) return true;
  const timeoutMs = options.timeoutMs ?? healthCheck.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = healthCheck.intervalMs ?? options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const ready = await pollUntil(() => probeHealthCheck(healthCheck, options.probeOptions), {
    ...options,
    timeoutMs,
    intervalMs,
  });
  if (!ready) {
    throw new Error(`health check timed out after ${timeoutMs}ms: ${JSON.stringify(healthCheck)}`);
  }
  return true;
}
