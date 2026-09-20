// ship
// designed and built by onyxpowered.

import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parsePsLine, parseCpuTimeToMs, isZombieStat, parsePidPpidLine, parseVmStat } from '../Mac/PsParse.js';
import { buildChildrenLookup } from '../Tree.js';

const execFileAsync = promisify(execFile);

export function createMacSampler({
  execFileImpl = execFileAsync,
  totalMem = () => os.totalmem(),
  freeMem = () => os.freemem(),
} = {}) {
  async function sampleMemory() {
    const totalBytes = totalMem();
    const baselineFreeBytes = freeMem();

    try {
      const [vmStatResult] = await Promise.all([
        execFileImpl('vm_stat', []),
        execFileImpl('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']),
      ]);
      const vmStat = parseVmStat(vmStatResult.stdout);
      const availableBytes = (vmStat.freePages + vmStat.speculativePages + vmStat.purgeablePages) * vmStat.pageSize;
      const usedBytes = Math.max(0, totalBytes - availableBytes);
      return { totalBytes, usedBytes, freeBytes: availableBytes, degraded: false };
    } catch {
      const baselineUsedBytes = Math.max(0, totalBytes - baselineFreeBytes);
      return { totalBytes, usedBytes: baselineUsedBytes, freeBytes: baselineFreeBytes, degraded: true };
    }
  }

  async function sampleProcessesChunk(pidChunk, deadlineMs) {
    if (pidChunk.length === 0) return new Map();

    const pidList = pidChunk.join(',');
    const { stdout } = await execFileImpl(
      'ps',
      ['-p', pidList, '-o', 'pid=,stat=,rss=,time=,lstart='],
      deadlineMs ? { timeout: Math.floor(deadlineMs) } : undefined,
    );

    const result = new Map();
    for (const line of stdout.split('\n')) {
      const parsed = parsePsLine(line);
      if (!parsed) continue;
      const alive = !isZombieStat(parsed.stat);
      result.set(parsed.pid, {
        cpuTimeMs: parseCpuTimeToMs(parsed.time),
        rssBytes: alive ? parsed.rssKb * 1024 : 0,
        alive,
        fingerprint: parsed.lstart,
      });
    }

    for (const pid of pidChunk) {
      if (!result.has(pid)) {
        result.set(pid, { cpuTimeMs: 0, rssBytes: null, alive: false, fingerprint: null });
      }
    }

    return result;
  }

  async function sampleProcessTree() {
    try {
      const { stdout } = await execFileImpl('ps', ['-A', '-o', 'pid=,ppid=']);
      const parentPidByPid = new Map();
      for (const line of stdout.split('\n')) {
        const parsed = parsePidPpidLine(line);
        if (parsed) parentPidByPid.set(parsed.pid, parsed.ppid);
      }
      return { getChildren: buildChildrenLookup(parentPidByPid), degraded: false };
    } catch {
      return { getChildren: () => [], degraded: true };
    }
  }

  return { sampleMemory, sampleProcessesChunk, sampleProcessTree };
}
