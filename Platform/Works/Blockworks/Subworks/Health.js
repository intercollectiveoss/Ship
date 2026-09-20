// ship
// designed and built by onyxpowered.

import { connect } from 'node:net';

const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_HEALTHY_STATUS_CEILING = 499;

export function probePort(port, options = {}) {
  const { host = '127.0.0.1', timeoutMs = DEFAULT_TIMEOUT_MS, connectFn = connect } = options;
  return new Promise((resolve) => {
    const socket = connectFn(port, host);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function probeUrl(url, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
    healthyStatusCeiling = DEFAULT_HEALTHY_STATUS_CEILING,
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    return response.status <= healthyStatusCeiling;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeHealthCheck(healthCheck, options = {}) {
  if (!healthCheck) return true;
  if (healthCheck.port !== undefined) {
    return probePort(healthCheck.port, { timeoutMs: healthCheck.timeoutMs, ...options });
  }
  if (healthCheck.url !== undefined) {
    return probeUrl(healthCheck.url, { timeoutMs: healthCheck.timeoutMs, ...options });
  }
  return true;
}
