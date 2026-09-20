// ship
// designed and built by onyxpowered.

import { parentPort, workerData } from 'node:worker_threads';
import { createMetalworksCore, DEFAULT_CADENCE_MS } from '../Core.js';

async function loadSampler(config) {
  if (config.testSamplerModuleUrl) {
    const mod = await import(config.testSamplerModuleUrl);
    return mod.createTestSampler(config.samplerOptions ?? {});
  }
  const mod = await import('../Samplers/Sampler.js');
  return mod.selectSampler(config.platformName, config.samplerOptions ?? {});
}

async function probeStartupCapability(sampler, core, post) {
  if (typeof sampler.probeCapability !== 'function') return;
  try {
    const result = await sampler.probeCapability();
    if (!result.ok) {
      core.markPerProcessChannelRestricted();
    }
    post({ type: 'capability-probe', result });
  } catch (error) {
    core.markPerProcessChannelRestricted();
    post({ type: 'capability-probe', result: { ok: false, error: error?.message ?? String(error) } });
  }
}

export async function runPollWorker(config, port) {
  const post = (message) => port.postMessage(message);
  const cadenceMs = config.cadenceMs ?? DEFAULT_CADENCE_MS;
  const sampler = await loadSampler(config);

  const core = createMetalworksCore({
    sampler,
    cadenceMs,
    chunkSize: config.chunkSize,
    staleAfterMs: config.staleAfterMs,
    platformName: config.platformName,
    systemHealthOptions: config.systemHealthOptions,
    processHealthOptions: config.processHealthOptions,
  });

  await probeStartupCapability(sampler, core, post);

  const trackedRootPids = new Set(config.initialTrackedRootPids ?? []);
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    try {
      const nowNs = process.hrtime.bigint();
      const tickResult = await core.produceTick([...trackedRootPids], nowNs);
      post({ type: 'tick', tick: tickResult });
      const escalations = core.consumeEscalations();
      if (escalations.system || escalations.process) {
        post({ type: 'critical', escalations, health: tickResult.health });
      }
    } catch (error) {
      post({ type: 'error', message: error?.message ?? String(error) });
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, cadenceMs);
      }
    }
  }

  port.on('message', (message) => {
    if (message.type === 'track') {
      trackedRootPids.add(message.rootPid);
    } else if (message.type === 'untrack') {
      trackedRootPids.delete(message.rootPid);
      core.untrackRoot(message.rootPid);
    } else if (message.type === 'markPerProcessChannelRestricted') {
      core.markPerProcessChannelRestricted();
    } else if (message.type === 'stop') {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof sampler.stop === 'function') sampler.stop();
      post({ type: 'stopped' });
    }
  });

  post({ type: 'ready' });
  timer = setTimeout(tick, 0);

  return { core, sampler };
}

if (parentPort) {
  runPollWorker(workerData ?? {}, parentPort).catch((error) => {
    parentPort.postMessage({ type: 'fatal', message: error?.message ?? String(error) });
  });
}
