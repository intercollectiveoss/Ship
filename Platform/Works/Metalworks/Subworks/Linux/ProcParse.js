// ship
// designed and built by onyxpowered.

export const LINUX_CLOCK_TICKS_PER_SECOND = 100;

export function parseStat(content) {
  const openParenIndex = content.indexOf(' (');
  const closeParenIndex = content.lastIndexOf(')');
  if (openParenIndex === -1 || closeParenIndex === -1 || closeParenIndex < openParenIndex) {
    throw new Error('malformed /proc/[pid]/stat content');
  }

  const pid = Number(content.slice(0, openParenIndex));
  const comm = content.slice(openParenIndex + 2, closeParenIndex);
  const rest = content
    .slice(closeParenIndex + 2)
    .trim()
    .split(/\s+/);

  const state = rest[0];
  const ppid = Number(rest[1]);
  const utimeTicks = Number(rest[11]);
  const stimeTicks = Number(rest[12]);
  const starttimeTicks = Number(rest[19]);

  return {
    pid,
    comm,
    state,
    ppid,
    cpuTimeMs: ((utimeTicks + stimeTicks) * 1000) / LINUX_CLOCK_TICKS_PER_SECOND,
    starttimeTicks,
  };
}

export function parseStatusRssBytes(content) {
  const match = content.match(/^VmRSS:\s+(\d+)\s*kB/m);
  if (!match) return null;
  return Number(match[1]) * 1024;
}

export function parseMemInfo(content) {
  const values = new Map();
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB/);
    if (match) {
      values.set(match[1], Number(match[2]) * 1024);
    }
  }

  const totalBytes = values.get('MemTotal') ?? 0;
  let freeBytes;
  if (values.has('MemAvailable')) {
    freeBytes = values.get('MemAvailable');
  } else {
    freeBytes = (values.get('MemFree') ?? 0) + (values.get('Buffers') ?? 0) + (values.get('Cached') ?? 0);
  }
  const usedBytes = Math.max(0, totalBytes - freeBytes);

  return { totalBytes, usedBytes, freeBytes };
}

export function parseChildrenList(content) {
  return content
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map(Number);
}

export function isZombieState(state) {
  return state === 'Z';
}
