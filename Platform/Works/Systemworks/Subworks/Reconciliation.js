// ship
// designed and built by onyxpowered.

export function defaultListKnownBlocks() {
  return [];
}

export function defaultFingerprintCheck() {
  throw new Error(
    'fingerprintCheck is owned by Metalworks (PID + start-time fingerprint matching, Plan.txt section 7) and has not been wired up yet',
  );
}

export async function reconcileBlocks(options = {}) {
  const listKnownBlocks = options.listKnownBlocks ?? defaultListKnownBlocks;
  const fingerprintCheck = options.fingerprintCheck ?? defaultFingerprintCheck;
  const logger = options.logger;

  const knownBlocks = await listKnownBlocks();
  if (knownBlocks.length === 0) {
    if (logger) await logger.info('reconciliation: no previously-known Blocks to reattach');
    return { reattached: [], stale: [] };
  }

  const reattached = [];
  const stale = [];
  for (const block of knownBlocks) {
    let alive = false;
    try {
      alive = await fingerprintCheck(block);
    } catch (error) {
      if (logger) {
        await logger.warn('reconciliation: fingerprintCheck failed for a Block, treating it as stale', {
          block,
          error: error.message,
        });
      }
      alive = false;
    }
    if (alive) {
      reattached.push(block);
    } else {
      stale.push(block);
    }
  }

  if (logger) {
    await logger.info('reconciliation complete', {
      reattachedCount: reattached.length,
      staleCount: stale.length,
    });
  }
  return { reattached, stale };
}
