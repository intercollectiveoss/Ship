// ship
// designed and built by onyxpowered.
//
// Turns a command's raw result -- or a thrown error -- into the sentence a
// person should read, in whichever language they picked with `ship startup`.
// One small renderer per command shape instead of a generic dump; nothing
// in normal use should ever print a raw JSON object or an unrouted stack
// trace's worth of an error message.

import { t } from './Strings.js';
import { printSuccess, printSystem, tags, formatResult } from './Output.js';

const BCP47 = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', de: 'de-DE', ja: 'ja-JP', zh: 'zh-CN' };

function localTime(isoTimestamp, locale) {
  try {
    return new Date(isoTimestamp).toLocaleTimeString(BCP47[locale] ?? 'en-US');
  } catch {
    return isoTimestamp;
  }
}

function compactMeta(meta) {
  const entries = Object.entries(meta);
  if (entries.length === 0) return '';
  return ` (${entries.map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(', ')})`;
}

const LEVEL_TAG = { info: tags.system, warn: tags.warning, error: tags.error };
const STREAM_TAG = { stdout: tags.system, stderr: tags.warning };

function formatDaemonLogEntry(entry, locale) {
  if (entry.raw !== undefined) return `  ${entry.raw}`;
  const { timestamp, level, message, ...meta } = entry;
  const tag = LEVEL_TAG[level] ?? tags.system;
  return `  ${tag} ${localTime(timestamp, locale)}  ${message}${compactMeta(meta)}`;
}

function formatBlockLogEntry(entry, locale) {
  if (entry.raw !== undefined) return `  ${entry.raw}`;
  const { timestamp, stream, line } = entry;
  const tag = STREAM_TAG[stream] ?? tags.system;
  return `  ${tag} ${localTime(timestamp, locale)}  ${line}`;
}

function modeLabel(locale, mode) {
  const key = { post: 'modePost', preview: 'modePreview', production: 'modeProduction' }[mode];
  return key ? t(locale, key) : mode;
}

const RENDERERS = {
  version: (result, locale) => {
    const source = result.source === 'daemon' ? t(locale, 'sourceDaemon') : t(locale, 'sourceCli');
    printSuccess(t(locale, 'versionLine', { version: result.version, source }));
  },

  'daemon install': (result, locale) => {
    printSuccess(t(locale, 'daemonInstallSuccess', { mechanism: result.mechanism }));
  },
  'daemon uninstall': (result, locale) => {
    printSuccess(t(locale, 'daemonUninstallSuccess'));
  },
  'daemon stop': (result, locale) => {
    printSuccess(t(locale, 'daemonStopSuccess'));
  },
  'daemon status': (result, locale) => {
    printSuccess(t(locale, result.running ? 'daemonStatusRunning' : 'daemonStatusStopped'));
  },

  logs: (result, locale) => {
    const isBlockLog = !Array.isArray(result);
    const entries = isBlockLog ? result.entries : result;
    const header = isBlockLog
      ? t(locale, 'logsHeaderBlock', { count: entries.length, app: result.appName, block: result.blockName })
      : t(locale, 'logsHeaderDaemon', { count: entries.length });
    printSystem(header);
    if (entries.length === 0) {
      printSystem(t(locale, 'logsEmpty'));
      return;
    }
    const formatEntry = isBlockLog ? formatBlockLogEntry : formatDaemonLogEntry;
    for (const entry of entries) console.log(formatEntry(entry, locale));
  },

  'vault export': (result, locale) => {
    printSuccess(t(locale, 'vaultExportSuccess', { path: result.exported }));
  },
  'vault import': (result, locale) => {
    printSuccess(t(locale, 'vaultImportSuccess', { path: result.imported }));
  },

  login: (result, locale) => {
    printSuccess(t(locale, 'loginSuccess', { email: result.email }));
  },

  new: (result, locale) => {
    printSuccess(t(locale, 'newSuccess', { name: result.appName, path: result.appRootDir }));
  },

  import: (result, locale) => {
    if (result.detected === 'existing ship.config.js used as-is') {
      printSuccess(t(locale, 'importSuccessExistingConfig', { name: result.appName, path: result.appRootDir }));
    } else {
      printSuccess(
        t(locale, 'importSuccess', { name: result.appName, path: result.appRootDir, framework: result.detected }),
      );
    }
    if (result.note) {
      printSystem(`${t(locale, 'importNoteLabel')}: ${result.note}`);
    }
  },

  deploy: (result, locale) => {
    printSuccess(
      t(locale, 'deploySuccess', { app: result.appName, mode: modeLabel(locale, result.mode), url: result.url }),
    );
  },

  stop: (result, locale) => {
    if (result.blockName) {
      printSuccess(t(locale, 'stopBlockSuccess', { block: result.blockName, app: result.appName }));
    } else {
      printSuccess(t(locale, 'stopSuccess', { app: result.appName }));
    }
  },

  'connector install': (result, locale) => {
    printSuccess(t(locale, 'connectorInstallSuccess', { name: result.name }));
  },
  'connector uninstall': (result, locale) => {
    printSuccess(t(locale, 'connectorUninstallSuccess', { name: result.name }));
  },
  'connector publish': (result, locale) => {
    printSuccess(t(locale, 'connectorPublishSuccess', { name: result.name, version: result.version }));
  },
  'connector list': (result, locale) => {
    const list = Array.isArray(result) ? result : [];
    if (list.length === 0) {
      printSystem(t(locale, 'connectorListEmpty'));
      return;
    }
    printSystem(t(locale, 'connectorListHeader'));
    for (const item of list) console.log(`  - ${item.name}@${item.version}`);
  },
};

// deploy/production/deploy production all share the
// same result shape (Composition.deployApp's return value) -- route every
// deploy-flavored command key through the one deploy renderer rather than
// repeating it three times.
for (const key of ['deploy production', 'production']) {
  RENDERERS[key] = RENDERERS.deploy;
}

// Anything not explicitly rendered above still gets the readable key: value
// listing (never raw JSON) -- this is the safety net, not the common path.
export function renderCommandResult(commandKey, result, locale) {
  const renderer = RENDERERS[commandKey];
  if (renderer) {
    renderer(result, locale);
    return;
  }
  if (result === undefined || result === null) return;
  const formatted = formatResult(result);
  if (formatted) console.log(formatted);
}

// Known failure shapes get a specific, localized sentence; anything else
// still gets a localized wrapper around whatever the underlying error said,
// so the CLI never bottoms out in a raw, untranslated stack-trace line.
const ERROR_MATCHERS = [
  {
    test: (m) => /^unknown command: (.*)$/.exec(m),
    render: (locale, match) => t(locale, 'unknownCommand', { cmd: match[1] || '(none)' }),
  },
  {
    test: (m) => /^app "(.+)" is already deployed/.exec(m),
    render: (locale, match) => t(locale, 'deployAlreadyRunning', { app: match[1] }),
  },
  {
    test: (m) => /^production mode requires a domain/.test(m) && m,
    render: (locale) => t(locale, 'deployDomainMissing'),
  },
  {
    test: (m) => /^IPC request timed out$/.test(m) && m,
    render: (locale) => t(locale, 'deployTimedOut'),
  },
  {
    test: (m) => /failed to decrypt Vault bundle/.test(m) && m,
    render: (locale) => t(locale, 'vaultWrongPassphrase'),
  },
  {
    test: (m) => /ECONNREFUSED|ENOENT/.test(m) && m,
    render: (locale) => t(locale, 'daemonNotRunning'),
  },
];

export function translateError(error, locale) {
  const message = error?.message ?? String(error);
  for (const matcher of ERROR_MATCHERS) {
    const match = matcher.test(message);
    if (match) return matcher.render(locale, match);
  }
  return t(locale, 'genericError', { message });
}

const HELP_ENTRIES = [
  ['ship startup', 'helpCmdStartup'],
  ['ship daemon start', 'helpCmdDaemonStart'],
  ['ship daemon install', 'helpCmdDaemonInstall'],
  ['ship daemon uninstall', 'helpCmdDaemonUninstall'],
  ['ship daemon stop', 'helpCmdDaemonStop'],
  ['ship daemon status', 'helpCmdDaemonStatus'],
  ['ship version', 'helpCmdVersion'],
  ['ship new <name>', 'helpCmdNew'],
  ['ship import <source>', 'helpCmdImport'],
  ['ship deploy <app>', 'helpCmdDeploy'],
  ['ship deploy production <app>', 'helpCmdProduction'],
  ['ship stop <app>', 'helpCmdStop'],
  ['ship logs [app[:block]]', 'helpCmdLogs'],
  ['ship vault export', 'helpCmdVaultExport'],
  ['ship vault import <path>', 'helpCmdVaultImport'],
  ['ship login', 'helpCmdLogin'],
  ['ship connector install <name>', 'helpCmdConnectorInstall'],
  ['ship connector uninstall <name>', 'helpCmdConnectorUninstall'],
  ['ship connector list', 'helpCmdConnectorList'],
  ['ship connector publish <name> <version> <dir>', 'helpCmdConnectorPublish'],
  ['ship help', 'helpCmdHelp'],
];

export function renderHelp(locale) {
  printSystem(t(locale, 'helpTitle'));
  const widest = Math.max(...HELP_ENTRIES.map(([usage]) => usage.length));
  for (const [usage, key] of HELP_ENTRIES) {
    console.log(`  ${usage.padEnd(widest + 2)}${t(locale, key)}`);
  }
}
