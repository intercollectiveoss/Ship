// ship
// designed and built by onyxpowered.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { validateConnector, parseConnectorName } from './Contract.js';
import { loadConnectorModule, DEFAULT_ENTRY_FILE } from './Loader.js';
import { assertRegistryClient } from './RegistryClient.js';

export async function defaultReadSourceFiles(sourceDir) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const contents = await readFile(full, 'utf8');
        files.push({ path: relative(sourceDir, full).split(sep).join('/'), contents });
      }
    }
  }
  await walk(sourceDir);
  return files;
}

export async function publishConnector({
  name,
  version,
  sourceDir,
  entry = DEFAULT_ENTRY_FILE,
  description = '',
  token,
  registryClient,
  importModule,
  readSourceFiles = defaultReadSourceFiles,
}) {
  assertRegistryClient(registryClient);
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('publishConnector requires a version string');
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('publishConnector requires an auth token from `ship login`');
  }
  const { publisher, connector } = parseConnectorName(name);

  const connectorModule = await loadConnectorModule(join(sourceDir, entry), importModule);
  validateConnector(connectorModule);

  const files = await readSourceFiles(sourceDir);
  if (!files.some((file) => file.path === entry)) {
    throw new Error(`source directory is missing its declared entry file "${entry}"`);
  }

  const configSchema = connectorModule.configSchema ?? {};

  const published = await registryClient.publishConnector(
    { publisher, connector, version, description, configSchema, entry, files },
    token,
  );

  return { name, publisher, connector, version, ...published };
}
