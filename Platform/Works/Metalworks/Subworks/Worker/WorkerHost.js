// ship
// designed and built by onyxpowered.

import { Worker } from 'node:worker_threads';

const DEFAULT_WORKER_URL = new URL('./PollWorker.js', import.meta.url);
const DEFAULT_STOP_TIMEOUT_MS = 2000;

export function createWorkerHost({
  workerUrl = DEFAULT_WORKER_URL,
  platformName = process.platform,
  cadenceMs,
  chunkSize,
  staleAfterMs,
  systemHealthOptions,
  processHealthOptions,
  samplerOptions,
  testSamplerModuleUrl,
  initialTrackedRootPids,
  createWorker = (url, options) => new Worker(url, options),
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
} = {}) {
  const tickListeners = new Set();
  const errorListeners = new Set();
  const capabilityListeners = new Set();
  const criticalListeners = new Set();
  let ready = false;
  const readyWaiters = [];

  const worker = createWorker(workerUrl, {
    workerData: {
      platformName,
      cadenceMs,
      chunkSize,
      staleAfterMs,
      systemHealthOptions,
      processHealthOptions,
      samplerOptions,
      testSamplerModuleUrl: testSamplerModuleUrl ? String(testSamplerModuleUrl) : undefined,
      initialTrackedRootPids,
    },
  });

  worker.on('message', (message) => {
    if (message.type === 'tick') {
      for (const listener of tickListeners) listener(message.tick);
    } else if (message.type === 'error' || message.type === 'fatal') {
      for (const listener of errorListeners) listener(new Error(message.message));
    } else if (message.type === 'capability-probe') {
      for (const listener of capabilityListeners) listener(message.result);
    } else if (message.type === 'critical') {
      for (const listener of criticalListeners) listener({ escalations: message.escalations, health: message.health });
    } else if (message.type === 'ready') {
      ready = true;
      for (const resolve of readyWaiters.splice(0)) resolve();
    }
  });

  worker.on('error', (error) => {
    for (const listener of errorListeners) listener(error);
  });

  function onTick(listener) {
    tickListeners.add(listener);
    return () => tickListeners.delete(listener);
  }

  function onError(listener) {
    errorListeners.add(listener);
    return () => errorListeners.delete(listener);
  }

  function onCapabilityProbe(listener) {
    capabilityListeners.add(listener);
    return () => capabilityListeners.delete(listener);
  }

  function onCritical(listener) {
    criticalListeners.add(listener);
    return () => criticalListeners.delete(listener);
  }

  function whenReady() {
    if (ready) return Promise.resolve();
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  function track(rootPid) {
    worker.postMessage({ type: 'track', rootPid });
  }

  function untrack(rootPid) {
    worker.postMessage({ type: 'untrack', rootPid });
  }

  function markPerProcessChannelRestricted() {
    worker.postMessage({ type: 'markPerProcessChannelRestricted' });
  }

  function stop() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        worker.terminate().then(
          () => resolve(),
          () => resolve(),
        );
      };
      worker.on('message', (message) => {
        if (message.type === 'stopped') finish();
      });
      worker.postMessage({ type: 'stop' });
      setTimeout(finish, stopTimeoutMs);
    });
  }

  return { onTick, onError, onCapabilityProbe, onCritical, whenReady, track, untrack, markPerProcessChannelRestricted, stop, worker };
}
