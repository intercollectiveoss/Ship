// ship
// designed and built by onyxpowered.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync } from 'node:fs';
import { mkdir, cp, writeFile, rm, readdir, rename } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { detectFramework } from './FrameworkDetection.js';
import { detectMigrationSource } from './MigrationParsers.js';

const execFileAsync = promisify(execFile);

const GIT_HOST_SHORTHANDS = {
  gh: 'https://github.com/',
  gl: 'https://gitlab.com/',
  bb: 'https://bitbucket.org/',
};

export function isGitSource(source) {
  if (/^[a-z]+:[^/]/.test(source) && GIT_HOST_SHORTHANDS[source.split(':')[0]]) return true;
  if (/^(https?:\/\/|git@|ssh:\/\/).+\.git$/.test(source)) return true;
  if (/^(https?:\/\/)(github|gitlab|bitbucket)\.[a-z.]+\//.test(source)) return true;
  return false;
}

export function resolveGitUrl(source) {
  const shorthandMatch = /^([a-z]+):(.+)$/.exec(source);
  if (shorthandMatch && GIT_HOST_SHORTHANDS[shorthandMatch[1]]) {
    const repoPath = shorthandMatch[2];
    return `${GIT_HOST_SHORTHANDS[shorthandMatch[1]]}${repoPath}.git`;
  }
  return source;
}

export function isArchiveSource(source) {
  const ext = extname(source).toLowerCase();
  return ext === '.zip' || ext === '.gz' || ext === '.tgz' || source.toLowerCase().endsWith('.tar.gz');
}

async function extractArchive(archivePath, destinationDir) {
  await mkdir(destinationDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    await execFileAsync('unzip', ['-q', archivePath, '-d', destinationDir]);
  } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', destinationDir]);
  } else {
    throw new Error(`unsupported archive format: ${archivePath}`);
  }

  return destinationDir;
}

async function flattenSingleTopLevelDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    const inner = join(dir, entries[0].name);
    const tmp = `${dir}.flatten-tmp`;
    await rename(inner, tmp);
    await rm(dir, { recursive: true, force: true });
    await rename(tmp, dir);
  }
}

async function cloneGitRepo(url, destinationDir) {
  await mkdir(destinationDir, { recursive: true });
  await execFileAsync('git', ['clone', '--depth', '1', url, destinationDir]);
}

function slugFromSource(source) {
  const cleaned = source.replace(/\.git$/, '').replace(/[?#].*$/, '');
  const last = cleaned.split(/[/\\:]/).filter(Boolean).pop() ?? 'app';
  return last.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function writeGeneratedConfig(appRootDir, blocksSource) {
  const body = `export default {\n  blocks: ${JSON.stringify(blocksSource, null, 2).split('\n').join('\n  ')},\n};\n`;
  return writeFile(join(appRootDir, 'ship.config.js'), body);
}

export async function importSource(source, options = {}) {
  const { appsDir, subPath, from, appName: explicitName } = options;
  if (!source && !from) {
    throw new Error('ship import requires a source (git URL, local path, or archive)');
  }

  // slugFromSource always produces a plain [a-z0-9-]+ segment, but an
  // explicit --name is used as-is -- without this check it goes straight
  // into join(appsDir, slug) below, and a name containing ".." or a path
  // separator can land the import outside appsDir entirely.
  if (explicitName !== undefined && (/[\\/]/.test(explicitName) || explicitName === '.' || explicitName === '..')) {
    throw new Error(`invalid --name "${explicitName}" -- app names cannot contain path separators`);
  }
  const slug = explicitName ?? slugFromSource(source ?? 'app');
  const workingDir = join(appsDir, slug);

  let appRootDir;

  if (source && existsSync(source) && statSync(source).isDirectory()) {
    await rm(workingDir, { recursive: true, force: true });
    await mkdir(workingDir, { recursive: true });
    await cp(source, workingDir, { recursive: true });
    appRootDir = workingDir;
  } else if (source && isArchiveSource(source)) {
    if (!existsSync(source)) {
      throw new Error(`archive not found: ${source}`);
    }
    await rm(workingDir, { recursive: true, force: true });
    await extractArchive(source, workingDir);
    await flattenSingleTopLevelDir(workingDir);
    appRootDir = workingDir;
  } else if (source && isGitSource(source)) {
    await rm(workingDir, { recursive: true, force: true });
    await cloneGitRepo(resolveGitUrl(source), workingDir);
    appRootDir = workingDir;
  } else if (source) {
    throw new Error(`could not determine how to import "${source}" (not a local path, archive, or recognized git URL)`);
  } else {
    throw new Error('ship import --from requires a source repo to migrate from');
  }

  if (subPath) {
    appRootDir = join(appRootDir, subPath);
    if (!existsSync(appRootDir)) {
      throw new Error(`--path=${subPath} does not exist inside the imported source`);
    }
  }

  const configPath = join(appRootDir, 'ship.config.js');
  let blocksInfo;

  if (!existsSync(configPath)) {
    const migration = from ? detectMigrationSource(appRootDir) : null;
    if (migration) {
      blocksInfo = {
        blocks: migration.blocks,
        detected: migration.source,
        note: 'migrated config has no known listen port -- add healthCheck: { port: N } to the web Block in ship.config.js (matching the port your app actually listens on) before deploying in Post mode',
      };
    } else {
      const detected = detectFramework(appRootDir);
      if (!detected) {
        throw new Error(`could not detect a framework for ${appRootDir} — no package.json, requirements.txt, or index.html found. add a ship.config.js manually.`);
      }
      const webBlock = { command: detected.command, expose: true };
      if (detected.port) {
        webBlock.healthCheck = { port: detected.port };
      }
      blocksInfo = {
        blocks: { web: webBlock },
        detected: `auto-detected: ${detected.name}`,
        note: detected.port
          ? null
          : `${detected.name} apps can listen on any port -- add healthCheck: { port: N } to the web Block in ship.config.js (matching the port your app actually listens on) before deploying in Post mode`,
      };
    }
    await writeGeneratedConfig(appRootDir, blocksInfo.blocks);
  } else {
    blocksInfo = { blocks: null, detected: 'existing ship.config.js used as-is' };
  }

  return Object.freeze({
    appName: slug,
    appRootDir,
    configGenerated: !existsSync(configPath) ? false : blocksInfo.blocks !== null,
    detected: blocksInfo.detected,
    ...(blocksInfo.note ? { note: blocksInfo.note } : {}),
  });
}
