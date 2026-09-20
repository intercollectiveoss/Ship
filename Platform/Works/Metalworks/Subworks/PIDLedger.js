// ship
// designed and built by onyxpowered.

import { createProcessSample } from './Schema.js';
import { elapsedMsBetween } from './Clock.js';
import { computeProcessCpuPercent } from './ProcessCpu.js';
import { fingerprintsMatch, normalizeFingerprint } from './Fingerprint.js';

export const DEFAULT_STALE_AFTER_MS = 1500;

function emptyEntry(nowNs) {
  return {
    fingerprint: null,
    firstSampleAtNs: null,
    sampleCount: 0,
    lastCpuTimeMs: null,
    lastSampleAtNs: null,
    lastGoodAtNs: null,
    lastRssBytes: null,
    lastCpuPercent: null,
    alive: false,
    terminal: false,
    discoveredAtNs: nowNs,
  };
}

function unknownSample() {
  return createProcessSample(null, null, false, true, 0, true);
}

function terminalSample(entry) {
  return createProcessSample(null, entry.lastRssBytes ?? null, false, false, 0, false);
}

export function createPidLedger({ staleAfterMs = DEFAULT_STALE_AFTER_MS, coreCount = 1 } = {}) {
  const entries = new Map();

  function ensureEntry(pid, nowNs) {
    if (!entries.has(pid)) {
      entries.set(pid, emptyEntry(nowNs));
    }
    return entries.get(pid);
  }

  function recordMiss(pid, nowNs) {
    const entry = ensureEntry(pid, nowNs);

    if (entry.terminal) {
      return terminalSample(entry);
    }

    if (entry.sampleCount === 0) {
      return unknownSample();
    }

    const ageMs = elapsedMsBetween(entry.lastGoodAtNs, nowNs) ?? 0;
    const stale = ageMs > staleAfterMs;
    return createProcessSample(entry.lastCpuPercent, entry.lastRssBytes, entry.alive, false, ageMs, stale);
  }

  function markTerminal(pid, entry, lastRssBytes) {
    entry.terminal = true;
    entry.alive = false;
    entry.lastCpuPercent = null;
    entry.lastRssBytes = lastRssBytes ?? null;
    entry.lastCpuTimeMs = null;
    entry.lastSampleAtNs = null;
    return terminalSample(entry);
  }

  function recordSample(pid, rawSample, nowNs, effectiveCoreCount = coreCount) {
    const entry = ensureEntry(pid, nowNs);

    if (entry.terminal) {
      return terminalSample(entry);
    }

    const normalizedFingerprint = normalizeFingerprint(rawSample.fingerprint);

    if (entry.sampleCount > 0 && !fingerprintsMatch(entry.fingerprint, normalizedFingerprint)) {
      return markTerminal(pid, entry, entry.lastRssBytes);
    }

    if (rawSample.alive === false) {
      entry.fingerprint = normalizedFingerprint;
      return markTerminal(pid, entry, rawSample.rssBytes);
    }

    if (entry.sampleCount === 0) {
      entry.fingerprint = normalizedFingerprint;
      entry.firstSampleAtNs = nowNs;
      entry.sampleCount = 1;
      entry.lastCpuTimeMs = rawSample.cpuTimeMs;
      entry.lastSampleAtNs = nowNs;
      entry.lastGoodAtNs = nowNs;
      entry.lastRssBytes = rawSample.rssBytes;
      entry.lastCpuPercent = null;
      entry.alive = true;
      return createProcessSample(null, rawSample.rssBytes, true, true, 0, false);
    }

    const elapsedMs = elapsedMsBetween(entry.lastSampleAtNs, nowNs);
    const cpuPercent = computeProcessCpuPercent({
      previousCpuTimeMs: entry.lastCpuTimeMs,
      currentCpuTimeMs: rawSample.cpuTimeMs,
      elapsedMs,
      coreCount: effectiveCoreCount,
    });

    entry.fingerprint = normalizedFingerprint;
    entry.sampleCount += 1;
    entry.lastCpuTimeMs = rawSample.cpuTimeMs;
    entry.lastSampleAtNs = nowNs;
    entry.lastGoodAtNs = nowNs;
    entry.lastRssBytes = rawSample.rssBytes;
    entry.lastCpuPercent = cpuPercent;
    entry.alive = true;

    return createProcessSample(cpuPercent, rawSample.rssBytes, true, false, 0, false);
  }

  function forget(pid) {
    entries.delete(pid);
  }

  function has(pid) {
    return entries.has(pid);
  }

  function size() {
    return entries.size;
  }

  function isTerminal(pid) {
    return entries.get(pid)?.terminal === true;
  }

  return { recordSample, recordMiss, forget, has, size, isTerminal };
}
