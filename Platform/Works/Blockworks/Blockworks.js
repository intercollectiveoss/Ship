// ship
// designed and built by onyxpowered.

import { loadshipConfig } from './Subworks/Loader.js';
import { createBlockStateStore } from './Subworks/State.js';
import { createSupervisor } from './Subworks/Supervisor.js';
import { readBlockLogs } from './Subworks/BlockLogs.js';
import { resolveConnectorEnv } from './Subworks/Connectors.js';
import { VERSION } from './Subworks/Version.js';
import { resolveshipHome, blockworksDir } from '../../Paths.js';

export { VERSION };
export { readBlockLogs };

export async function createBlockworks(options = {}) {
  const shipHome = options.shipHome ?? resolveshipHome();
  const vault = options.vault ?? null;
  const stateStore = options.stateStore ?? (await createBlockStateStore(options.blockworksDir ?? blockworksDir(shipHome)));

  const {
    stateStore: _ignoredStateStore,
    shipHome: _ignoredshipHome,
    blockworksDir: _ignoredBlockworksDir,
    vault: _ignoredVault,
    ...supervisorOptions
  } = options;

  const supervisor = createSupervisor({
    ...supervisorOptions,
    stateStore,
    shipHome,
  });

  async function deployApp(appName, appRootDir, loaderOptions = {}, extraEnv = {}) {
    const config = await loadshipConfig(appRootDir, loaderOptions);

    // Per-Block, not a single flat object like extraEnv -- two Blocks in one
    // App declaring different connectors need different env, and a Block
    // declaring none gets none.
    const perBlockEnv = {};
    for (const [blockName, blockConfig] of Object.entries(config.blocks)) {
      if (blockConfig.connectors?.length > 0) {
        perBlockEnv[blockName] = await resolveConnectorEnv(vault, appName, blockConfig.connectors);
      }
    }

    await supervisor.registerApp(appName, config, extraEnv, perBlockEnv);
    return config;
  }

  return Object.freeze({
    deployApp,
    stopApp: supervisor.stopApp,
    stopBlock: supervisor.stopBlock,
    getBlockStatus: supervisor.getBlockStatus,
    getAppStatus: supervisor.getAppStatus,
    startPolling: supervisor.startPolling,
    stopPolling: supervisor.stopPolling,
    runTick: supervisor.runTick,
    async listKnownBlocks() {
      return stateStore.listAllKnownBlocks();
    },
    async readLogs(appName, blockName, lineCount = 100) {
      return readBlockLogs(appName, blockName, lineCount, { shipHome });
    },
  });
}
