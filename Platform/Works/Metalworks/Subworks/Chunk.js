// ship
// designed and built by onyxpowered.

export const DEFAULT_CHUNK_SIZE = 12;

export function chunkList(items, chunkSize = DEFAULT_CHUNK_SIZE) {
  if (!Array.isArray(items)) {
    throw new TypeError('chunkList requires an array');
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError('chunkList requires a positive integer chunkSize');
  }
  const chunks = [];
  for (let offset = 0; offset < items.length; offset += chunkSize) {
    chunks.push(items.slice(offset, offset + chunkSize));
  }
  return chunks;
}
