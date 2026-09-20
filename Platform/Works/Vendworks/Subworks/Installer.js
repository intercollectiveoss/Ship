// ship
// designed and built by onyxpowered.

import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { resolveshipHome } from '../../../Paths.js';
import { validateConnector, requiredConfigKeys, parseConnectorName } from './Contract.js';
import { connectorRoleFromParts } from './Roles.js';
import { connectorVendorDir, connectorMetadataPath, vendorsRootDir } from './VendorPaths.js';
import { loadConnectorModule, DEFAULT_ENTRY_FILE } from './Loader.js';
import { createEnforcedVault } from './Enforcement.js';
import { promptForConnectorConfig } from './Prompt.js';
import { readInstalledMetadata, writeInstalledMetadata } from './InstalledStore.js';
import { assertRegistryClient } from './RegistryClient.js';

function defaultNow() {
  return new Date().toISOString();
}

export async function defaultRemoveDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

export async function defaultWriteFiles(targetDir, files) {
  const resolvedTarget = resolve(targetDir);
  for (const file of files) {
    const filePath = resolve(join(resolvedTarget, file.path));
    if (filePath !== resolvedTarget && !filePath.startsWith(resolvedTarget + sep)) {
      throw new Error(`connector source file escapes its own vendor directory: "${file.path}"`);
    }
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.contents, 'utf8');
  }
}

function buildConnectorHandle({ name, role, vaultInterface, declaredPaths }) {
  return Object.freeze({
    name,
    role,
    vault: createEnforcedVault({ vaultInterface, role, declaredPaths, connectorName: name }),
  });
}

async function fetchAndVendorSource({ publisher, connector, version, registryClient, vendorDir, writeFiles }) {
  const source = await registryClient.fetchConnectorSource({ publisher, connector, version });
  if (!Array.isArray(source?.files) || source.files.length === 0) {
    throw new Error(`registry returned no source files for @${publisher}/${connector}@${version}`);
  }
  const entry = source.entry ?? DEFAULT_ENTRY_FILE;
  if (!source.files.some((file) => file.path === entry)) {
    throw new Error(
      `connector source for @${publisher}/${connector}@${version} is missing its declared entry file "${entry}"`,
    );
  }
  await writeFiles(vendorDir, source.files);
  return { version: source.version ?? version, entry };
}

function ignoreRollbackFailure() {}

async function rollbackFailedInstall({ vault, role, vendorDir, removeDir }) {
  await vault
    .listRoles()
    .then((roles) => (roles.includes(role) ? vault.interface.wipeRole(role) : undefined))
    .catch(ignoreRollbackFailure);
  await removeDir(vendorDir).catch(ignoreRollbackFailure);
}

export async function installConnector({
  name,
  vault,
  registryClient,
  shipHome = resolveshipHome(),
  ask,
  askSecret,
  writeFiles = defaultWriteFiles,
  removeDir = defaultRemoveDir,
  importModule,
  now = defaultNow,
}) {
  assertRegistryClient(registryClient);
  const { publisher, connector } = parseConnectorName(name);
  const role = connectorRoleFromParts(publisher, connector);
  const vendorDir = connectorVendorDir(publisher, connector, shipHome);

  if (existsSync(vendorDir)) {
    throw new Error(`connector "${name}" is already installed, use update instead`);
  }

  const manifest = await registryClient.fetchConnectorManifest({ publisher, connector });
  const version = manifest?.latestVersion;
  if (!version) {
    throw new Error(`registry has no published version for connector "${name}"`);
  }

  try {
    const { entry } = await fetchAndVendorSource({
      publisher,
      connector,
      version,
      registryClient,
      vendorDir,
      writeFiles,
    });

    const connectorModule = await loadConnectorModule(join(vendorDir, entry), importModule);
    validateConnector(connectorModule);

    await vault.interface.declareRole(role);
    const keys = requiredConfigKeys(connectorModule);
    const values =
      keys.length > 0 ? await promptForConnectorConfig({ connector: connectorModule, keys, ask, askSecret }) : {};
    for (const key of keys) {
      await vault.interface.write(role, key, values[key]);
    }

    const handle = buildConnectorHandle({ name, role, vaultInterface: vault.interface, declaredPaths: keys });
    await connectorModule.register(handle);
    if (typeof connectorModule.install === 'function') {
      await connectorModule.install(handle);
    }

    await writeInstalledMetadata(connectorMetadataPath(publisher, connector, shipHome), {
      name,
      publisher,
      connector,
      version,
      entry,
      configKeys: keys,
      installedAt: now(),
      updatedAt: now(),
    });

    return { name, role, version, configKeys: keys };
  } catch (error) {
    await rollbackFailedInstall({ vault, role, vendorDir, removeDir });
    throw error;
  }
}

export async function updateConnector({
  name,
  vault,
  registryClient,
  shipHome = resolveshipHome(),
  ask,
  askSecret,
  writeFiles = defaultWriteFiles,
  importModule,
  now = defaultNow,
}) {
  assertRegistryClient(registryClient);
  const { publisher, connector } = parseConnectorName(name);
  const role = connectorRoleFromParts(publisher, connector);
  const vendorDir = connectorVendorDir(publisher, connector, shipHome);
  const metadataPath = connectorMetadataPath(publisher, connector, shipHome);

  const installedMetadata = await readInstalledMetadata(metadataPath);
  if (!installedMetadata) {
    throw new Error(`connector "${name}" is not installed, use install instead`);
  }

  const manifest = await registryClient.fetchConnectorManifest({ publisher, connector });
  const latestVersion = manifest?.latestVersion;
  if (!latestVersion) {
    throw new Error(`registry has no published version for connector "${name}"`);
  }
  if (latestVersion === installedMetadata.version) {
    return { name, role, version: latestVersion, updated: false };
  }

  const { entry } = await fetchAndVendorSource({
    publisher,
    connector,
    version: latestVersion,
    registryClient,
    vendorDir,
    writeFiles,
  });

  const connectorModule = await loadConnectorModule(join(vendorDir, entry), importModule);
  validateConnector(connectorModule);

  await vault.interface.declareRole(role);
  const keys = requiredConfigKeys(connectorModule);
  const missingKeys = [];
  for (const key of keys) {
    const existing = await vault.interface.read(role, key);
    if (existing === undefined) missingKeys.push(key);
  }
  if (missingKeys.length > 0) {
    const values = await promptForConnectorConfig({ connector: connectorModule, keys: missingKeys, ask, askSecret });
    for (const key of missingKeys) {
      await vault.interface.write(role, key, values[key]);
    }
  }

  const handle = buildConnectorHandle({ name, role, vaultInterface: vault.interface, declaredPaths: keys });
  await connectorModule.register(handle);
  if (typeof connectorModule.update === 'function') {
    await connectorModule.update(handle, { fromVersion: installedMetadata.version, toVersion: latestVersion });
  }

  await writeInstalledMetadata(metadataPath, {
    ...installedMetadata,
    version: latestVersion,
    entry,
    configKeys: keys,
    updatedAt: now(),
  });

  return {
    name,
    role,
    version: latestVersion,
    updated: true,
    previousVersion: installedMetadata.version,
    newlyConfiguredKeys: missingKeys,
  };
}

export async function uninstallConnector({ name, vault, shipHome = resolveshipHome(), removeDir = defaultRemoveDir, importModule }) {
  const { publisher, connector } = parseConnectorName(name);
  const role = connectorRoleFromParts(publisher, connector);
  const vendorDir = connectorVendorDir(publisher, connector, shipHome);
  const metadataPath = connectorMetadataPath(publisher, connector, shipHome);

  const installedMetadata = await readInstalledMetadata(metadataPath);

  let hookError;
  if (existsSync(vendorDir)) {
    try {
      const entry = installedMetadata?.entry ?? DEFAULT_ENTRY_FILE;
      const connectorModule = await loadConnectorModule(join(vendorDir, entry), importModule);
      if (typeof connectorModule.uninstall === 'function') {
        const keys = installedMetadata?.configKeys ?? requiredConfigKeys(connectorModule);
        const handle = buildConnectorHandle({ name, role, vaultInterface: vault.interface, declaredPaths: keys });
        await connectorModule.uninstall(handle);
      }
    } catch (error) {
      hookError = error.message;
    }
  }

  const roles = await vault.listRoles();
  if (roles.includes(role)) {
    await vault.interface.wipeRole(role);
  }
  await removeDir(vendorDir);

  return { name, role, wiped: true, hookError };
}

export async function listInstalledConnectors({ shipHome = resolveshipHome() } = {}) {
  const root = vendorsRootDir(shipHome);
  if (!existsSync(root)) {
    return [];
  }
  const results = [];
  const publisherEntries = await readdir(root, { withFileTypes: true });
  for (const publisherEntry of publisherEntries) {
    if (!publisherEntry.isDirectory()) continue;
    const publisherDir = join(root, publisherEntry.name);
    const connectorEntries = await readdir(publisherDir, { withFileTypes: true });
    for (const connectorEntry of connectorEntries) {
      if (!connectorEntry.isDirectory()) continue;
      const metadataPath = join(publisherDir, connectorEntry.name, '.ship-connector.json');
      const metadata = await readInstalledMetadata(metadataPath);
      if (metadata) results.push(metadata);
    }
  }
  return results;
}
