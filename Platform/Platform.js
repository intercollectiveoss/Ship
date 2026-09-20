// ship
// designed and built by onyxpowered.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WORKS } from './Works/Works.js';
import { createVault } from './Vault/Vault.js';
import { REQUIRED_VERSIONS } from './Works/Systemworks/Subworks/RequiredVersions.js';
import * as Systemworks from './Works/Systemworks/Systemworks.js';
import { isSocketListening } from './Works/Systemworks/Subworks/IPC.js';
import { resolveshipHome, socketPath as resolveSocketPath } from './Paths.js';

const WORKS_MODULE_URL = new URL('./Works/Works.js', import.meta.url);

function resolveWorkUrl(work) {
  return new URL(work.modulePath, WORKS_MODULE_URL);
}

function confirmWorksPresent(works) {
  for (const work of works) {
    const filePath = fileURLToPath(resolveWorkUrl(work));
    if (!existsSync(filePath)) {
      throw new Error(`${work.name} is missing on disk (expected at ${filePath})`);
    }
  }
}

async function versionCheckWorks(works, requiredVersions) {
  for (const work of works) {
    if (work.name === 'Systemworks') continue;
    const required = requiredVersions[work.name];
    if (required === undefined) continue;
    const module = await import(resolveWorkUrl(work));
    const found = module.VERSION;
    if (found !== required) {
      throw new Error(`${work.name} ${required} expected, found ${found === undefined ? 'none' : found}`);
    }
  }
}

// Checked before any of the heavier boot work (vault, Works composition,
// health-check timers) so a second `ship daemon start` fails fast and exits
// cleanly, instead of standing up a whole daemon's worth of state only to
// have IPC.js refuse the socket at the very end -- that left a process
// alive with nothing left to stop it, since its timers were the only thing
// still running and nothing had a handle on them to tear back down.
async function refuseIfDaemonAlreadyRunning(shipHome) {
  const socket = resolveSocketPath(shipHome);
  if (await isSocketListening(socket)) {
    throw new Error(`a ship daemon is already listening on ${socket} -- stop it first with \`ship daemon stop\``);
  }
}

export async function boot(options = {}) {
  const works = options.works ?? WORKS;

  confirmWorksPresent(works);

  await refuseIfDaemonAlreadyRunning(options.shipHome ?? resolveshipHome());

  const vault = await createVault({
    shipHome: options.shipHome,
    vaultDir: options.vaultDir,
  });

  await versionCheckWorks(works, options.requiredVersions ?? REQUIRED_VERSIONS);

  const readyReport = await Systemworks.receivePlatformReady({ vault, works, options });

  return { vault, works, readyReport };
}
