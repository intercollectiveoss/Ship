// ship
// designed and built by onyxpowered.

import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const MAX_SAFE_SOCKET_PATH_LENGTH = 100;

export function resolveshipHome() {
  return process.env.SHIP_HOME ?? join(homedir(), '.ship');
}

export function vaultDir(shipHome = resolveshipHome()) {
  return join(shipHome, 'vault');
}

export function blockworksDir(shipHome = resolveshipHome()) {
  return join(shipHome, 'blockworks');
}

export function logsDir(shipHome = resolveshipHome()) {
  return join(shipHome, 'logs');
}

export function appsDir(shipHome = resolveshipHome()) {
  return join(shipHome, 'apps');
}

export function blockLogPath(appName, blockName, shipHome = resolveshipHome()) {
  return join(logsDir(shipHome), 'blocks', appName, `${blockName}.log`);
}

export function daemonLogPath(shipHome = resolveshipHome()) {
  return join(logsDir(shipHome), 'daemon.log');
}

function shipHomeHash(shipHome) {
  return createHash('sha256').update(shipHome).digest('hex').slice(0, 16);
}

export function socketPath(shipHome = resolveshipHome()) {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\ship-daemon-${shipHomeHash(shipHome)}`;
  }
  const preferred = join(shipHome, 'daemon.sock');
  if (preferred.length <= MAX_SAFE_SOCKET_PATH_LENGTH) {
    return preferred;
  }
  return join(tmpdir(), `ship-${shipHomeHash(shipHome)}.sock`);
}

export function pidFilePath(shipHome = resolveshipHome()) {
  return join(shipHome, 'daemon.pid');
}
