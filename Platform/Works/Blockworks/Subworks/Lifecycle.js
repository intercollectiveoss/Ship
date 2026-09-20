// ship
// designed and built by onyxpowered.

export const STATES = Object.freeze(['starting', 'running', 'crashed', 'stopped', 'restarting']);

const TRANSITIONS = Object.freeze({
  starting: Object.freeze({
    ready: 'running',
    'spawn-failed': 'crashed',
    'readiness-timeout': 'crashed',
    stop: 'stopped',
  }),
  running: Object.freeze({
    'unexpected-exit': 'crashed',
    stop: 'stopped',
  }),
  crashed: Object.freeze({
    'schedule-restart': 'restarting',
    stop: 'stopped',
  }),
  restarting: Object.freeze({
    attempt: 'starting',
    stop: 'stopped',
  }),
  stopped: Object.freeze({
    start: 'starting',
  }),
});

export function nextLifecycleState(currentState, event) {
  const table = TRANSITIONS[currentState];
  if (!table) {
    throw new Error(`unknown lifecycle state: "${currentState}"`);
  }
  const nextState = table[event];
  if (!nextState) {
    throw new Error(`invalid lifecycle transition: cannot "${event}" from "${currentState}"`);
  }
  return nextState;
}

export function isDeliberateStopEvent(event) {
  return event === 'stop';
}

export function createBlockLifecycle(initialState = 'starting') {
  if (!STATES.includes(initialState)) {
    throw new Error(`unknown lifecycle state: "${initialState}"`);
  }
  let state = initialState;
  let throttled = false;

  function transition(event) {
    state = nextLifecycleState(state, event);
    if (state !== 'running') {
      throttled = false;
    }
    return state;
  }

  return Object.freeze({
    getState() {
      return state;
    },
    isThrottled() {
      return throttled;
    },
    setThrottled(value) {
      if (value && state !== 'running') {
        throw new Error(`cannot throttle a Block that is not running (currently "${state}")`);
      }
      throttled = Boolean(value);
    },
    transition,
  });
}
