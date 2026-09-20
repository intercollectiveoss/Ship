// ship
// designed and built by onyxpowered.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { blockLogPath } from '../../../Paths.js';

// A chunk boundary from a 'data' event has no relationship to a line
// boundary -- a single long line can arrive split across chunks, and
// treating each chunk as if it started a fresh line splits it into multiple
// log entries. This buffers whatever's after the last newline in each chunk
// and prepends it to the next one, so a line is only emitted once a
// newline actually terminates it.
function createLineAccumulator(onLine) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.length > 0) onLine(line);
        index = buffer.indexOf('\n');
      }
    },
    flush() {
      if (buffer.length > 0) onLine(buffer);
      buffer = '';
    },
  };
}

export function attachBlockLogCapture(child, appName, blockName, options = {}) {
  const { shipHome, now = () => new Date().toISOString(), writeFn = appendFile } = options;
  const logPath = blockLogPath(appName, blockName, shipHome);
  let ready = mkdir(dirname(logPath), { recursive: true });

  function write(stream, line) {
    const entry = { timestamp: now(), stream, line };
    ready = ready.then(() => writeFn(logPath, `${JSON.stringify(entry)}\n`)).catch(() => {});
  }

  const stdoutLines = createLineAccumulator((line) => write('stdout', line));
  const stderrLines = createLineAccumulator((line) => write('stderr', line));

  child.stdout?.on('data', (chunk) => stdoutLines.push(chunk));
  child.stderr?.on('data', (chunk) => stderrLines.push(chunk));
  // A process that dies mid-line (crash, kill) without a trailing newline
  // would otherwise leave that last partial line buffered and never written.
  child.once('exit', () => {
    stdoutLines.flush();
    stderrLines.flush();
  });

  return { logPath };
}

export async function readBlockLogs(appName, blockName, lineCount = 100, options = {}) {
  const { shipHome } = options;
  const logPath = blockLogPath(appName, blockName, shipHome);
  if (!existsSync(logPath)) {
    return [];
  }
  const raw = await readFile(logPath, 'utf8');
  const lines = raw.split('\n').filter((line) => line.length > 0);
  return lines.slice(-lineCount).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
}
