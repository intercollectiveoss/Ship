// ship
// designed and built by onyxpowered.

import { CHANNEL_STATES } from './Schema.js';
import { elapsedMsBetween } from './Clock.js';

export const DEFAULT_DEGRADE_AFTER_CONSECUTIVE_MISSES = 4;
export const DEFAULT_DOWN_AFTER_MS = 5000;
export const DEFAULT_CLEAR_AFTER_CONSECUTIVE_GOOD = 3;

const CHANNEL_SEVERITY = Object.freeze({ ok: 0, degraded: 1, down: 2 });

export function channelSeverity(state) {
  return CHANNEL_SEVERITY[state] ?? 0;
}

export function worseChannelState(a, b) {
  return channelSeverity(a) >= channelSeverity(b) ? a : b;
}

export function createChannelHealth({
  degradeAfterConsecutiveMisses = DEFAULT_DEGRADE_AFTER_CONSECUTIVE_MISSES,
  downAfterMs = DEFAULT_DOWN_AFTER_MS,
  clearAfterConsecutiveGood = DEFAULT_CLEAR_AFTER_CONSECUTIVE_GOOD,
} = {}) {
  let state = 'ok';
  let consecutiveMisses = 0;
  let consecutiveGood = 0;
  let firstMissAtNs = null;

  function recordSuccess() {
    const previousState = state;
    consecutiveMisses = 0;
    firstMissAtNs = null;

    if (state === 'down') {
      state = 'degraded';
      consecutiveGood = 1;
    } else if (state === 'degraded') {
      consecutiveGood += 1;
      if (consecutiveGood >= clearAfterConsecutiveGood) {
        state = 'ok';
        consecutiveGood = 0;
      }
    } else {
      consecutiveGood = 0;
    }

    return { state, justRecovered: previousState !== 'ok' && state === 'ok' };
  }

  function recordMiss(nowNs) {
    const previousState = state;
    consecutiveGood = 0;
    consecutiveMisses += 1;
    if (firstMissAtNs === null) {
      firstMissAtNs = nowNs;
    }

    if (state === 'ok' && consecutiveMisses >= degradeAfterConsecutiveMisses) {
      state = 'degraded';
    }

    if (typeof nowNs === 'bigint' && firstMissAtNs !== null) {
      const outageMs = elapsedMsBetween(firstMissAtNs, nowNs);
      if (outageMs !== null && outageMs >= downAfterMs) {
        state = 'down';
      }
    }

    return {
      state,
      justDegraded: previousState === 'ok' && state === 'degraded',
      justEscalatedToDown: previousState !== 'down' && state === 'down',
    };
  }

  function currentState() {
    return state;
  }

  function status() {
    return {
      state,
      consecutiveMisses,
      consecutiveGood,
      firstMissAtNs,
    };
  }

  if (!CHANNEL_STATES.includes(state)) {
    throw new Error(`invalid initial channel health state: ${state}`);
  }

  return { recordSuccess, recordMiss, currentState, status };
}
