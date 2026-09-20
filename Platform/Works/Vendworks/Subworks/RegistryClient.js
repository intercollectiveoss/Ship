// ship
// designed and built by onyxpowered.

export const REGISTRY_CLIENT_METHODS = Object.freeze([
  'fetchConnectorManifest',
  'fetchConnectorSource',
  'publishConnector',
  'searchConnectors',
]);

function unimplemented(methodName) {
  return async function unimplementedRegistryMethod() {
    throw new Error(
      `registry client does not implement ${methodName}() -- Services' connector registry host does not exist yet, inject a real client implementing this method`,
    );
  };
}

export function createRegistryClient(overrides = {}) {
  if (overrides == null || typeof overrides !== 'object') {
    throw new Error('createRegistryClient overrides must be an object');
  }
  const client = {};
  for (const methodName of REGISTRY_CLIENT_METHODS) {
    const impl = overrides[methodName];
    if (impl !== undefined && typeof impl !== 'function') {
      throw new Error(`registry client method "${methodName}" must be a function`);
    }
    client[methodName] = impl ?? unimplemented(methodName);
  }
  return Object.freeze(client);
}

export function assertRegistryClient(client) {
  if (client == null || typeof client !== 'object') {
    throw new Error('a registry client must be an object');
  }
  for (const methodName of REGISTRY_CLIENT_METHODS) {
    if (typeof client[methodName] !== 'function') {
      throw new Error(`registry client is missing required method "${methodName}"`);
    }
  }
  return true;
}
