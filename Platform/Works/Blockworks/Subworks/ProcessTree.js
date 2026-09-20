// ship
// designed and built by onyxpowered.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_GRACE_PERIOD_MS = 5000;
const POLL_INTERVAL_MS = 100;

export function spawnBlockProcess(command, options = {}) {
  const { cwd, env, spawnFn = spawn, platformName = process.platform } = options;
  const isWindows = platformName === 'win32';
  return spawnFn(command, {
    cwd,
    env: env ?? process.env,
    shell: true,
    detached: !isWindows,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function isProcessAlive(pid, options = {}) {
  const { killFn = process.kill } = options;
  try {
    killFn(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

export async function killBlockTree(pid, options = {}) {
  const {
    signal = 'SIGTERM',
    platformName = process.platform,
    killFn = process.kill,
    execFn = execFileAsync,
  } = options;

  if (platformName === 'win32') {
    try {
      await execFn('taskkill', ['/PID', String(pid), '/T', '/F']);
    } catch (error) {
      if (!/not found|no running instance/i.test(error.message ?? '')) {
        throw error;
      }
    }
    return;
  }

  try {
    killFn(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function terminateBlockTree(pid, options = {}) {
  const {
    gracePeriodMs = DEFAULT_GRACE_PERIOD_MS,
    signal = 'SIGTERM',
    killSignal = 'SIGKILL',
    platformName = process.platform,
    killFn = process.kill,
    execFn = execFileAsync,
    sleepFn = defaultSleep,
  } = options;

  await killBlockTree(pid, { signal, platformName, killFn, execFn });

  if (platformName === 'win32') {
    return { escalated: false };
  }

  const deadline = Date.now() + gracePeriodMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid, { killFn })) {
      return { escalated: false };
    }
    await sleepFn(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }

  if (isProcessAlive(pid, { killFn })) {
    await killBlockTree(pid, { signal: killSignal, platformName, killFn, execFn });
    return { escalated: true };
  }
  return { escalated: false };
}
