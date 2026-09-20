// ship
// designed and built by onyxpowered.
//
// --df ("dev flags"): append it to any command to reset the local state
// that command depends on back to a fresh-install condition first, so a
// flow like `ship startup` can be re-tested over and over without manually
// deleting files by hand in between runs. Works anywhere in the argument
// list, not just at the end, and is stripped before normal command parsing
// ever sees it -- it's never mistaken for a positional argument or an
// unrecognized flag.

import { rm } from 'node:fs/promises';
import { localeFilePath, DEFAULT_LOCALE } from './Locale.js';
import { t } from './Strings.js';
import { printSystem } from './Output.js';

export const DEV_FLAG_TOKEN = '--df';

export function stripDevFlag(argv) {
  const index = argv.indexOf(DEV_FLAG_TOKEN);
  if (index === -1) return { argv, devFlags: false };
  return { argv: [...argv.slice(0, index), ...argv.slice(index + 1)], devFlags: true };
}

// Only the language preference is reset today -- the one piece of local
// state introduced so far that a command (`ship startup`) actually
// configures. Extend this the same way as more commands grow their own
// persisted, worth-testing-fresh state.
export async function resetDevState(shipHome, locale) {
  await rm(localeFilePath(shipHome), { force: true });
  printSystem(t(locale, 'devFlags.reset'));
  return DEFAULT_LOCALE;
}
