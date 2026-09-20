// ship
// designed and built by onyxpowered.

export function parsePsLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 4) return null;
  const [pidStr, stat, rssStr, time, ...lstartTokens] = tokens;
  return {
    pid: Number(pidStr),
    stat,
    rssKb: Number(rssStr),
    time,
    lstart: lstartTokens.join(' '),
  };
}

export function parseCpuTimeToMs(timeStr) {
  const segments = timeStr.split(':');
  let totalSeconds = parseFloat(segments[segments.length - 1]);
  let multiplier = 60;
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    totalSeconds += Number(segments[i]) * multiplier;
    multiplier *= 60;
  }
  return totalSeconds * 1000;
}

export function isZombieStat(stat) {
  return typeof stat === 'string' && stat.startsWith('Z');
}

export function parsePidPpidLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const [pidStr, ppidStr] = trimmed.split(/\s+/);
  if (pidStr === undefined || ppidStr === undefined) return null;
  return { pid: Number(pidStr), ppid: Number(ppidStr) };
}

export function parseVmStat(output) {
  const pageSizeMatch = output.match(/page size of (\d+) bytes/);
  const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 4096;

  const values = new Map();
  for (const line of output.split('\n')) {
    const match = line.match(/^"?([^:]+?)"?:\s+(\d+)\.?\s*$/);
    if (match) {
      values.set(match[1], Number(match[2]));
    }
  }

  return {
    pageSize,
    freePages: values.get('Pages free') ?? 0,
    speculativePages: values.get('Pages speculative') ?? 0,
    purgeablePages: values.get('Pages purgeable') ?? 0,
  };
}

export function parsePressureLevel(output) {
  const parsed = Number(output.trim());
  return Number.isNaN(parsed) ? null : parsed;
}
