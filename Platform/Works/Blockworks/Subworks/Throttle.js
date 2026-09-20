// ship
// designed and built by onyxpowered.

import os from 'node:os';

const THROTTLE_LADDER_POSIX = Object.freeze(['none', 'priority-lowered', 'duty-cycled']);
const THROTTLE_LADDER_WINDOWS = Object.freeze(['none', 'priority-lowered']);

const DEFAULT_LOWERED_PRIORITY = os.constants.priority.PRIORITY_LOW;
const DEFAULT_NORMAL_PRIORITY = os.constants.priority.PRIORITY_NORMAL;
const DEFAULT_DUTY_ON_MS = 200;
const DEFAULT_DUTY_OFF_MS = 800;

function ladderFor(platformName) {
  return platformName === 'win32' ? THROTTLE_LADDER_WINDOWS : THROTTLE_LADDER_POSIX;
}

export function nextThrottleLevel(currentLevel, platformName = process.platform) {
  const ladder = ladderFor(platformName);
  const index = ladder.indexOf(currentLevel);
  if (index === -1) {
    throw new Error(`unknown throttle level: "${currentLevel}"`);
  }
  return ladder[Math.min(index + 1, ladder.length - 1)];
}

export function prevThrottleLevel(currentLevel, platformName = process.platform) {
  const ladder = ladderFor(platformName);
  const index = ladder.indexOf(currentLevel);
  if (index === -1) {
    throw new Error(`unknown throttle level: "${currentLevel}"`);
  }
  return ladder[Math.max(index - 1, 0)];
}

export function isMaxThrottleLevel(level, platformName = process.platform) {
  const ladder = ladderFor(platformName);
  const index = ladder.indexOf(level);
  if (index === -1) {
    throw new Error(`unknown throttle level: "${level}"`);
  }
  return index === ladder.length - 1;
}

export function lowerPriority(pid, options = {}) {
  const { setPriorityFn = os.setPriority, priority = DEFAULT_LOWERED_PRIORITY } = options;
  setPriorityFn(pid, priority);
}

export function restorePriority(pid, options = {}) {
  const { setPriorityFn = os.setPriority, priority = DEFAULT_NORMAL_PRIORITY } = options;
  setPriorityFn(pid, priority);
}

export function createDutyCycle(pid, options = {}) {
  const {
    onMs = DEFAULT_DUTY_ON_MS,
    offMs = DEFAULT_DUTY_OFF_MS,
    signalFn = process.kill,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = options;

  let running = false;
  let timer = null;
  let phase = 'on';

  function scheduleNext() {
    if (!running) return;
    if (phase === 'on') {
      timer = setTimeoutFn(() => {
        signalFn(pid, 'SIGSTOP');
        phase = 'off';
        scheduleNext();
      }, onMs);
    } else {
      timer = setTimeoutFn(() => {
        signalFn(pid, 'SIGCONT');
        phase = 'on';
        scheduleNext();
      }, offMs);
    }
  }

  return Object.freeze({
    start() {
      if (running) return;
      running = true;
      phase = 'on';
      scheduleNext();
    },
    stop() {
      running = false;
      if (timer !== null) {
        clearTimeoutFn(timer);
        timer = null;
      }
      if (phase === 'off') {
        signalFn(pid, 'SIGCONT');
        phase = 'on';
      }
    },
    isRunning() {
      return running;
    },
    getPhase() {
      return phase;
    },
  });
}
