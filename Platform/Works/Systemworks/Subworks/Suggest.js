// ship
// designed and built by onyxpowered.
//
// A one- or two-character typo shouldn't force retyping the whole command.
// This finds the known command(s) closest to what was actually typed (plain
// Levenshtein edit distance, capped at 2) and offers to run one of them,
// picked with the same arrow-key selector as everything else -- declining
// (ctrl+c, or an unrecognized answer on the piped-input fallback) just
// means the command wasn't run, not an error.

import { t } from './Strings.js';
import { printError, printSystem } from './Output.js';
import { selectOption, SelectCancelled } from './Select.js';

const MAX_DISTANCE = 2;
const MAX_SUGGESTIONS = 5;

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}

// Two-word commands ("daemon install") only get compared against a
// two-word attempt, one-word commands only against a one-word attempt --
// comparing "delpoy" against "daemon install" would just be noise, not a
// plausible typo either direction.
export function findCloseCommands(argv, knownCommands) {
  const oneWordAttempt = (argv[0] ?? '').toLowerCase();
  const twoWordAttempt = argv.slice(0, 2).join(' ').toLowerCase();
  if (!oneWordAttempt) return [];

  const scored = [];
  for (const key of knownCommands) {
    const wordCount = key.includes(' ') ? 2 : 1;
    const attempt = wordCount === 2 ? twoWordAttempt : oneWordAttempt;
    const distance = levenshtein(attempt, key);
    if (distance > 0 && distance <= MAX_DISTANCE) {
      scored.push({ key, wordCount, distance });
    }
  }
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, MAX_SUGGESTIONS);
}

// Returns a corrected argv (the suggestion's own words, plus whatever
// trailing args followed the original attempt) if the person confirms one,
// or null if nothing was close enough, or they declined.
export async function suggestCommand(argv, locale, knownCommands) {
  const attempted = argv.join(' ').trim();
  const candidates = findCloseCommands(argv, knownCommands);
  if (candidates.length === 0) return null;

  printError(t(locale, 'suggest.notRecognized', { cmd: attempted }));

  try {
    const index = await selectOption({
      header: t(locale, 'suggest.maybeMeant'),
      options: candidates.map((candidate) => `ship ${candidate.key}`),
      enterNumberLabel: t(locale, 'startup.enterNumber'),
      invalidMessage: t(locale, 'startup.invalidChoice'),
      retryOnInvalid: false,
    });
    const chosen = candidates[index];
    return [...chosen.key.split(' '), ...argv.slice(chosen.wordCount)];
  } catch (error) {
    if (error instanceof SelectCancelled) {
      printSystem(t(locale, 'cancelled'));
      return null;
    }
    throw error;
  }
}
