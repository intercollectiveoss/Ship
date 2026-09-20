// ship
// designed and built by onyxpowered.

import { readFile as fsReadFile, open as fsOpen } from 'node:fs/promises';
import { parseStat, parseStatusRssBytes, parseMemInfo, parseChildrenList, isZombieState } from '../Linux/ProcParse.js';

const CONFIRMED_EXIT_CODES = new Set(['ENOENT', 'ESRCH']);

export function createLinuxSampler({ readFile = fsReadFile, open = fsOpen, parentPid = process.ppid } = {}) {
  const handleCache = new Map();

  function forgetHandle(cacheKey) {
    const handle = handleCache.get(cacheKey);
    if (handle) {
      handleCache.delete(cacheKey);
      handle.close().catch(() => {});
    }
  }

  async function readViaHandle(path, cacheKey) {
    let handle = handleCache.get(cacheKey);
    if (!handle) {
      handle = await open(path, 'r');
      handleCache.set(cacheKey, handle);
    }
    try {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.toString('utf8', 0, bytesRead);
    } catch (error) {
      forgetHandle(cacheKey);
      throw error;
    }
  }

  async function sampleMemory() {
    const content = await readFile('/proc/meminfo', 'utf8');
    const parsed = parseMemInfo(content);
    return { totalBytes: parsed.totalBytes, usedBytes: parsed.usedBytes, freeBytes: parsed.freeBytes, degraded: false };
  }

  async function sampleOnePid(pid) {
    let statContent;
    try {
      statContent = await readViaHandle(`/proc/${pid}/stat`, `${pid}:stat`);
    } catch (error) {
      if (error && CONFIRMED_EXIT_CODES.has(error.code)) {
        forgetHandle(`${pid}:status`);
        return { pid, sample: { cpuTimeMs: 0, rssBytes: null, alive: false, fingerprint: null } };
      }
      return { pid, sample: undefined };
    }

    const stat = parseStat(statContent);

    if (isZombieState(stat.state)) {
      return { pid, sample: { cpuTimeMs: stat.cpuTimeMs, rssBytes: 0, alive: false, fingerprint: stat.starttimeTicks } };
    }

    let rssBytes = null;
    try {
      const statusContent = await readViaHandle(`/proc/${pid}/status`, `${pid}:status`);
      rssBytes = parseStatusRssBytes(statusContent);
    } catch {
      rssBytes = null;
    }

    return { pid, sample: { cpuTimeMs: stat.cpuTimeMs, rssBytes, alive: true, fingerprint: stat.starttimeTicks } };
  }

  async function sampleProcessesChunk(pidChunk) {
    const result = new Map();
    const outcomes = await Promise.all(pidChunk.map((pid) => sampleOnePid(pid)));
    for (const { pid, sample } of outcomes) {
      if (sample !== undefined) result.set(pid, sample);
    }
    return result;
  }

  async function sampleProcessTree() {
    const cache = new Map();
    async function getChildren(pid) {
      if (cache.has(pid)) return cache.get(pid);
      try {
        const content = await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8');
        const children = parseChildrenList(content);
        cache.set(pid, children);
        return children;
      } catch {
        cache.set(pid, []);
        return [];
      }
    }
    return { getChildren, degraded: false };
  }

  async function probeCapability() {
    try {
      await readFile(`/proc/${parentPid}/stat`, 'utf8');
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error?.code ?? 'unknown' };
    }
  }

  return { sampleMemory, sampleProcessesChunk, sampleProcessTree, probeCapability };
}
