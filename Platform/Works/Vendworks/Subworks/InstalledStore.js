// ship
// designed and built by onyxpowered.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export async function readInstalledMetadata(metadataPath) {
  if (!existsSync(metadataPath)) {
    return undefined;
  }
  const raw = await readFile(metadataPath, 'utf8');
  return JSON.parse(raw);
}

export async function writeInstalledMetadata(metadataPath, metadata) {
  await mkdir(dirname(metadataPath), { recursive: true });
  const tmpPath = `${metadataPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(metadata, null, 2));
  await rename(tmpPath, metadataPath);
}
