// ship
// designed and built by onyxpowered.

import { PRIORITY_TIERS } from './ConfigSchema.js';

const THROTTLE_ORDER = Object.freeze([...PRIORITY_TIERS].reverse());

function tierRank(priority) {
  const index = THROTTLE_ORDER.indexOf(priority);
  if (index === -1) {
    throw new Error(`unknown priority tier: "${priority}"`);
  }
  return index;
}

function consumptionFor(candidate, metric) {
  if (metric === 'cpu') return candidate.cpuPercent ?? 0;
  if (metric === 'memory') return candidate.rssBytes ?? 0;
  throw new Error(`unknown throttle metric: "${metric}"`);
}

export function rankThrottleCandidates(candidates, metric) {
  for (const candidate of candidates) {
    tierRank(candidate.priority);
    consumptionFor(candidate, metric);
  }
  return [...candidates].sort((a, b) => {
    const tierDiff = tierRank(a.priority) - tierRank(b.priority);
    if (tierDiff !== 0) return tierDiff;
    return consumptionFor(b, metric) - consumptionFor(a, metric);
  });
}

export function selectThrottleTarget(candidates, metric, options = {}) {
  const { isExcluded = () => false } = options;
  const ranked = rankThrottleCandidates(candidates, metric);
  return ranked.find((candidate) => !isExcluded(candidate)) ?? null;
}
