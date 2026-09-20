// ship
// designed and built by onyxpowered.

export function validateConnector(connector) {
  if (typeof connector.register !== 'function') {
    throw new Error('a connector must export a register(ship) function');
  }
  if (connector.configSchema !== undefined && typeof connector.configSchema !== 'object') {
    throw new Error('a connector configSchema must be an object');
  }
  for (const hook of ['install', 'uninstall', 'update']) {
    if (connector[hook] !== undefined && typeof connector[hook] !== 'function') {
      throw new Error(`a connector's ${hook} hook must be a function`);
    }
  }
  return true;
}

export function requiredConfigKeys(connector) {
  return Object.keys(connector.configSchema ?? {});
}

export function parseConnectorName(name) {
  const match = /^@([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(name);
  if (!match) {
    throw new Error(`connector name must be @publisher/name, got "${name}"`);
  }
  return { publisher: match[1], connector: match[2] };
}
