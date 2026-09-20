// ship
// designed and built by onyxpowered.

import { createWorkerHost } from './Subworks/Worker/WorkerHost.js';
import { VERSION } from './Subworks/Version.js';

export { VERSION };

export function createMetalworks(options = {}) {
  const host = createWorkerHost(options);
  let latestTick = null;

  host.onTick((tick) => {
    latestTick = tick;
  });

  function getLatestTick() {
    return latestTick;
  }

  async function stop() {
    await host.stop();
  }

  return {
    whenReady: host.whenReady,
    onTick: host.onTick,
    onError: host.onError,
    onCapabilityProbe: host.onCapabilityProbe,
    onCritical: host.onCritical,
    track: host.track,
    untrack: host.untrack,
    markPerProcessChannelRestricted: host.markPerProcessChannelRestricted,
    getLatestTick,
    stop,
  };
}
