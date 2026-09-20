// ship
// designed and built by onyxpowered.

import os from 'node:os';
import { createPowerShellHost } from '../Windows/PowerShellHost.js';
import { buildProcessSampleScript, buildTreeSnapshotScript, parseProcessSampleOutput, parseTreeSnapshotOutput } from '../Windows/CommandTemplates.js';
import { buildChildrenLookup } from '../Tree.js';

export const DEFAULT_TREE_TIMEOUT_MS = 5000;

export function createWindowsSampler({
  host = createPowerShellHost(),
  totalMem = () => os.totalmem(),
  freeMem = () => os.freemem(),
  treeTimeoutMs = DEFAULT_TREE_TIMEOUT_MS,
} = {}) {
  async function sampleMemory() {
    const totalBytes = totalMem();
    const freeBytes = freeMem();
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return { totalBytes, usedBytes, freeBytes, degraded: false };
  }

  async function sampleProcessesChunk(pidChunk, deadlineMs) {
    if (pidChunk.length === 0) return new Map();
    const script = buildProcessSampleScript(pidChunk);
    const rawOutput = await host.send(script, deadlineMs);
    return parseProcessSampleOutput(rawOutput, pidChunk);
  }

  async function sampleProcessTree() {
    try {
      const rawOutput = await host.send(buildTreeSnapshotScript(), treeTimeoutMs);
      const parentPidByPid = parseTreeSnapshotOutput(rawOutput);
      return { getChildren: buildChildrenLookup(parentPidByPid), degraded: false };
    } catch {
      return { getChildren: () => [], degraded: true };
    }
  }

  return {
    sampleMemory,
    sampleProcessesChunk,
    sampleProcessTree,
    probeCapability: host.probeCapability,
    getHostState: host.getHostState,
    stop: host.stop,
  };
}
