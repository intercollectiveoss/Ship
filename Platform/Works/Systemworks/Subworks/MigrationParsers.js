// ship
// designed and built by onyxpowered.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function readTextSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readJsonSafe(path) {
  const text = readTextSafe(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseProcfile(appRootDir) {
  const text = readTextSafe(join(appRootDir, 'Procfile'));
  if (text === null) return null;

  const blocks = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) continue;
    const name = trimmed.slice(0, separatorIndex).trim();
    const command = trimmed.slice(separatorIndex + 1).trim();
    if (!name || !command) continue;
    blocks[name] = { command, expose: name === 'web' };
  }

  return Object.keys(blocks).length > 0 ? { blocks, source: 'heroku (Procfile)' } : null;
}

export function parseVercelJson(appRootDir) {
  const config = readJsonSafe(join(appRootDir, 'vercel.json'));
  if (config === null) return null;

  const command = config.buildCommand
    ? `${config.buildCommand} && ${config.startCommand ?? 'npm start'}`
    : (config.startCommand ?? null);

  return {
    blocks: {
      web: { command: command ?? 'npm start', expose: true },
    },
    source: 'vercel (vercel.json)',
    note: command === null ? 'vercel.json had no buildCommand/startCommand — falling back to "npm start", verify this is correct' : null,
  };
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// Minimal YAML-subset parser for the common docker-compose "services:" shape --
// not a general YAML parser, deliberately scoped to what real compose files
// actually use: nested key: value blocks, simple scalar lists under a key.
export function parseDockerCompose(appRootDir) {
  const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  const fileName = candidates.find((name) => existsSync(join(appRootDir, name)));
  if (!fileName) return null;
  const text = readTextSafe(join(appRootDir, fileName));
  if (text === null) return null;

  const lines = text.split('\n').filter((line) => !line.trim().startsWith('#'));
  const servicesLineIndex = lines.findIndex((line) => line.trim() === 'services:');
  if (servicesLineIndex === -1) return null;
  const servicesIndent = indentOf(lines[servicesLineIndex]);

  const blocks = {};
  let currentService = null;
  let serviceIndent = null;
  let inCommandList = false;

  for (let i = servicesLineIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = indentOf(line);
    const trimmed = line.trim();

    if (indent <= servicesIndent) break;

    if (serviceIndent === null || indent === serviceIndent) {
      if (trimmed.endsWith(':') && !trimmed.startsWith('-')) {
        currentService = stripQuotes(trimmed.slice(0, -1));
        serviceIndent = indent;
        blocks[currentService] = { command: null, expose: false };
        inCommandList = false;
        continue;
      }
    }

    if (currentService && indent > serviceIndent) {
      if (trimmed.startsWith('command:')) {
        const value = trimmed.slice('command:'.length).trim();
        if (value) {
          blocks[currentService].command = stripQuotes(value);
          inCommandList = false;
        } else {
          inCommandList = true;
        }
        continue;
      }
      if (inCommandList && trimmed.startsWith('-')) {
        const piece = stripQuotes(trimmed.slice(1).trim());
        blocks[currentService].command = blocks[currentService].command
          ? `${blocks[currentService].command} ${piece}`
          : piece;
        continue;
      }
      if (trimmed.startsWith('ports:')) {
        inCommandList = false;
        continue;
      }
      if (trimmed.startsWith('image:') && !blocks[currentService].command) {
        blocks[currentService].command = null;
        continue;
      }
      inCommandList = inCommandList && trimmed.startsWith('-');
    }
  }

  for (const name of Object.keys(blocks)) {
    if (!blocks[name].command) {
      delete blocks[name].command;
      blocks[name].command = 'echo "no command found for this docker-compose service, edit ship.config.js"';
    }
  }
  if (blocks.web) blocks.web.expose = true;
  else {
    const firstName = Object.keys(blocks)[0];
    if (firstName) blocks[firstName].expose = true;
  }

  return Object.keys(blocks).length > 0 ? { blocks, source: `railway/docker-compose (${fileName})` } : null;
}

export function detectMigrationSource(appRootDir) {
  return parseProcfile(appRootDir) ?? parseVercelJson(appRootDir) ?? parseDockerCompose(appRootDir);
}
