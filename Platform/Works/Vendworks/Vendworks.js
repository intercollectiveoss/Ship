// ship
// designed and built by onyxpowered.

import { VERSION } from './Subworks/Version.js';
import { validateConnector, requiredConfigKeys, parseConnectorName } from './Subworks/Contract.js';
import { connectorRole, connectorRoleFromParts } from './Subworks/Roles.js';
import { createRegistryClient, assertRegistryClient, REGISTRY_CLIENT_METHODS } from './Subworks/RegistryClient.js';
import { createEnforcedVault } from './Subworks/Enforcement.js';
import {
  installConnector,
  updateConnector,
  uninstallConnector,
  listInstalledConnectors,
} from './Subworks/Installer.js';
import { publishConnector } from './Subworks/Publisher.js';

export { VERSION };
export {
  validateConnector,
  requiredConfigKeys,
  parseConnectorName,
  connectorRole,
  connectorRoleFromParts,
  createRegistryClient,
  assertRegistryClient,
  REGISTRY_CLIENT_METHODS,
  createEnforcedVault,
  installConnector,
  updateConnector,
  uninstallConnector,
  listInstalledConnectors,
  publishConnector,
};

export function createVendworks({ vault, registryClient, shipHome } = {}) {
  assertRegistryClient(registryClient);
  return Object.freeze({
    install: (name, options = {}) => installConnector({ name, vault, registryClient, shipHome, ...options }),
    update: (name, options = {}) => updateConnector({ name, vault, registryClient, shipHome, ...options }),
    uninstall: (name, options = {}) => uninstallConnector({ name, vault, shipHome, ...options }),
    list: (options = {}) => listInstalledConnectors({ shipHome, ...options }),
    publish: (options = {}) => publishConnector({ registryClient, ...options }),
  });
}
