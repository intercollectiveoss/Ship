// ship
// designed and built by onyxpowered.

import { pathToFileURL } from 'node:url';

export const DEFAULT_ENTRY_FILE = 'index.js';

async function defaultImportModule(url) {
  return import(url);
}

function cacheBustingUrl(entryPath) {
  const base = pathToFileURL(entryPath).href;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function loadConnectorModule(entryPath, importModule = defaultImportModule) {
  if (typeof entryPath !== 'string' || entryPath.length === 0) {
    throw new Error('loadConnectorModule requires an entry file path');
  }
  const imported = await importModule(cacheBustingUrl(entryPath));
  const connectorModule = imported != null && Object.prototype.hasOwnProperty.call(imported, 'default')
    ? imported.default
    : imported;
  if (connectorModule == null || typeof connectorModule !== 'object') {
    throw new Error(`connector entry file "${entryPath}" did not export a connector object`);
  }
  return connectorModule;
}
