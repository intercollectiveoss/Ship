// ship
// designed and built by onyxpowered.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function validateBlockHandle(handle) {
  if (handle == null || typeof handle !== 'object') {
    throw new Error('a Block handle must be an object');
  }
  if (typeof handle.name !== 'string' || handle.name.length === 0) {
    throw new Error('a Block handle must declare a non-empty "name"');
  }
  if (typeof handle.host !== 'string' || handle.host.length === 0) {
    throw new Error(`Block "${handle.name}" handle must declare a non-empty "host"`);
  }
  if (!Number.isInteger(handle.port) || handle.port <= 0 || handle.port > 65535) {
    throw new Error(`Block "${handle.name}" handle must declare a valid "port"`);
  }
  if (typeof handle.isReady !== 'function') {
    throw new Error(`Block "${handle.name}" handle must declare an "isReady" function`);
  }
  return true;
}

export async function waitUntilReady(handle, { timeoutMs = 30000, intervalMs = 100 } = {}) {
  validateBlockHandle(handle);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await handle.isReady()) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
}

export function createStaticBlockHandle({ name = 'block', host = '127.0.0.1', port, ready = true } = {}) {
  const handle = Object.freeze({
    name,
    host,
    port,
    isReady: async () => (typeof ready === 'function' ? ready() : ready),
  });
  validateBlockHandle(handle);
  return handle;
}

export function blockOrigin(handle) {
  validateBlockHandle(handle);
  return `http://${handle.host}:${handle.port}`;
}
