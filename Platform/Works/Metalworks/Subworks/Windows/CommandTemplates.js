// ship
// designed and built by onyxpowered.

export const UTF8_INIT_SCRIPT =
  '$OutputEncoding = [System.Console]::OutputEncoding = [System.Console]::InputEncoding = [System.Text.Encoding]::UTF8';

export const PROBE_SCRIPT = "Write-Output 'ship-metalworks-probe-ok'";

export function buildProcessSampleScript(pidList) {
  return `Get-Process -Id ${pidList.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64,StartTime | ConvertTo-Json -Compress`;
}

export function buildTreeSnapshotScript() {
  return 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress';
}

function normalizeEntries(parsed) {
  if (parsed == null) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function safeParseJson(rawOutput) {
  const trimmed = rawOutput.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function parseProcessSampleOutput(rawOutput, requestedPids) {
  const result = new Map();
  const entries = normalizeEntries(safeParseJson(rawOutput));

  for (const entry of entries) {
    if (entry == null || entry.Id == null) continue;
    const fingerprint =
      typeof entry.StartTime === 'object' && entry.StartTime !== null ? JSON.stringify(entry.StartTime) : entry.StartTime ?? null;
    result.set(entry.Id, {
      cpuTimeMs: typeof entry.CPU === 'number' ? entry.CPU * 1000 : 0,
      rssBytes: typeof entry.WorkingSet64 === 'number' ? entry.WorkingSet64 : null,
      alive: true,
      fingerprint,
    });
  }

  for (const pid of requestedPids) {
    if (!result.has(pid)) {
      result.set(pid, { cpuTimeMs: 0, rssBytes: null, alive: false, fingerprint: null });
    }
  }

  return result;
}

export function parseTreeSnapshotOutput(rawOutput) {
  const parentPidByPid = new Map();
  const entries = normalizeEntries(safeParseJson(rawOutput));
  for (const entry of entries) {
    if (entry == null || entry.ProcessId == null) continue;
    parentPidByPid.set(entry.ProcessId, entry.ParentProcessId ?? null);
  }
  return parentPidByPid;
}

const POLICY_BLOCK_PHRASES = [
  'cannot be loaded because running scripts is disabled',
  'execution of scripts is disabled',
  'is not digitally signed',
  'constrainedlanguage',
  'constrained language',
  'blocked by group policy',
  'unauthorizedaccess',
];

export function looksLikePolicyBlock(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return POLICY_BLOCK_PHRASES.some((phrase) => lower.includes(phrase));
}
