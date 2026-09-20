// ship
// designed and built by onyxpowered.

const DEFAULT_BASE_MS = 1000;
const DEFAULT_FACTOR = 2;
const DEFAULT_MAX_MS = 60000;
const DEFAULT_STABLE_RESET_MS = 60000;

export function computeBackoffDelay(attempt, options = {}) {
  const { baseMs = DEFAULT_BASE_MS, factor = DEFAULT_FACTOR, maxMs = DEFAULT_MAX_MS } = options;
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('attempt must be a positive integer (1 = first restart)');
  }
  const delay = baseMs * factor ** (attempt - 1);
  return Math.min(delay, maxMs);
}

export function createRestartPolicy(options = {}) {
  const {
    baseMs = DEFAULT_BASE_MS,
    factor = DEFAULT_FACTOR,
    maxMs = DEFAULT_MAX_MS,
    stableResetMs = DEFAULT_STABLE_RESET_MS,
    now = () => Date.now(),
  } = options;

  let attempt = 0;
  let runningSinceMs = null;

  return Object.freeze({
    recordRunning() {
      runningSinceMs = now();
    },

    recordCrash() {
      if (runningSinceMs !== null && now() - runningSinceMs >= stableResetMs) {
        attempt = 0;
      }
      runningSinceMs = null;
      attempt += 1;
      return computeBackoffDelay(attempt, { baseMs, factor, maxMs });
    },

    recordDeliberateStop() {
      attempt = 0;
      runningSinceMs = null;
    },

    getAttemptCount() {
      return attempt;
    },
  });
}
