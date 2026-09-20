// ship
// designed and built by onyxpowered.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function hasAnyDependency(pkg, names) {
  if (!pkg) return false;
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return names.some((name) => Object.prototype.hasOwnProperty.call(all, name));
}

function firstHtmlFile(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  return entries.find((entry) => entry.toLowerCase().endsWith('.html')) ?? null;
}

// Every signature below whose command runs anything through npm/npx assumes
// node_modules already exists -- true for `ship new` (nothing to install)
// but never true for a freshly `ship import`ed repo, which arrives as
// source only. Nothing else in ship's import/deploy path ever runs an
// install step, so without this every imported node-based project's first
// deploy fails immediately at "next: command not found" (or vite/astro/the
// app's own entry module, same failure either way).
const NPM_INSTALL = 'npm install';

const SIGNATURES = [
  {
    name: 'next',
    detect: (dir, pkg) => hasAnyDependency(pkg, ['next']),
    command: (pkg) =>
      `${NPM_INSTALL} && ${pkg.scripts?.start ? 'npm run build && npm start' : 'npx next build && npx next start'}`,
    port: 3000,
  },
  {
    name: 'astro',
    detect: (dir, pkg) => hasAnyDependency(pkg, ['astro']),
    command: () => `${NPM_INSTALL} && npx astro build && npx astro preview --host`,
    port: 4321,
  },
  {
    name: 'vite',
    detect: (dir, pkg) => hasAnyDependency(pkg, ['vite']),
    command: () => `${NPM_INSTALL} && npx vite build && npx vite preview --host`,
    port: 4173,
  },
  {
    name: 'express',
    detect: (dir, pkg) => hasAnyDependency(pkg, ['express', 'fastify', 'koa', 'hapi']),
    command: (pkg) => `${NPM_INSTALL} && ${pkg.scripts?.start ? 'npm start' : `node ${pkg.main ?? 'index.js'}`}`,
    port: null,
  },
  {
    name: 'node-generic',
    detect: (dir, pkg) => pkg !== null,
    command: (pkg) => `${NPM_INSTALL} && ${pkg.scripts?.start ? 'npm start' : `node ${pkg.main ?? 'index.js'}`}`,
    port: null,
  },
  {
    name: 'flask',
    detect: (dir) => existsSync(join(dir, 'requirements.txt')) && existsSync(join(dir, 'app.py')),
    command: () => 'python3 app.py',
    port: 5000,
  },
  {
    name: 'python-generic',
    detect: (dir) => existsSync(join(dir, 'requirements.txt')) && existsSync(join(dir, 'main.py')),
    command: () => 'python3 main.py',
    port: null,
  },
  {
    name: 'static',
    detect: (dir) => existsSync(join(dir, 'index.html')),
    command: () => 'npx --yes serve -l 8080 .',
    port: 8080,
  },
  {
    // A plain HTML file that isn't named index.html -- e.g. someone hands
    // over a single page.html with no build step at all. `serve` only
    // auto-loads index.html at the root path, so copy whichever .html file
    // is there to index.html first (in the deployed copy, not the source)
    // rather than asking every such file to be pre-renamed by hand.
    name: 'plain-html',
    detect: (dir) => !existsSync(join(dir, 'index.html')) && firstHtmlFile(dir) !== null,
    command: (pkg, dir) => `cp "${firstHtmlFile(dir)}" index.html && npx --yes serve -l 8080 .`,
    port: 8080,
  },
];

export function detectFramework(appRootDir) {
  const pkg = readJsonSafe(join(appRootDir, 'package.json'));
  for (const signature of SIGNATURES) {
    if (signature.detect(appRootDir, pkg)) {
      return Object.freeze({
        name: signature.name,
        command: signature.command(pkg ?? {}, appRootDir),
        port: signature.port,
      });
    }
  }
  return null;
}

export function listSignatureNames() {
  return SIGNATURES.map((signature) => signature.name);
}
