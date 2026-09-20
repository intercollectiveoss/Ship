// ship
// designed and built by onyxpowered.
//
// A real glyph-based selector: arrow keys move a highlight between options,
// enter confirms, ctrl+c cancels -- redrawn in place, no scrollback spam.
// One white glyph marks the current option and moves as you press up/down;
// every other row gets a blank in its place, not a second dimmer glyph, so
// there's only ever one cursor on screen instead of a full column of them.
//
// Arrow keys only work on a real terminal. Piped input (scripts, tests, a
// non-interactive shell) has no keys to arrow through -- it falls back to
// the same "type a number" flow the CLI always had, so nothing that worked
// non-interactively before stops working.

import { createInterface } from 'node:readline';
import { tags, printWarning, field } from './Output.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

const KEY_UP = '\x1b[A';
const KEY_DOWN = '\x1b[B';
const KEY_CTRL_C = '\x03';

export class SelectCancelled extends Error {
  constructor() {
    super('selection cancelled');
    this.name = 'SelectCancelled';
  }
}

// A single persistent readline interface reused across every prompt in one
// flow, not one created fresh per question -- two sequential prompts each
// spinning up their own interface silently drops the second answer when
// stdin is a pipe with all its input already buffered (the 'line' event
// fires before the second prompt's listener is even attached).
export function createLineSource() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  });
  const queue = [];
  const waiters = [];
  rl.on('line', (line) => {
    if (waiters.length > 0) waiters.shift()(line.trim());
    else queue.push(line.trim());
  });
  return {
    next() {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
    close() {
      rl.close();
    },
  };
}

function renderOption(label, isSelected) {
  const marker = isSelected ? tags.cursor : ' ';
  const text = isSelected ? label : `${DIM}${label}${RESET}`;
  return `  ${marker} ${text}`;
}

function selectArrowKeys({ header, options }) {
  return new Promise((resolve, reject) => {
    console.log(`${tags.system} ${header}`);
    let index = 0;
    let buffer = '';

    function draw(isFirstDraw) {
      if (!isFirstDraw) process.stdout.write(`\x1b[${options.length}A`);
      for (const [i, option] of options.entries()) {
        process.stdout.write(`\x1b[2K${renderOption(option, i === index)}\n`);
      }
    }

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw ?? false;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    process.stdout.write(HIDE_CURSOR);

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      if (!wasRaw) stdin.pause();
      process.stdout.write(SHOW_CURSOR);
    }

    function onData(chunk) {
      buffer += chunk;
      for (;;) {
        if (buffer.startsWith(KEY_UP)) {
          index = (index - 1 + options.length) % options.length;
          buffer = buffer.slice(KEY_UP.length);
          draw(false);
          continue;
        }
        if (buffer.startsWith(KEY_DOWN)) {
          index = (index + 1) % options.length;
          buffer = buffer.slice(KEY_DOWN.length);
          draw(false);
          continue;
        }
        if (buffer[0] === KEY_CTRL_C) {
          cleanup();
          reject(new SelectCancelled());
          return;
        }
        if (buffer[0] === '\r' || buffer[0] === '\n') {
          cleanup();
          resolve(index);
          return;
        }
        // A lone ESC might be the start of an arrow sequence still arriving
        // -- wait for more bytes rather than discarding it. Anything else
        // unrecognized (a stray printable key) is just dropped.
        if (buffer[0] === '\x1b' && buffer.length < 3) break;
        if (buffer.length === 0) break;
        buffer = buffer.slice(1);
      }
    }

    stdin.on('data', onData);
    draw(true);
  });
}

async function selectNumbered({ header, options, lineSource, enterNumberLabel, invalidMessage, retryOnInvalid }) {
  console.log(`${tags.system} ${header}`);
  options.forEach((label, i) => console.log(`  ${i + 1}) ${label}`));
  const source = lineSource ?? createLineSource();
  try {
    for (;;) {
      process.stdout.write(field(enterNumberLabel));
      const raw = await source.next();
      const index = Number(raw) - 1;
      if (Number.isInteger(index) && index >= 0 && index < options.length) {
        return index;
      }
      if (!retryOnInvalid) {
        throw new SelectCancelled();
      }
      printWarning(invalidMessage);
    }
  } finally {
    if (!lineSource) source.close();
  }
}

// Resolves to the chosen option's index. Rejects with SelectCancelled on
// ctrl+c (arrow-key mode) or, when retryOnInvalid is false, on any
// unrecognized answer (numbered fallback) -- callers that want "decline
// gracefully" rather than "re-ask" pass retryOnInvalid: false.
export async function selectOption({
  header,
  options,
  lineSource,
  enterNumberLabel,
  invalidMessage,
  retryOnInvalid = true,
}) {
  if (process.stdin.isTTY) {
    return selectArrowKeys({ header, options });
  }
  return selectNumbered({ header, options, lineSource, enterNumberLabel, invalidMessage, retryOnInvalid });
}
