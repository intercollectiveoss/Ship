// ship
// designed and built by onyxpowered.

export function computeProcessCpuPercent({ previousCpuTimeMs, currentCpuTimeMs, elapsedMs, coreCount }) {
  if (previousCpuTimeMs === null || previousCpuTimeMs === undefined) return null;
  if (typeof currentCpuTimeMs !== 'number' || Number.isNaN(currentCpuTimeMs)) return null;
  if (typeof elapsedMs !== 'number' || Number.isNaN(elapsedMs) || elapsedMs <= 0) return null;
  if (typeof coreCount !== 'number' || Number.isNaN(coreCount) || coreCount <= 0) return null;

  const cpuTimeDeltaMs = currentCpuTimeMs - previousCpuTimeMs;
  if (Number.isNaN(cpuTimeDeltaMs)) return null;
  const safeCpuTimeDeltaMs = Math.max(0, cpuTimeDeltaMs);

  const perCoreRelativePercent = (safeCpuTimeDeltaMs / elapsedMs) * 100;
  const wholeMachineRelativePercent = perCoreRelativePercent / coreCount;

  if (!Number.isFinite(wholeMachineRelativePercent)) return null;

  return Math.max(0, Math.min(100, wholeMachineRelativePercent));
}
