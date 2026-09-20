// ship
// designed and built by onyxpowered.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export async function hashFile(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function listFilesRecursive(rootDir) {
  const results = [];
  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        results.push(relative(rootDir, fullPath).split('\\').join('/'));
      }
    }
  }
  await walk(rootDir);
  return results;
}

export async function computeArtifactIntegrity(buildOutputDir) {
  const relativePaths = await listFilesRecursive(buildOutputDir);
  const files = {};
  const manifestHash = createHash('sha256');
  for (const relativePath of relativePaths) {
    const fileHash = await hashFile(join(buildOutputDir, relativePath));
    files[relativePath] = fileHash;
    manifestHash.update(relativePath);
    manifestHash.update('\0');
    manifestHash.update(fileHash);
    manifestHash.update('\n');
  }
  return Object.freeze({
    algorithm: 'sha256',
    manifestHash: manifestHash.digest('hex'),
    fileCount: relativePaths.length,
    files: Object.freeze(files),
    computedAt: new Date().toISOString(),
  });
}

export function integrityManifestPath(buildOutputDir) {
  return `${buildOutputDir}.ship-integrity.json`;
}

export async function saveArtifactIntegrity(buildOutputDir, integrity, manifestPath = integrityManifestPath(buildOutputDir)) {
  await writeFile(manifestPath, JSON.stringify(integrity, null, 2));
  return manifestPath;
}

export async function loadArtifactIntegrity(manifestPath) {
  const raw = await readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

export async function deployArtifact(buildOutputDir, manifestPath = integrityManifestPath(buildOutputDir)) {
  const integrity = await computeArtifactIntegrity(buildOutputDir);
  await saveArtifactIntegrity(buildOutputDir, integrity, manifestPath);
  return integrity;
}

export function compareArtifactIntegrity(actual, expected) {
  if (actual.manifestHash !== expected.manifestHash) {
    const actualFiles = new Set(Object.keys(actual.files));
    const expectedFiles = new Set(Object.keys(expected.files));
    const missing = [...expectedFiles].filter((file) => !actualFiles.has(file));
    const unexpected = [...actualFiles].filter((file) => !expectedFiles.has(file));
    const changed = [...expectedFiles]
      .filter((file) => actualFiles.has(file) && expected.files[file] !== actual.files[file]);
    return Object.freeze({ valid: false, missing, unexpected, changed });
  }
  return Object.freeze({ valid: true, missing: [], unexpected: [], changed: [] });
}

export async function verifyArtifactIntegrity(buildOutputDir, manifestPath = integrityManifestPath(buildOutputDir)) {
  const expected = await loadArtifactIntegrity(manifestPath);
  const actual = await computeArtifactIntegrity(buildOutputDir);
  return { ...compareArtifactIntegrity(actual, expected), actual, expected };
}
