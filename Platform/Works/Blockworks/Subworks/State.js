// ship
// designed and built by onyxpowered.

import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const STATE_DIR_MODE = 0o700;
const STATE_FILE_MODE = 0o600;
const NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

function sanitizeName(kind, name) {
  if (typeof name !== 'string' || name.length === 0 || name === '.' || name === '..' || !NAME_PATTERN.test(name)) {
    throw new Error(`invalid ${kind} name: ${JSON.stringify(name)}`);
  }
  return name;
}

async function writeJsonAtomic(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true, mode: STATE_DIR_MODE });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, JSON.stringify(data), { mode: STATE_FILE_MODE });
  await rename(tmpPath, filePath);
}

export async function createBlockStateStore(rootDir) {
  await mkdir(rootDir, { recursive: true, mode: STATE_DIR_MODE });

  function appDir(appName) {
    return join(rootDir, sanitizeName('App', appName));
  }

  function blockFile(appName, blockName) {
    return join(appDir(appName), `${sanitizeName('Block', blockName)}.json`);
  }

  const store = {
    async writeBlockState(appName, blockName, record) {
      await writeJsonAtomic(blockFile(appName, blockName), record);
    },

    async readBlockState(appName, blockName) {
      const filePath = blockFile(appName, blockName);
      if (!existsSync(filePath)) return undefined;
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw);
    },

    async readAppState(appName) {
      const dir = appDir(appName);
      if (!existsSync(dir)) return {};
      const entries = await readdir(dir, { withFileTypes: true });
      const result = {};
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const blockName = entry.name.slice(0, -5);
        const raw = await readFile(join(dir, entry.name), 'utf8');
        result[blockName] = JSON.parse(raw);
      }
      return result;
    },

    async listApps() {
      if (!existsSync(rootDir)) return [];
      const entries = await readdir(rootDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    },

    async removeBlock(appName, blockName) {
      await rm(blockFile(appName, blockName), { force: true });
    },

    async removeApp(appName) {
      await rm(appDir(appName), { recursive: true, force: true });
    },

    async listAllKnownBlocks() {
      const apps = await store.listApps();
      const known = [];
      for (const appName of apps) {
        const blocks = await store.readAppState(appName);
        for (const [blockName, record] of Object.entries(blocks)) {
          known.push({ appName, blockName, ...record });
        }
      }
      return known;
    },
  };

  return Object.freeze(store);
}
