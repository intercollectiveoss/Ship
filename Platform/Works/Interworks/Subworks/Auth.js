// ship
// designed and built by onyxpowered.

const DAEMON_TOKEN_PATH = 'interworks/daemonToken';
const DEFAULT_SERVICES_URL = 'https://preview.onyxpowered.com';

export function resolveServicesUrl() {
  return process.env.SHIP_SERVICES_URL ?? DEFAULT_SERVICES_URL;
}

export async function getDaemonToken(vault) {
  const record = await vault.interface.readReserved(DAEMON_TOKEN_PATH);
  return record ?? null;
}

export async function setDaemonToken(vault, token, { issuedAt = new Date().toISOString(), accountId = null } = {}) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('a daemon auth token must be a non-empty string');
  }
  const record = Object.freeze({ token, issuedAt, accountId });
  await vault.interface.writeReserved(DAEMON_TOKEN_PATH, record);
  return record;
}

export async function clearDaemonToken(vault) {
  await vault.interface.writeReserved(DAEMON_TOKEN_PATH, null);
}

export async function requireDaemonToken(vault) {
  const record = await getDaemonToken(vault);
  if (!record || typeof record.token !== 'string' || record.token.length === 0) {
    throw new Error('no daemon auth token found -- run `ship login` first');
  }
  return record.token;
}

export async function hasDaemonToken(vault) {
  const record = await getDaemonToken(vault);
  return Boolean(record && typeof record.token === 'string' && record.token.length > 0);
}

export function authorizationHeader(token) {
  return `Bearer ${token}`;
}
