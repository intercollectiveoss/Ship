// ship
// designed and built by onyxpowered.

import { spawn as childProcessSpawn } from 'node:child_process';
import { UTF8_INIT_SCRIPT, PROBE_SCRIPT, looksLikePolicyBlock } from './CommandTemplates.js';

export const DEFAULT_COMMAND_TIMEOUT_MS = 5000;
export const DEFAULT_PREVENTIVE_RESPAWN_MS = 36 * 60 * 60 * 1000;

function markerFor(id) {
  return `###SHIP-METALWORKS-${id}###`;
}

export function createPowerShellHost({
  spawn = childProcessSpawn,
  powershellPath = 'powershell.exe',
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  preventiveRespawnMs = DEFAULT_PREVENTIVE_RESPAWN_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let child = null;
  let buffer = '';
  let inFlight = null;
  let queue = [];
  let nextId = 1;
  let hostState = 'unstarted';
  let intentionalTeardown = false;
  let preventiveTimer = null;
  let preventiveRespawnPending = false;
  let stopped = false;

  function rejectAll(reason) {
    if (inFlight) {
      clearTimeoutFn(inFlight.timeoutHandle);
      inFlight.reject(new Error(reason));
      inFlight = null;
    }
    const stale = queue;
    queue = [];
    for (const cmd of stale) {
      cmd.reject(new Error(reason));
    }
  }

  function teardownChild() {
    if (!child) return;
    intentionalTeardown = true;
    try {
      child.kill();
    } catch {
    }
    child = null;
  }

  function pump() {
    if (inFlight || queue.length === 0 || !child) return;
    const cmd = queue.shift();
    inFlight = cmd;
    const marker = markerFor(cmd.id);
    try {
      child.stdin.write(`${cmd.script}\n`);
      child.stdin.write(`Write-Output '${marker}'\n`);
    } catch (error) {
      inFlight = null;
      cmd.reject(error);
      return;
    }
    cmd.timeoutHandle = setTimeoutFn(() => handleTimeout(cmd), cmd.timeoutMs ?? commandTimeoutMs);
  }

  function afterSlotFreed() {
    if (preventiveRespawnPending && !inFlight) {
      preventiveRespawnPending = false;
      respawn('preventive');
      return;
    }
    pump();
  }

  function drainBuffer() {
    while (inFlight) {
      const marker = markerFor(inFlight.id);
      const markerIndex = buffer.indexOf(marker);
      if (markerIndex === -1) break;
      const output = buffer.slice(0, markerIndex);
      buffer = buffer.slice(markerIndex + marker.length);
      const cmd = inFlight;
      inFlight = null;
      clearTimeoutFn(cmd.timeoutHandle);
      cmd.resolve(output.trim());
      afterSlotFreed();
    }
  }

  function handleTimeout(cmd) {
    if (inFlight !== cmd) return;
    inFlight = null;
    cmd.reject(new Error('powershell command timed out'));
    respawn('timeout');
  }

  function handleExit() {
    if (intentionalTeardown) {
      intentionalTeardown = false;
      return;
    }
    respawn('crashed');
  }

  function respawn(reason) {
    teardownChild();
    buffer = '';
    rejectAll(`powershell host respawning (${reason})`);
    if (hostState !== 'blocked-by-policy') {
      hostState = 'unstarted';
    }
    if (preventiveTimer) {
      clearTimeoutFn(preventiveTimer);
    }
    spawnChild();
    schedulePreventiveRespawn();
  }

  function spawnChild() {
    child = spawn(powershellPath, ['-NoProfile', '-NoLogo', '-InputFormat', 'Text', '-NoExit', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      drainBuffer();
    });
    child.stderr.on('data', () => {});
    child.on('error', () => {
      handleExit();
    });
    child.on('exit', () => {
      handleExit();
    });
    queue.unshift({ id: nextId++, script: UTF8_INIT_SCRIPT, resolve: () => {}, reject: () => {}, timeoutMs: commandTimeoutMs });
    pump();
  }

  function ensureStarted() {
    if (!child) {
      spawnChild();
    }
  }

  function send(script, timeoutMs) {
    if (stopped) {
      return Promise.reject(new Error('powershell host has been stopped'));
    }
    if (hostState === 'blocked-by-policy') {
      return Promise.reject(new Error('powershell host is blocked-by-policy'));
    }
    ensureStarted();
    return new Promise((resolve, reject) => {
      queue.push({ id: nextId++, script, resolve, reject, timeoutMs });
      pump();
    });
  }

  async function probeCapability() {
    try {
      const result = await send(PROBE_SCRIPT, commandTimeoutMs);
      if (looksLikePolicyBlock(result)) {
        hostState = 'blocked-by-policy';
        return { ok: false, blocked: true };
      }
      if (result.includes('ship-metalworks-probe-ok')) {
        hostState = 'ready';
        return { ok: true };
      }
      hostState = 'blocked-by-policy';
      return { ok: false, blocked: true, unexpectedOutput: result };
    } catch (error) {
      const message = error?.message ?? '';
      if (looksLikePolicyBlock(message)) {
        hostState = 'blocked-by-policy';
        return { ok: false, blocked: true };
      }
      hostState = 'down';
      return { ok: false, blocked: false, error: message };
    }
  }

  function schedulePreventiveRespawn() {
    preventiveTimer = setTimeoutFn(() => {
      if (inFlight) {
        preventiveRespawnPending = true;
        schedulePreventiveRespawn();
      } else {
        respawn('preventive');
      }
    }, preventiveRespawnMs);
  }

  function getHostState() {
    return hostState;
  }

  function stop() {
    stopped = true;
    hostState = 'down';
    if (preventiveTimer) clearTimeoutFn(preventiveTimer);
    rejectAll('powershell host stopped');
    teardownChild();
  }

  schedulePreventiveRespawn();

  return { send, probeCapability, getHostState, stop };
}
