// ship
// designed and built by onyxpowered.

import { writeFile, rm } from 'node:fs/promises';
import { startIpcServer } from './Subworks/IPC.js';
import { createDaemonLogger, tailLog } from './Subworks/Logging.js';
import { reconcileBlocks, defaultListKnownBlocks, defaultFingerprintCheck } from './Subworks/Reconciliation.js';
import { composeWorks } from './Subworks/Composition.js';
import { VERSION } from './Subworks/Version.js';
import {
  resolveshipHome,
  daemonLogPath,
  socketPath as resolveSocketPath,
  pidFilePath,
} from '../../Paths.js';

export { VERSION };

async function dispatchRequest(message, { startedAt, shutdown, composition }) {
  switch (message.type) {
    case 'version':
      return { version: VERSION, startedAt };
    case 'ping':
      return { pong: true };
    case 'shutdown':
      setImmediate(() => {
        shutdown('ipc-shutdown').finally(() => process.exit(0));
      });
      return { shuttingDown: true };
    case 'deploy':
      return composition.deployApp({
        appName: message.appName,
        appRootDir: message.appRootDir,
        mode: message.mode,
        port: message.port,
        hostname: message.hostname,
        domain: message.domain,
        altNames: message.altNames,
        contact: message.contact,
        directoryUrl: message.directoryUrl,
        attemptForwarding: message.attemptForwarding,
      });
    case 'stop':
      return composition.stopApp({ appName: message.appName, blockName: message.blockName });
    default:
      throw new Error(`unknown IPC request type: ${message.type}`);
  }
}

// Logged around dispatchRequest (rather than inside it) so every request
// type gets the same timing/outcome visibility for free, without each case
// having to remember to log itself.
function buildRequestHandler({ startedAt, shutdown, composition, logger }) {
  return async function handleRequest(message) {
    const startedAtMs = Date.now();
    try {
      const result = await dispatchRequest(message, { startedAt, shutdown, composition });
      await logger.info('ipc request', { type: message.type, durationMs: Date.now() - startedAtMs });
      return result;
    } catch (error) {
      await logger.warn('ipc request failed', {
        type: message.type,
        durationMs: Date.now() - startedAtMs,
        error: error.message,
      });
      throw error;
    }
  };
}

async function runReconciliation({ reconciliation, logger, composition }) {
  try {
    return await reconcileBlocks({
      listKnownBlocks: reconciliation.listKnownBlocks ?? composition?.listKnownBlocks ?? defaultListKnownBlocks,
      fingerprintCheck: reconciliation.fingerprintCheck ?? composition?.fingerprintCheck ?? defaultFingerprintCheck,
      logger,
    });
  } catch (error) {
    await logger.error('reconciliation failed unexpectedly, continuing daemon boot without it', {
      error: error.message,
    });
    return { reattached: [], stale: [] };
  }
}

export async function runDaemon({ vault, works = [], shipHome = resolveshipHome(), reconciliation = {}, verbose = false } = {}) {
  const logPath = daemonLogPath(shipHome);
  const logger = createDaemonLogger(logPath, { verbose });
  await logger.info('daemon starting', { version: VERSION });

  const socket = resolveSocketPath(shipHome);
  const startedAt = new Date().toISOString();

  const composition = await composeWorks({ vault, shipHome, logger, works });
  await logger.info('composition ready', {
    metalworks: Boolean(composition.metalworks),
    blockworks: Boolean(composition.blockworks),
    vendworks: Boolean(composition.vendworks),
  });

  const reconciliationResult = await runReconciliation({ reconciliation, logger, composition });

  const serverRef = {};
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await logger.info('daemon shutting down', { signal });
    serverRef.server?.close();
    await composition.stop().catch((error) => logger.error('composition teardown failed', { error: error.message }));
    await rm(pidFilePath(shipHome), { force: true });
  };

  const server = await startIpcServer(socket, buildRequestHandler({ startedAt, shutdown, composition, logger }));
  serverRef.server = server;

  await writeFile(pidFilePath(shipHome), String(process.pid));
  if (vault) {
    await vault.interface.writeReserved('daemon/pid', process.pid);
    await vault.interface.writeReserved('daemon/socketPath', socket);
    await vault.interface.writeReserved('daemon/startedAt', startedAt);
  }

  await logger.info('daemon ready', { socket, pid: process.pid, works: works.map((w) => w.name) });

  process.on('SIGINT', () => shutdown('SIGINT').then(() => process.exit(0)));
  process.on('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)));

  return { server, logger, reconciliationResult, socket, shutdown, composition };
}

export async function receivePlatformReady({ vault, works, options = {} }) {
  return runDaemon({
    vault,
    works,
    shipHome: options.shipHome,
    reconciliation: options.reconciliation,
    verbose: options.verbose,
  });
}

export async function readLogs(shipHome = resolveshipHome(), lineCount = 100) {
  return tailLog(daemonLogPath(shipHome), lineCount);
}
