// ship
// designed and built by onyxpowered.

import { createInterface } from 'node:readline/promises';

const CTRL_C = '';
const BACKSPACE = '';

export function describeConfigField(descriptor) {
  if (typeof descriptor === 'string') {
    return { description: descriptor, secret: false, default: undefined };
  }
  if (descriptor != null && typeof descriptor === 'object') {
    return {
      description: typeof descriptor.description === 'string' ? descriptor.description : '',
      secret: descriptor.secret === true,
      default: descriptor.default,
    };
  }
  return { description: '', secret: false, default: undefined };
}

export async function defaultAsk(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function defaultAskSecret(question) {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (typeof stdin.setRawMode !== 'function' || !stdin.isTTY) {
    return defaultAsk(question);
  }
  return new Promise((promiseResolve, promiseReject) => {
    stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    }

    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\n' || ch === '\r') {
          stdout.write('\n');
          cleanup();
          promiseResolve(value);
          return;
        }
        if (ch === CTRL_C) {
          cleanup();
          promiseReject(new Error('prompt cancelled'));
          return;
        }
        if (ch === BACKSPACE || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    }

    stdin.on('data', onData);
  });
}

export async function promptForConnectorConfig({ connector, keys, ask = defaultAsk, askSecret = defaultAskSecret }) {
  if (!Array.isArray(keys)) {
    throw new Error('promptForConnectorConfig requires an array of keys');
  }
  const values = {};
  for (const key of keys) {
    const field = describeConfigField(connector?.configSchema?.[key]);
    const asker = field.secret ? askSecret : ask;
    const label = field.description ? `${key} (${field.description})` : key;
    const suffix = field.default !== undefined ? ` [${field.default}]` : '';
    const answer = await asker(`${label}${suffix}: `);
    const trimmed = typeof answer === 'string' ? answer.trim() : answer;
    values[key] = trimmed === '' && field.default !== undefined ? field.default : trimmed;
  }
  return values;
}
