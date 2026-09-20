// ship
// designed and built by onyxpowered.

import { createMetalworks } from '../../Metalworks/Metalworks.js';
import { createBlockworks } from '../../Blockworks/Blockworks.js';
import { createVendworks, createRegistryClient } from '../../Vendworks/Vendworks.js';
import {
  MODES,
  resolveInterworksTarget,
  startInterworks,
  createStaticBlockHandle,
  requireDaemonToken,
  resolveServicesUrl,
  slugifyAppName,
  shipBasePathEnv,
} from '../../Interworks/Interworks.js';

const DEFAULT_TELEMETRY_SYNC_INTERVAL_MS = 500;
const FINGERPRINT_CHECK_TIMEOUT_MS = 5000;
const PREVIEW_READY_TIMEOUT_MS = 10000;

function servicesWsUrl(servicesUrl) {
  return servicesUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
}

function servicesHostname(servicesUrl) {
  return new URL(servicesUrl).host;
}

function waitForPreviewReady(previewTunnel, timeoutMs = PREVIEW_READY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timed out waiting for Services to accept this preview tunnel'));
    }, timeoutMs);
    previewTunnel.tunnel.once('helloAck', () => {
      clearTimeout(timer);
      resolve();
    });
    previewTunnel.tunnel.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function hasWork(works, name) {
  return works.some((work) => work.name === name);
}

function createTelemetryBridge(metalworks, { intervalMs = DEFAULT_TELEMETRY_SYNC_INTERVAL_MS } = {}) {
  let blockworksRef = null;
  let trackedPids = new Set();
  let timer = null;

  function bindBlockworks(blockworks) {
    blockworksRef = blockworks;
  }

  async function syncOnce() {
    if (!blockworksRef) return;
    const known = await blockworksRef.listKnownBlocks();
    const liveNow = new Set(known.filter((block) => block.state === 'running' && block.pid).map((block) => block.pid));
    for (const pid of liveNow) {
      if (!trackedPids.has(pid)) {
        metalworks.track(pid);
      }
    }
    for (const pid of trackedPids) {
      if (!liveNow.has(pid)) {
        metalworks.untrack(pid);
      }
    }
    trackedPids = liveNow;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      syncOnce().catch(() => {});
    }, intervalMs);
    if (timer.unref) timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return Object.freeze({
    getTick: () => metalworks.getLatestTick(),
    bindBlockworks,
    syncOnce,
    start,
    stop,
  });
}

function waitForNextTick(metalworks, timeoutMs) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('timed out waiting for a Metalworks tick'));
    }, timeoutMs);
    unsubscribe = metalworks.onTick((tick) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(tick);
    });
  });
}

function createLivenessFingerprintCheck(metalworks) {
  return async function fingerprintCheck(block) {
    const pid = block.pid;
    if (!pid) return false;
    metalworks.track(pid);
    const tick = await waitForNextTick(metalworks, FINGERPRINT_CHECK_TIMEOUT_MS);
    const sample = tick.perProcess[pid];
    return Boolean(sample && sample.alive);
  };
}

export async function composeWorks({ vault, shipHome, logger, works = [] }) {
  const hasMetalworks = hasWork(works, 'Metalworks');
  const hasBlockworks = hasWork(works, 'Blockworks');
  const hasVendworks = hasWork(works, 'Vendworks');

  let metalworks = null;
  let blockworks = null;
  let vendworks = null;
  let telemetryBridge = null;
  const deployments = new Map();

  if (hasMetalworks) {
    metalworks = createMetalworks({});
    await metalworks.whenReady();
    telemetryBridge = createTelemetryBridge(metalworks);
  }

  if (hasBlockworks && telemetryBridge) {
    blockworks = await createBlockworks({ shipHome, telemetrySource: telemetryBridge, logger, vault });
    telemetryBridge.bindBlockworks(blockworks);
    telemetryBridge.start();
    blockworks.startPolling();
  }

  if (hasVendworks) {
    vendworks = createVendworks({ vault, registryClient: createRegistryClient(), shipHome });
  }

  async function listKnownBlocks() {
    if (!blockworks) return [];
    return blockworks.listKnownBlocks();
  }

  const fingerprintCheck = metalworks ? createLivenessFingerprintCheck(metalworks) : null;

  async function deployApp({
    appName,
    appRootDir,
    mode = MODES.POST,
    port,
    hostname,
    domain,
    altNames,
    contact,
    directoryUrl,
    attemptForwarding,
  }) {
    if (!blockworks) {
      throw new Error('deploy requires Blockworks, which is not part of this daemon composition');
    }
    if (deployments.has(appName)) {
      throw new Error(`app "${appName}" is already deployed -- stop it first`);
    }

    const extraEnv = mode === MODES.PREVIEW ? shipBasePathEnv(slugifyAppName(appName)) : {};
    const config = await blockworks.deployApp(appName, appRootDir, {}, extraEnv);
    if (telemetryBridge) await telemetryBridge.syncOnce();

    const target = resolveInterworksTarget(appName, config, mode);
    const entryBlock = target.entryBlock;

    let routing;
    if (mode === MODES.POST) {
      if (!entryBlock.healthCheck || entryBlock.healthCheck.port === undefined) {
        throw new Error(
          `Block "${target.entryBlockName}" must declare healthCheck.port in ship.config.js for Interworks to know which port to route to`,
        );
      }
      const blockHandle = createStaticBlockHandle({
        name: target.entryBlockName,
        port: entryBlock.healthCheck.port,
        ready: true,
      });
      routing = await startInterworks({
        mode: MODES.POST,
        vault,
        blockHandle,
        port: port ?? 0,
        hostname: hostname ?? '127.0.0.1',
      });
    } else if (mode === MODES.PREVIEW) {
      if (!entryBlock.healthCheck || entryBlock.healthCheck.port === undefined) {
        throw new Error(
          `Block "${target.entryBlockName}" must declare healthCheck.port in ship.config.js for Interworks to know which port to route to`,
        );
      }
      const blockHandle = createStaticBlockHandle({
        name: target.entryBlockName,
        port: entryBlock.healthCheck.port,
        ready: true,
      });
      const token = await requireDaemonToken(vault);
      const servicesUrl = resolveServicesUrl();
      routing = await startInterworks({
        mode: MODES.PREVIEW,
        servicesUrl: servicesWsUrl(servicesUrl),
        token,
        appSlug: target.appSlug,
        blockHandle,
        previewDomain: servicesHostname(servicesUrl),
      });
      await waitForPreviewReady(routing);
    } else if (mode === MODES.PRODUCTION) {
      if (!entryBlock.healthCheck || entryBlock.healthCheck.port === undefined) {
        throw new Error(
          `Block "${target.entryBlockName}" must declare healthCheck.port in ship.config.js for Interworks to know which port to route to`,
        );
      }
      if (!domain) {
        throw new Error('production mode requires a domain: ship deploy production <app> --domain=<your-domain>');
      }
      const blockHandle = createStaticBlockHandle({
        name: target.entryBlockName,
        port: entryBlock.healthCheck.port,
        ready: true,
      });
      routing = await startInterworks({
        mode: MODES.PRODUCTION,
        vault,
        domain,
        altNames,
        contact,
        directoryUrl,
        attemptForwarding,
        blockHandle,
        httpsPort: port,
      });
    } else {
      throw new Error(`unknown Interworks mode: ${mode}`);
    }

    deployments.set(appName, { config, mode, routing, entryBlockName: target.entryBlockName });
    return {
      appName,
      mode,
      entryBlock: target.entryBlockName,
      url: mode === MODES.PREVIEW ? (routing.assignedPreviewUrl() ?? routing.expectedPreviewUrl) : routing.url,
      upstream: routing.upstream,
    };
  }

  async function stopApp({ appName, blockName }) {
    if (!blockworks) {
      throw new Error('stop requires Blockworks, which is not part of this daemon composition');
    }
    if (blockName) {
      await blockworks.stopBlock(appName, blockName);
      if (telemetryBridge) await telemetryBridge.syncOnce();
      return { appName, blockName, stopped: true };
    }

    await blockworks.stopApp(appName);
    if (telemetryBridge) await telemetryBridge.syncOnce();

    const deployment = deployments.get(appName);
    if (deployment?.routing && typeof deployment.routing.close === 'function') {
      await deployment.routing.close();
    }
    deployments.delete(appName);
    return { appName, stopped: true };
  }

  function getDeployment(appName) {
    return deployments.get(appName);
  }

  async function stop() {
    if (telemetryBridge) telemetryBridge.stop();
    if (blockworks) blockworks.stopPolling();
    for (const [appName, deployment] of deployments) {
      if (deployment.routing && typeof deployment.routing.close === 'function') {
        await deployment.routing.close().catch(() => {});
      }
      deployments.delete(appName);
    }
    if (metalworks) await metalworks.stop();
  }

  return Object.freeze({
    metalworks,
    blockworks,
    vendworks,
    telemetryBridge,
    listKnownBlocks,
    fingerprintCheck,
    deployApp,
    stopApp,
    getDeployment,
    stop,
  });
}
