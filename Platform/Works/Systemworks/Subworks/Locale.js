// ship
// designed and built by onyxpowered.
//
// Which language the CLI talks in, and where that preference lives. Each
// language's name is written in its own script (English, not "English (en)")
// so a picker built from this list reads correctly to someone who hasn't
// chosen a language yet.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const LOCALES = Object.freeze([
  Object.freeze({ code: 'en', name: 'English' }),
  Object.freeze({ code: 'es', name: 'Español' }),
  Object.freeze({ code: 'fr', name: 'Français' }),
  Object.freeze({ code: 'it', name: 'Italiano' }),
  Object.freeze({ code: 'de', name: 'Deutsch' }),
  Object.freeze({ code: 'ja', name: '日本語' }),
  Object.freeze({ code: 'zh', name: '中文' }),
]);

export const DEFAULT_LOCALE = 'en';

export function isValidLocale(code) {
  return LOCALES.some((locale) => locale.code === code);
}

export function localeName(code) {
  return LOCALES.find((locale) => locale.code === code)?.name ?? code;
}

export function localeFilePath(shipHome) {
  return join(shipHome, 'locale.json');
}

// Not a secret -- a plain file next to the daemon's other non-sensitive
// state, not the vault. Every CLI invocation needs it (even ones that never
// touch the vault, like `ship version`), and it's nothing anyone needs
// encrypted at rest.
export async function loadLocale(shipHome) {
  try {
    const raw = await readFile(localeFilePath(shipHome), 'utf8');
    const parsed = JSON.parse(raw);
    return isValidLocale(parsed.locale) ? parsed.locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function saveLocale(shipHome, code) {
  if (!isValidLocale(code)) {
    throw new Error(`unsupported locale: ${code}`);
  }
  const path = localeFilePath(shipHome);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ locale: code }, null, 2));
  return code;
}
