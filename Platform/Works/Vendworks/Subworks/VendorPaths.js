// ship
// designed and built by onyxpowered.

import { join } from 'node:path';
import { resolveshipHome } from '../../../Paths.js';

export function vendorsRootDir(shipHome = resolveshipHome()) {
  return join(shipHome, 'vendors');
}

export function connectorVendorDir(publisher, connector, shipHome = resolveshipHome()) {
  return join(vendorsRootDir(shipHome), publisher, connector);
}

export const CONNECTOR_METADATA_FILE = '.ship-connector.json';

export function connectorMetadataPath(publisher, connector, shipHome = resolveshipHome()) {
  return join(connectorVendorDir(publisher, connector, shipHome), CONNECTOR_METADATA_FILE);
}
