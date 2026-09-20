// ship
// designed and built by onyxpowered.

import { validateshipConfig, resolveEntryBlock } from '../../Blockworks/Subworks/ConfigSchema.js';

export const MODES = Object.freeze({
  POST: 'post',
  PRODUCTION: 'production',
});

export const MODE_NAMES = Object.freeze(Object.values(MODES));

export function isValidMode(mode) {
  return MODE_NAMES.includes(mode);
}

export function slugifyAppName(appName) {
  return appName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function resolveInterworksTarget(appName, config, mode) {
  if (!isValidMode(mode)) {
    throw new Error(`unknown Interworks mode: ${mode}`);
  }
  validateshipConfig(config);

  const entryBlockNames = resolveEntryBlock(config);
  if (entryBlockNames.length === 0) {
    throw new Error('ship.config.js declares no exposed Block and has more than one Block -- set "expose: true" on the Block Interworks should route to');
  }
  if (entryBlockNames.length > 1) {
    throw new Error(`ship.config.js exposes more than one Block (${entryBlockNames.join(', ')}) -- Interworks routes to exactly one entry Block per App`);
  }

  const [entryBlockName] = entryBlockNames;
  const entryBlock = config.blocks[entryBlockName];

  return Object.freeze({
    mode,
    appName,
    appSlug: slugifyAppName(appName),
    entryBlockName,
    entryBlock: Object.freeze({ ...entryBlock }),
  });
}
