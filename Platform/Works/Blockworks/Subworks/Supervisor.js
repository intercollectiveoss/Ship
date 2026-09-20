// ship
// designed and built by onyxpowered.

import { isValidTick } from '../../Metalworks/Subworks/Schema.js';
import { flattenStartOrder } from './Dependencies.js';
import { createBlockLifecycle } from './Lifecycle.js';
import { createRestartPolicy } from './Restart.js';
import { spawnBlockProcess, terminateBlockTree } from './ProcessTree.js';
import { attachBlockLogCapture } from './BlockLogs.js';
import { waitForDependencies, waitForHealthCheck } from './Readiness.js';
import { evaluatePerBlockBreach, evaluateUniversalBreach, DEFAULT_UNIVERSAL_CEILING } from './Thresholds.js';
import { selectThrottleTarget } from './Priority.js';
import {
  nextThrottleLevel,
  prevThrottleLevel,
  isMaxThrottleLevel,
  lowerPriority,
  restorePriority,
  createDutyCycle,
} from './Throttle.js';

const DEFAULT_TICK_INTERVAL_MS = 500;
const DEFAULT_HYSTERESIS_TICKS = 3;

function recordKey(appName, blockName) {
  return `${appName}:${blockName}`;
}

function noopLogger() {
  return { info() {}, warn() {}, error() {} };
}

// Wraps a Lifecycle's transition() so every state change is observable from
// outside -- Lifecycle.js itself stays a pure state machine with no logging
// concerns; this is the single place (Block record creation) that all
// transitions for a given Block pass through, so it's the cheapest point to
// add visibility without touching every one of Supervisor's own call sites.
function withTransitionLogging(lifecycle, { appName, blockName, logger }) {
  return Object.freeze({
    ...lifecycle,
    transition(event) {
      const from = lifecycle.getState();
      const to = lifecycle.transition(event);
      logger.info('Block lifecycle transition', { appName, blockName, event, from, to });
      return to;
    },
  });
}

export function createSupervisor(options = {}) {
  const {
    telemetrySource,
    stateStore,
    universalCeiling = DEFAULT_UNIVERSAL_CEILING,
    tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
    hysteresisTicks = DEFAULT_HYSTERESIS_TICKS,
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    sleepFn = (ms) => new Promise((resolve) => setTimeoutFn(resolve, ms)),
    spawnFn,
    killFn,
    execFn,
    setPriorityFn,
    signalFn,
    probeOptions,
    gracePeriodMs,
    platformName = process.platform,
    restartPolicyFactory = () => createRestartPolicy(),
    logger = noopLogger(),
    shipHome,
  } = options;

  if (!telemetrySource || typeof telemetrySource.getTick !== 'function') {
    throw new Error('createSupervisor requires a telemetrySource with a getTick() method');
  }
  if (!stateStore) {
    throw new Error('createSupervisor requires a stateStore');
  }

  const registry = new Map();

  async function persistRecord(record, extra = {}) {
    await stateStore.writeBlockState(record.appName, record.blockName, {
      state: record.lifecycle.getState(),
      throttled: record.lifecycle.isThrottled(),
      throttleLevel: record.throttleLevel,
      pid: record.pid,
      updatedAt: now(),
      ...extra,
    });
  }

  function isBlockReadyPredicate(appName) {
    return (depName) => {
      const dep = registry.get(recordKey(appName, depName));
      return Boolean(dep && dep.ready && dep.lifecycle.getState() === 'running');
    };
  }

  async function scheduleRestart(record) {
    if (record.deliberateStop) return;
    const delay = record.restartPolicy.recordCrash();
    record.lifecycle.transition('schedule-restart');
    await persistRecord(record);
    record.pendingRestartTimer = setTimeoutFn(async () => {
      record.pendingRestartTimer = null;
      if (record.deliberateStop) return;
      try {
        record.lifecycle.transition('attempt');
        await persistRecord(record);
        await startBlock(record);
      } catch (error) {
        logger.error('Blockworks: restart attempt failed unexpectedly', {
          appName: record.appName,
          blockName: record.blockName,
          error: error.message,
        });
      }
    }, delay);
  }

  async function failStart(record, event) {
    if (record.deliberateStop) return;
    record.lifecycle.transition(event);
    await scheduleRestart(record);
  }

  async function handleExit(record, code, signal, generation) {
    // A stale exit -- this child belonged to an attempt a newer startBlock()
    // call has already superseded (the restart timer fired and began a new
    // attempt before this exit event arrived). Its outcome no longer applies:
    // touching record.child/pid or the lifecycle here would either clobber
    // the CURRENT attempt's state or throw on a transition the lifecycle no
    // longer accepts from wherever the current attempt has since moved to.
    if (record.generation !== generation) return;

    record.child = null;
    record.pid = null;
    record.ready = false;
    if (record.dutyCycle) {
      record.dutyCycle.stop();
      record.dutyCycle = null;
    }
    record.throttleLevel = 'none';
    record.consecutiveBreachTicksAtMax = 0;
    record.consecutiveGoodTicks = 0;

    if (record.deliberateStop) {
      await persistRecord(record, { lastExitCode: code, lastExitSignal: signal });
      return;
    }

    if (record.expectingExit) {
      // A readiness-timeout failure already ran the lifecycle transition and
      // scheduled the restart itself (see the health-check catch block below)
      // before killing this still-running child -- that kill's own 'exit'
      // event reaching here is expected, not a second failure.
      record.expectingExit = false;
      await persistRecord(record, { lastExitCode: code, lastExitSignal: signal });
      return;
    }

    const currentState = record.lifecycle.getState();
    const event = currentState === 'starting' ? 'spawn-failed' : 'unexpected-exit';
    record.lifecycle.transition(event);
    await persistRecord(record, { lastExitCode: code, lastExitSignal: signal });
    await scheduleRestart(record);
  }

  async function startBlock(record) {
    record.ready = false;
    if (record.deliberateStop) return;
    // Every call gets its own generation, current for as long as no later
    // startBlock() call for this same record has begun. Readiness checks and
    // process termination are async and unbounded in wall-clock time (a real
    // health-check probe against a dead port, a real process kill's grace
    // period) -- a prior attempt's poll loop or exit handler can still be
    // in flight when a restart's next attempt already begins. Every await
    // point below re-checks this before acting on the outcome, so a stale
    // attempt's result is silently dropped instead of transitioning the
    // lifecycle (now representing a DIFFERENT, newer attempt) into an
    // invalid state, or clobbering the current attempt's child/pid.
    const generation = ++record.generation;

    if (record.config.dependsOn.length > 0) {
      try {
        await waitForDependencies(record.config.dependsOn, isBlockReadyPredicate(record.appName), {
          timeoutMs: record.config.readyTimeoutMs,
          sleepFn,
          now,
        });
      } catch {
        if (record.generation !== generation) return;
        await failStart(record, 'readiness-timeout');
        return;
      }
      if (record.deliberateStop || record.generation !== generation) return;
    }

    let child;
    try {
      child = spawnBlockProcess(record.config.command, {
        cwd: record.appRootDir,
        spawnFn,
        platformName,
        env: Object.keys(record.extraEnv).length > 0 ? { ...process.env, ...record.extraEnv } : undefined,
      });
    } catch {
      if (record.generation !== generation) return;
      await failStart(record, 'spawn-failed');
      return;
    }

    if (record.generation !== generation) {
      // Superseded while spawning -- don't adopt this child into the record
      // (it belongs to an attempt nothing is tracking anymore), just make
      // sure it doesn't linger.
      terminateBlockTree(child.pid, { killFn, execFn, platformName, sleepFn, gracePeriodMs }).catch(() => {});
      return;
    }

    if (record.deliberateStop) {
      record.child = child;
      record.pid = child.pid;
      child.on('error', () => {});
      child.once('exit', (code, signal) => {
        handleExit(record, code, signal, generation).catch((error) =>
          logger.error('Blockworks: handleExit failed', { error: error.message }),
        );
      });
      await terminateBlockTree(child.pid, { killFn, execFn, platformName, sleepFn, gracePeriodMs });
      return;
    }

    record.child = child;
    record.pid = child.pid;
    attachBlockLogCapture(child, record.appName, record.blockName, { shipHome });
    child.on('error', (error) => {
      logger.warn('Blockworks: Block process error', {
        appName: record.appName,
        blockName: record.blockName,
        error: error.message,
      });
    });
    child.once('exit', (code, signal) => {
      handleExit(record, code, signal, generation).catch((error) =>
        logger.error('Blockworks: handleExit failed', { error: error.message }),
      );
    });

    if (record.config.healthCheck) {
      // A dead process will never bind to a health-check port -- without racing
      // the child's own exit, a Block that crashes immediately after spawning
      // (missing dependency, syntax error, wrong command...) would still make
      // this wait out the FULL readyTimeoutMs (30s default) doing nothing but
      // repeatedly failing to connect, before anyone finds out it already died.
      let exitedEarly = false;
      const earlyExit = new Promise((resolve) => {
        child.once('exit', () => {
          exitedEarly = true;
          resolve();
        });
      });
      const healthCheckStartedAt = now();
      const healthy = await Promise.race([
        waitForHealthCheck(record.config.healthCheck, {
          timeoutMs: record.config.readyTimeoutMs,
          sleepFn,
          now,
          probeOptions,
        })
          .then(() => true)
          .catch(() => false),
        earlyExit.then(() => false),
      ]);
      await logger.info('Block health check', {
        appName: record.appName,
        blockName: record.blockName,
        healthy,
        durationMs: now() - healthCheckStartedAt,
      });
      if (!healthy) {
        // If the child already exited, the 'exit' listener registered above
        // (handleExit) has very likely already run synchronously as part of
        // the same event dispatch and moved the lifecycle on -- only act here
        // if we're still the ones holding "starting", so this never fights
        // handleExit over the same transition.
        if (record.generation === generation && record.lifecycle.getState() === 'starting') {
          if (!record.deliberateStop) {
            await failStart(record, 'readiness-timeout');
          }
          if (record.pid) {
            record.expectingExit = true;
            await terminateBlockTree(record.pid, { killFn, execFn, platformName, sleepFn, gracePeriodMs });
          }
        }
        return;
      }
      if (exitedEarly || record.deliberateStop || record.generation !== generation) return;
    }

    if (record.generation !== generation) return;
    record.lifecycle.transition('ready');
    record.ready = true;
    record.restartPolicy.recordRunning();
    await persistRecord(record);
  }

  async function registerApp(appName, config, extraEnv = {}, perBlockEnv = {}) {
    const order = flattenStartOrder(config.blocks);
    for (const blockName of order) {
      const key = recordKey(appName, blockName);
      const existing = registry.get(key);
      if (existing) {
        // stopBlock() deliberately leaves the record behind (so status/logs
        // stay queryable for an app that's just stopped, not redeployed) --
        // it never meant "this name can never be used again". Only refuse a
        // registration that would actually collide with something live;
        // re-registering over a genuinely stopped record starts fresh.
        if (existing.lifecycle.getState() !== 'stopped') {
          throw new Error(`Block "${key}" is already registered`);
        }
        registry.delete(key);
      }
      registry.set(key, {
        appName,
        blockName,
        config: config.blocks[blockName],
        appRootDir: config.appRootDir,
        lifecycle: withTransitionLogging(createBlockLifecycle('starting'), { appName, blockName, logger }),
        restartPolicy: restartPolicyFactory(),
        child: null,
        pid: null,
        ready: false,
        deliberateStop: false,
        expectingExit: false,
        generation: 0,
        extraEnv: { ...extraEnv, ...(perBlockEnv[blockName] ?? {}) },
        pendingRestartTimer: null,
        throttleLevel: 'none',
        dutyCycle: null,
        consecutiveGoodTicks: 0,
        consecutiveBreachTicksAtMax: 0,
      });
    }

    await Promise.all(order.map((blockName) => startBlock(registry.get(recordKey(appName, blockName)))));
    return order;
  }

  async function stopBlock(appName, blockName) {
    const record = registry.get(recordKey(appName, blockName));
    if (!record) {
      throw new Error(`unknown Block: ${appName}:${blockName}`);
    }
    record.deliberateStop = true;
    record.restartPolicy.recordDeliberateStop();
    if (record.pendingRestartTimer) {
      clearTimeoutFn(record.pendingRestartTimer);
      record.pendingRestartTimer = null;
    }
    if (record.dutyCycle) {
      record.dutyCycle.stop();
      record.dutyCycle = null;
    }
    record.throttleLevel = 'none';
    if (record.lifecycle.getState() !== 'stopped') {
      record.lifecycle.transition('stop');
    }
    await persistRecord(record);
    if (record.pid) {
      await terminateBlockTree(record.pid, { killFn, execFn, platformName, sleepFn, gracePeriodMs });
    }
  }

  async function stopApp(appName) {
    const configBlocks = {};
    for (const record of registry.values()) {
      if (record.appName === appName) {
        configBlocks[record.blockName] = record.config;
      }
    }
    const order = flattenStartOrder(configBlocks).reverse();
    for (const blockName of order) {
      await stopBlock(appName, blockName);
    }
    return order;
  }

  function getBlockStatus(appName, blockName) {
    const record = registry.get(recordKey(appName, blockName));
    if (!record) return undefined;
    return {
      state: record.lifecycle.getState(),
      throttled: record.lifecycle.isThrottled(),
      throttleLevel: record.throttleLevel,
      pid: record.pid,
      priority: record.config.priority,
    };
  }

  function getAppStatus(appName) {
    const status = {};
    for (const record of registry.values()) {
      if (record.appName === appName) {
        status[record.blockName] = getBlockStatus(appName, record.blockName);
      }
    }
    return status;
  }

  function applyThrottleMechanism(record, level) {
    if (level === 'priority-lowered' || level === 'duty-cycled') {
      lowerPriority(record.pid, { setPriorityFn });
    }
    if (level === 'duty-cycled') {
      if (!record.dutyCycle) {
        record.dutyCycle = createDutyCycle(record.pid, { signalFn, setTimeoutFn, clearTimeoutFn });
      }
      record.dutyCycle.start();
    }
  }

  async function killForResourceExhaustion(record) {
    if (record.dutyCycle) {
      record.dutyCycle.stop();
      record.dutyCycle = null;
    }
    record.throttleLevel = 'none';
    record.consecutiveBreachTicksAtMax = 0;
    if (record.pid) {
      await terminateBlockTree(record.pid, { killFn, execFn, platformName, sleepFn, gracePeriodMs });
    }
  }

  async function escalateThrottle(record) {
    const currentLevel = record.throttleLevel;
    if (isMaxThrottleLevel(currentLevel, platformName)) {
      record.consecutiveBreachTicksAtMax += 1;
      if (record.consecutiveBreachTicksAtMax >= hysteresisTicks) {
        await killForResourceExhaustion(record);
      }
      return;
    }
    record.consecutiveBreachTicksAtMax = 0;
    const nextLevel = nextThrottleLevel(currentLevel, platformName);
    applyThrottleMechanism(record, nextLevel);
    record.throttleLevel = nextLevel;
    record.consecutiveGoodTicks = 0;
    record.lifecycle.setThrottled(true);
    await persistRecord(record);
  }

  async function deescalateThrottle(record) {
    if (record.throttleLevel === 'none') return;
    if (record.throttleLevel === 'duty-cycled' && record.dutyCycle) {
      record.dutyCycle.stop();
    }
    const prevLevel = prevThrottleLevel(record.throttleLevel, platformName);
    if (prevLevel === 'none') {
      restorePriority(record.pid, { setPriorityFn });
      record.lifecycle.setThrottled(false);
    }
    record.throttleLevel = prevLevel;
    record.consecutiveBreachTicksAtMax = 0;
    await persistRecord(record);
  }

  async function reactToBlockSample(record, sample) {
    const breaches = evaluatePerBlockBreach(sample, record.config.allowance);
    if (breaches) {
      await escalateThrottle(record);
      return;
    }
    if (record.throttleLevel !== 'none') {
      record.consecutiveGoodTicks += 1;
      if (record.consecutiveGoodTicks >= hysteresisTicks) {
        record.consecutiveGoodTicks = 0;
        await deescalateThrottle(record);
      }
    }
  }

  async function reactToUniversalBreach(tick) {
    const breaches = evaluateUniversalBreach(tick.system, universalCeiling);
    if (!breaches) return;
    for (const breach of breaches) {
      const candidates = [];
      for (const record of registry.values()) {
        if (record.lifecycle.getState() !== 'running' || !record.pid) continue;
        const sample = tick.perProcess[record.pid];
        candidates.push({
          record,
          priority: record.config.priority,
          cpuPercent: sample?.cpuPercent ?? 0,
          rssBytes: sample?.rssBytes ?? 0,
        });
      }
      const target = selectThrottleTarget(candidates, breach.metric);
      if (target) {
        await escalateThrottle(target.record);
      }
    }
  }

  async function runTick() {
    let tick;
    try {
      tick = await telemetrySource.getTick();
    } catch (error) {
      logger.warn('Blockworks: telemetry fetch failed, skipping tick', { error: error.message });
      return { skipped: true, reason: 'telemetry-fetch-failed' };
    }

    if (!isValidTick(tick)) {
      logger.warn('Blockworks: received an invalid tick, skipping');
      return { skipped: true, reason: 'invalid-tick' };
    }

    const perProcessOk = tick.health.perProcessChannel === 'ok';
    const systemOk = tick.health.systemChannel === 'ok';

    if (perProcessOk) {
      for (const record of registry.values()) {
        if (record.lifecycle.getState() !== 'running' || !record.pid) continue;
        const sample = tick.perProcess[record.pid];
        await reactToBlockSample(record, sample);
      }
    }

    if (systemOk) {
      await reactToUniversalBreach(tick);
    }

    return { skipped: false, perProcessOk, systemOk };
  }

  let pollTimer = null;
  let pollRunning = false;

  function scheduleNextTick() {
    pollTimer = setTimeoutFn(async () => {
      if (!pollRunning) return;
      try {
        await runTick();
      } catch (error) {
        logger.error('Blockworks: tick failed unexpectedly', { error: error.message });
      }
      if (pollRunning) {
        scheduleNextTick();
      }
    }, tickIntervalMs);
  }

  function startPolling() {
    if (pollRunning) return;
    pollRunning = true;
    scheduleNextTick();
  }

  function stopPolling() {
    pollRunning = false;
    if (pollTimer !== null) {
      clearTimeoutFn(pollTimer);
      pollTimer = null;
    }
  }

  return Object.freeze({
    registerApp,
    stopApp,
    stopBlock,
    getBlockStatus,
    getAppStatus,
    runTick,
    startPolling,
    stopPolling,
  });
}
