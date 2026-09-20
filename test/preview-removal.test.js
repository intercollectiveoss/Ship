import test from 'node:test';
import assert from 'node:assert/strict';

import { MODES, MODE_NAMES } from '../Platform/Works/Interworks/Subworks/Mode.js';
import { knownCommands } from '../Platform/Works/Systemworks/Subworks/CLI.js';

test('preview mode is removed from the public mode registry', () => {
  assert.equal(MODES.PREVIEW, undefined);
  assert.equal(MODE_NAMES.includes('preview'), false);
});

test('preview deploy commands are removed from the CLI surface', () => {
  const commands = knownCommands();
  assert.equal(commands.includes('preview'), false);
  assert.equal(commands.includes('deploy preview'), false);
});
