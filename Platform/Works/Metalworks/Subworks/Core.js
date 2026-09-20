// ship
// designed and built by onyxpowered.

import os from 'node:os';
import { createSystemSample, createProcessSample, createTick } from './Schema.js';
import { elapsedMsBetween } from './Clock.js';
import { computeSystemCpuPercent } from './SystemCpu.js';
import { createPidLedger, DEFAULT_STALE_AFTER_MS } from './PIDLedger.js';
import { createChannelHealth, worseChannelState } from './Health.js';
import { resolveDescendantsForRoots } from './Tree.js';
import { chunkList, DEFAULT_CHUNK_SIZE } from './Chunk.js';

export const DEFAULT_CADENCE_MS = 200;
export const DEADLINE_FRACTION_OF_CADENCE = 0.65;

const TIMED_OUT = Symbol('metalworks-chunk-timeout');

function withDeadline(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(TIMED_OUT), ms);
    }),
  ]);
}

function unknownProcessSample() {
  return createProcessSample(null, null, false, true, 0, true);
}

function aggregateTree(rootPid, treePids, individualSamples) {
  const rootSample = individualSamples.get(rootPid) ?? unknownProcessSample();

  let cpuSum = null;
  if (rootSample.cpuPercent !== null) {
    cpuSum = 0;
    for (const pid of treePids) {
      cpuSum += individualSamples.get(pid)?.cpuPercent ?? 0;
    }
  }

  let rssSum = null;
  if (rootSample.rssBytes !== null) {
    rssSum = 0;
    for (const pid of treePids) {
      rssSum += individualSamples.get(pid)?.rssBytes ?? 0;
    }
  }

  return createProcessSample(cpuSum, rssSum, rootSample.alive, rootSample.firstSample, rootSample.ageMs, rootSample.stale);
}

export function createMetalworksCore({
  sampler,
  cadenceMs = DEFAULT_CADENCE_MS,
  chunkSize = DEFAULT_CHUNK_SIZE,
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  platformName = process.platform,
  getCpuTimes = () => os.cpus(),
  getCoreCount = () => os.cpus().length,
  systemHealthOptions = {},
  processHealthOptions = {},
} = {}) {
  if (!sampler) {
    throw new Error('createMetalworksCore requires a sampler backend');
  }

  const ledger = createPidLedger({ staleAfterMs });
  const systemChannelHealth = createChannelHealth(systemHealthOptions);
  const processChannelHealth = createChannelHealth(processHealthOptions);

  let previousCpuTimes = null;
  let lastKnownMemory = null;
  let lastMemoryGoodAtNs = null;
  let perProcessRestrictedFloor = null;
  let systemJustEscalatedToDown = false;
  let processJustEscalatedToDown = false;
  const lastTreeByRoot = new Map();

  function consumeEscalations() {
    const escalations = { system: systemJustEscalatedToDown, process: processJustEscalatedToDown };
    systemJustEscalatedToDown = false;
    processJustEscalatedToDown = false;
    return escalations;
  }

  function markPerProcessChannelRestricted() {
    perProcessRestrictedFloor = 'degraded';
  }

  function untrackRoot(rootPid) {
    const previousTree = lastTreeByRoot.get(rootPid);
    if (previousTree) {
      for (const pid of previousTree.pids) {
        ledger.forget(pid);
      }
    }
    ledger.forget(rootPid);
    lastTreeByRoot.delete(rootPid);
  }

  async function sampleSystem(nowNs) {
    const coreCount = getCoreCount();
    const currentCpuTimes = getCpuTimes();
    const systemCpuPercent = previousCpuTimes
      ? computeSystemCpuPercent(previousCpuTimes, currentCpuTimes, platformName)
      : null;
    previousCpuTimes = currentCpuTimes;

    let memoryResult = null;
    try {
      memoryResult = await sampler.sampleMemory();
    } catch {
      memoryResult = null;
    }

    let memoryAgeMs = 0;
    if (memoryResult !== null) {
      lastKnownMemory = {
        totalBytes: memoryResult.totalBytes,
        usedBytes: memoryResult.usedBytes,
        freeBytes: memoryResult.freeBytes,
      };
      lastMemoryGoodAtNs = nowNs;
    } else if (lastKnownMemory !== null) {
      memoryAgeMs = elapsedMsBetween(lastMemoryGoodAtNs, nowNs) ?? 0;
    } else {
      lastKnownMemory = { totalBytes: 0, usedBytes: 0, freeBytes: 0 };
    }

    const systemAcquisitionOk = memoryResult !== null && memoryResult.degraded !== true;
    const healthResult = systemAcquisitionOk ? systemChannelHealth.recordSuccess() : systemChannelHealth.recordMiss(nowNs);
    if (healthResult.justEscalatedToDown) {
      systemJustEscalatedToDown = true;
    }

    const systemSample = createSystemSample(
      systemCpuPercent,
      lastKnownMemory.totalBytes,
      lastKnownMemory.usedBytes,
      lastKnownMemory.freeBytes,
      memoryAgeMs,
    );

    return { systemSample, systemChannel: healthResult.state, coreCount };
  }

  async function sampleProcesses(trackedRootPids, nowNs, coreCount) {
    if (trackedRootPids.length === 0) {
      const healthResult = processChannelHealth.recordSuccess();
      return { perProcess: {}, processChannel: worseChannelState(healthResult.state, perProcessRestrictedFloor ?? 'ok') };
    }

    let treeResult = null;
    try {
      treeResult = await sampler.sampleProcessTree();
    } catch {
      treeResult = null;
    }
    const treeOk = treeResult !== null && treeResult.degraded !== true;
    const getChildren = treeResult?.getChildren ?? (() => []);

    const treesByRoot = await resolveDescendantsForRoots(trackedRootPids, getChildren);
    for (const [rootPid, tree] of treesByRoot) {
      lastTreeByRoot.set(rootPid, tree);
    }

    const allPids = new Set();
    for (const tree of treesByRoot.values()) {
      for (const pid of tree.pids) allPids.add(pid);
    }

    const deadlineMs = Math.max(1, cadenceMs * DEADLINE_FRACTION_OF_CADENCE);
    const chunks = chunkList([...allPids], chunkSize);
    const chunkOutcomes = await Promise.allSettled(
      chunks.map((chunk) => withDeadline(sampler.sampleProcessesChunk(chunk, deadlineMs), deadlineMs)),
    );

    const rawByPid = new Map();
    let anyChunkSucceeded = chunks.length === 0;
    for (const outcome of chunkOutcomes) {
      if (outcome.status === 'fulfilled' && outcome.value !== TIMED_OUT && outcome.value != null) {
        anyChunkSucceeded = true;
        for (const [pid, rawSample] of outcome.value) {
          rawByPid.set(pid, rawSample);
        }
      }
    }

    const individualSamples = new Map();
    for (const pid of allPids) {
      const raw = rawByPid.get(pid);
      individualSamples.set(pid, raw !== undefined ? ledger.recordSample(pid, raw, nowNs, coreCount) : ledger.recordMiss(pid, nowNs));
    }

    const perProcessAcquisitionOk = anyChunkSucceeded && treeOk;
    const healthResult = perProcessAcquisitionOk ? processChannelHealth.recordSuccess() : processChannelHealth.recordMiss(nowNs);
    if (healthResult.justEscalatedToDown) {
      processJustEscalatedToDown = true;
    }

    const perProcess = {};
    for (const rootPid of trackedRootPids) {
      const tree = treesByRoot.get(rootPid);
      perProcess[rootPid] = aggregateTree(rootPid, tree ? tree.pids : new Set([rootPid]), individualSamples);
    }

    return { perProcess, processChannel: worseChannelState(healthResult.state, perProcessRestrictedFloor ?? 'ok') };
  }

  async function produceTick(trackedRootPids, nowNs) {
    const { systemSample, systemChannel, coreCount } = await sampleSystem(nowNs);
    const { perProcess, processChannel } = await sampleProcesses(trackedRootPids, nowNs, coreCount);
    return createTick(nowNs, systemSample, perProcess, systemChannel, processChannel);
  }

  function getSystemHealthStatus() {
    return systemChannelHealth.status();
  }

  function getProcessHealthStatus() {
    return processChannelHealth.status();
  }

  return {
    produceTick,
    markPerProcessChannelRestricted,
    untrackRoot,
    getSystemHealthStatus,
    getProcessHealthStatus,
    consumeEscalations,
  };
}
