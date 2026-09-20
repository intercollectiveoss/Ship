// ship
// designed and built by onyxpowered.

export function fingerprintsMatch(previousFingerprint, currentFingerprint) {
  if (previousFingerprint === null || previousFingerprint === undefined) return true;
  if (currentFingerprint === null || currentFingerprint === undefined) return false;
  return previousFingerprint === currentFingerprint;
}

export function normalizeFingerprint(rawValue) {
  if (rawValue === null || rawValue === undefined) return null;
  if (typeof rawValue === 'bigint') return rawValue.toString();
  if (typeof rawValue === 'number') return String(rawValue);
  if (typeof rawValue === 'string') return rawValue.trim();
  return String(rawValue);
}
