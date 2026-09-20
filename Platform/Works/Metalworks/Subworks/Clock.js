// ship
// designed and built by onyxpowered.

export function monotonicNowNs() {
  return process.hrtime.bigint();
}

export function elapsedMsBetween(startNs, endNs) {
  if (typeof startNs !== 'bigint' || typeof endNs !== 'bigint') {
    return null;
  }
  const deltaNs = endNs - startNs;
  if (deltaNs <= 0n) {
    return null;
  }
  return Number(deltaNs) / 1_000_000;
}

export function nsToMs(ns) {
  if (typeof ns !== 'bigint') return null;
  return Number(ns) / 1_000_000;
}
