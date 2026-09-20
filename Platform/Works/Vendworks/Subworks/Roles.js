// ship
// designed and built by onyxpowered.

import { parseConnectorName } from './Contract.js';

const ROLE_PREFIX = 'connector';
const ROLE_SEPARATOR = '__';
const ROLE_SAFE_PATTERN = /^[a-z0-9_-]+$/;

export function connectorRoleFromParts(publisher, connector) {
  if (typeof publisher !== 'string' || publisher.length === 0) {
    throw new Error('connectorRoleFromParts requires a non-empty publisher');
  }
  if (typeof connector !== 'string' || connector.length === 0) {
    throw new Error('connectorRoleFromParts requires a non-empty connector name');
  }
  const role = [ROLE_PREFIX, publisher, connector].join(ROLE_SEPARATOR);
  if (!ROLE_SAFE_PATTERN.test(role)) {
    throw new Error(`derived connector role "${role}" is not a valid Vault role`);
  }
  return role;
}

export function connectorRole(name) {
  const { publisher, connector } = parseConnectorName(name);
  return connectorRoleFromParts(publisher, connector);
}
