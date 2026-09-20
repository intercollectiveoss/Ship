// ship
// designed and built by onyxpowered.

import { createLinuxSampler } from './LinuxSampler.js';
import { createMacSampler } from './MacSampler.js';
import { createWindowsSampler } from './WindowsSampler.js';

export const SUPPORTED_PLATFORMS = Object.freeze(['linux', 'darwin', 'win32']);

export function selectSampler(platformName = process.platform, options = {}) {
  if (platformName === 'linux') return createLinuxSampler(options.linux);
  if (platformName === 'darwin') return createMacSampler(options.mac);
  if (platformName === 'win32') return createWindowsSampler(options.windows);
  throw new Error(`unsupported platform for Metalworks sampling: ${platformName}`);
}
