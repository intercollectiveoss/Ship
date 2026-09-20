// ship
// designed and built by onyxpowered.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { validateshipConfig } from './ConfigSchema.js';

const CONFIG_FILE_NAME = 'ship.config.js';
const DEFAULT_PRIORITY = 'normal';
// Every auto-detected node-based framework's command now starts with
// `npm install &&` (see FrameworkDetection.js) since a freshly imported repo
// never already has node_modules -- so on a first deploy this default isn't
// just covering process startup, it's covering a full install and build
// too. 30s reliably wasn't enough for that and made a fresh Next.js/Astro/
// Vite/Express import fail its very first health check. A longer ceiling
// costs nothing for a Block that's actually ready sooner -- the health
// check still returns as soon as the port answers, it just no longer gives
// up on a slow one.
const DEFAULT_READY_TIMEOUT_MS = 180000;

export function configFilePath(appRootDir) {
  return join(appRootDir, CONFIG_FILE_NAME);
}

function defaultImport(href) {
  return import(href);
}

let importCallCounter = 0;

export async function loadRawConfig(appRootDir, { importFn = defaultImport } = {}) {
  const filePath = configFilePath(appRootDir);
  let module;
  try {
    // Node's ESM loader caches a module by its exact resolved URL for the life
    // of the process -- a plain import() of the same ship.config.js path on a
    // later deploy would silently return whatever was loaded the FIRST time,
    // ignoring any edits made on disk since. A cache-busting query string
    // forces a fresh read every call; the file's own content is what actually
    // matters here, its URL is otherwise an implementation detail. A monotonic
    // counter (not Date.now()) guarantees a distinct value even for two calls
    // landing in the same millisecond.
    const href = `${pathToFileURL(filePath).href}?t=${++importCallCounter}`;
    module = await importFn(href);
  } catch (error) {
    throw new Error(`failed to load ${filePath}: ${error.message}`);
  }
  if (module.default == null || typeof module.default !== 'object') {
    throw new Error(`${filePath} must have a default export (export default { blocks: { ... } })`);
  }
  return module.default;
}

export function normalizeshipConfig(config) {
  const appPriority = config.priority ?? DEFAULT_PRIORITY;
  const blocks = {};
  for (const [name, block] of Object.entries(config.blocks)) {
    blocks[name] = Object.freeze({
      name,
      command: block.command,
      priority: block.priority ?? appPriority,
      dependsOn: Object.freeze([...(block.dependsOn ?? [])]),
      expose: block.expose ?? false,
      allowance: Object.freeze({ ...(block.allowance ?? {}) }),
      healthCheck: block.healthCheck ? Object.freeze({ ...block.healthCheck }) : null,
      readyTimeoutMs: block.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      connectors: Object.freeze([...(block.connectors ?? [])]),
    });
  }
  return Object.freeze({
    priority: appPriority,
    blocks: Object.freeze(blocks),
  });
}

export async function loadshipConfig(appRootDir, options = {}) {
  const raw = await loadRawConfig(appRootDir, options);
  validateshipConfig(raw);
  const normalized = normalizeshipConfig(raw);
  return Object.freeze({ ...normalized, appRootDir });
}
