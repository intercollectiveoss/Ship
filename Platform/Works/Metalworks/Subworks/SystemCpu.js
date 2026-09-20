// ship
// designed and built by onyxpowered.

function totalCoreTimes(coreTimes, platformName) {
  const irqCorrectedSys = platformName === 'win32' ? Math.max(0, coreTimes.sys - coreTimes.irq) : coreTimes.sys;
  const total = coreTimes.user + coreTimes.nice + irqCorrectedSys + coreTimes.idle + coreTimes.irq;
  return { total, idle: coreTimes.idle };
}

function sumCpus(cpus, platformName) {
  let totalSum = 0;
  let idleSum = 0;
  for (const cpu of cpus) {
    const { total, idle } = totalCoreTimes(cpu.times, platformName);
    totalSum += total;
    idleSum += idle;
  }
  return { totalSum, idleSum };
}

export function computeSystemCpuPercent(previousCpus, currentCpus, platformName = process.platform) {
  if (!Array.isArray(previousCpus) || !Array.isArray(currentCpus)) return null;
  if (previousCpus.length === 0 || currentCpus.length === 0) return null;
  if (previousCpus.length !== currentCpus.length) return null;

  const previous = sumCpus(previousCpus, platformName);
  const current = sumCpus(currentCpus, platformName);

  const totalDelta = current.totalSum - previous.totalSum;
  const idleDelta = current.idleSum - previous.idleSum;

  if (totalDelta <= 0) return null;

  const busyDelta = totalDelta - idleDelta;
  const percent = (busyDelta / totalDelta) * 100;
  return Math.max(0, Math.min(100, percent));
}
