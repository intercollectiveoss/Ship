// ship
// designed and built by onyxpowered.

import { createFileStore } from './Subworks/Store.js';
import { createVaultInterface } from './Subworks/Interface.js';
import { exportVaultBundle, importVaultBundle } from './Subworks/Backup.js';
import { resolveshipHome, vaultDir as resolveVaultDir } from '../Paths.js';

export const VERSION = '0.1.0';

export async function createVault(options = {}) {
  const shipHome = options.shipHome ?? resolveshipHome();
  const rootDir = options.vaultDir ?? resolveVaultDir(shipHome);
  const store = await createFileStore(rootDir);
  const vaultInterface = createVaultInterface(store);

  return Object.freeze({
    interface: vaultInterface,
    rootDir,

    async export(passphrase, destPath) {
      return exportVaultBundle(store, passphrase, destPath);
    },

    async import(passphrase, bundlePath) {
      return importVaultBundle(store, passphrase, bundlePath);
    },

    async listRoles() {
      return store.listRoles();
    },
  });
}
