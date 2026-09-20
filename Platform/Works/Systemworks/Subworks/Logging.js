// ship
// designed and built by onyxpowered.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { printSystem, printWarning, printError } from './Output.js';

const VERBOSE_PRINTERS = { info: printSystem, warn: printWarning, error: printError };

// The daemon's log file is the only durable record, but in --dev mode a
// developer wants Block lifecycle transitions, IPC traffic, and health-check
// timing visible live in the terminal, not just discoverable after the fact
// with `sdk logs`. This tees every entry to stdout, styled like the rest of
// the CLI, without changing what gets written to disk.
function echoVerbose(level, message, meta) {
  const printer = VERBOSE_PRINTERS[level] ?? printSystem;
  const metaKeys = Object.keys(meta);
  const suffix = metaKeys.length > 0 ? ` ${JSON.stringify(meta)}` : '';
  printer(`${message}${suffix}`);
}

export function createDaemonLogger(logFilePath, { verbose = false } = {}) {
  const logger = {
    async log(level, message, meta = {}) {
      await mkdir(dirname(logFilePath), { recursive: true });
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...meta,
      };
      await appendFile(logFilePath, `${JSON.stringify(entry)}\n`);
      if (verbose) echoVerbose(level, message, meta);
    },
    async info(message, meta) {
      return logger.log('info', message, meta);
    },
    async warn(message, meta) {
      return logger.log('warn', message, meta);
    },
    async error(message, meta) {
      return logger.log('error', message, meta);
    },
  };
  return logger;
}

export async function tailLog(logFilePath, lineCount = 100) {
  if (!existsSync(logFilePath)) {
    return [];
  }
  const raw = await readFile(logFilePath, 'utf8');
  const lines = raw.split('\n').filter((line) => line.length > 0);
  return lines.slice(-lineCount).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
}
