#!/usr/bin/env node
// ship
// designed and built by onyxpowered.

import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sendIpcRequest } from './IPC.js';
import { installService, uninstallService } from './ServiceRegistration.js';
import { VERSION } from './Version.js';
import { readLogs } from '../Systemworks.js';
import { createVault } from '../../../Vault/Vault.js';
import { setDaemonToken, resolveServicesUrl } from '../../Interworks/Interworks.js';
import { createVendworks, createRegistryClient } from '../../Vendworks/Vendworks.js';
import { readBlockLogs } from '../../Blockworks/Subworks/BlockLogs.js';
import { scaffoldNewApp } from './Scaffold.js';
import { importSource } from './Import.js';
import { boot } from '../../../Platform.js';
import { resolveshipHome, socketPath, daemonLogPath, appsDir } from '../../../Paths.js';
import { field, printSuccess, printSystem, printError } from './Output.js';
import { loadLocale, DEFAULT_LOCALE } from './Locale.js';
import { t } from './Strings.js';
import { renderCommandResult, translateError, renderHelp } from './Render.js';
import { runStartup } from './Startup.js';
import { suggestCommand } from './Suggest.js';
import { stripDevFlag, resetDevState } from './DevFlags.js';

const CHAR_CODE_CTRL_C = 3;
const CHAR_CODE_BACKSPACE = 127;

async function readLineNoMask(promptText) {
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(field(promptText));
  rl.close();
  return answer;
}

function readLineMasked(promptText) {
  return new Promise((promiseResolve, promiseReject) => {
    process.stdout.write(field(promptText));
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw ?? false;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      if (!wasRaw) stdin.pause();
      process.stdout.write('\n');
    }

    function onData(char) {
      const code = char.charCodeAt(0);
      if (code === CHAR_CODE_CTRL_C) {
        cleanup();
        promiseReject(new Error('passphrase entry cancelled'));
        return;
      }
      if (char === '\r' || char === '\n') {
        cleanup();
        promiseResolve(value);
        return;
      }
      if (code === CHAR_CODE_BACKSPACE || char === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    }

    stdin.on('data', onData);
  });
}

async function defaultPromptPassphrase(promptText) {
  if (!process.stdin.isTTY) {
    return readLineNoMask(promptText);
  }
  return readLineMasked(promptText);
}

async function promptSequence(labels) {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const answers = [];
  let labelIndex = 0;
  return new Promise((promiseResolve) => {
    function askNext() {
      if (labelIndex >= labels.length) {
        rl.close();
        promiseResolve(answers);
        return;
      }
      process.stdout.write(field(labels[labelIndex]));
      labelIndex += 1;
    }
    rl.on('line', (line) => {
      answers.push(line);
      askNext();
    });
    askNext();
  });
}

async function defaultPromptCredentials(labels = { email: 'email', password: 'password' }) {
  if (!process.stdin.isTTY) {
    // readline/promises' question() can drop the 'line' event for a second
    // sequential prompt when stdin is a pipe with all its data already
    // buffered -- the event fires before the second question() call attaches
    // its listener. A single persistent 'line' listener avoids the race.
    const [email, password] = await promptSequence([labels.email, labels.password]);
    return { email, password };
  }
  const email = await readLineNoMask(labels.email);
  const password = await readLineMasked(labels.password);
  return { email, password };
}

function parseFlags(args) {
  const positionals = [];
  const flags = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) {
        flags[arg.slice(2)] = true;
      } else {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function parseAppBlockTarget(raw) {
  if (!raw) {
    throw new Error('usage: ship stop <app> or ship stop <app>:<block>');
  }
  const [appName, blockName] = raw.split(':');
  return { appName, blockName: blockName || undefined };
}

const LETS_ENCRYPT_STAGING_DIRECTORY_URL = 'https://acme-staging-v02.api.letsencrypt.org/directory';

function resolveDeployArgs(args) {
  const { positionals, flags } = parseFlags(args);
  const appRootDir = resolve(positionals[0] ?? process.cwd());
  const appName = flags.name ?? basename(appRootDir);
  const port = flags.port !== undefined ? Number(flags.port) : undefined;
  const hostname = typeof flags.hostname === 'string' ? flags.hostname : undefined;
  const domain = typeof flags.domain === 'string' ? flags.domain : undefined;
  const altNames = typeof flags['alt-names'] === 'string' ? flags['alt-names'].split(',') : undefined;
  const contact = typeof flags.contact === 'string' ? [`mailto:${flags.contact}`] : undefined;
  const directoryUrl = flags.staging ? LETS_ENCRYPT_STAGING_DIRECTORY_URL : undefined;
  const attemptForwarding = flags['no-port-forward'] ? false : undefined;
  return { appName, appRootDir, port, hostname, domain, altNames, contact, directoryUrl, attemptForwarding };
}

// A deploy can genuinely take a while: Block spawn + health check (up to the
// Block's own readyTimeoutMs, 30s by default, if it's just slow to become
// healthy rather than crashing outright). The IPC layer's default 5s timeout
// is tuned for instant calls like ping/version/stop and is too short here --
// give this one real headroom instead of failing loud on what's actually still
// in progress.
//
// Every auto-detected node-based framework's generated command now starts
// with `npm install &&` (see FrameworkDetection.js) before it ever gets to
// building or starting the app, since a freshly imported repo never already
// has node_modules -- so "the Block's own readyTimeoutMs" this budget has
// to cover routinely includes a full install *and* build, not just process
// startup. A cold `npm install` alone can take a minute or more.
const DEPLOY_IPC_TIMEOUT_MS = 300000;

// Production deploys additionally do UPnP/NAT-PMP discovery (a couple of
// seconds each, doubled for two ports, tripled again if UPnP has to fail
// before NAT-PMP is tried) and a real ACME order against Let's Encrypt
// (account registration, HTTP-01 validation, a poll loop with its own 60s
// default budget) before the Block is even reachable -- a plain deploy's
// budget is nowhere near enough headroom for that whole chain to finish.
const PRODUCTION_DEPLOY_IPC_TIMEOUT_MS = 180000;

async function deployViaIpc(args, ctx, mode) {
  const { appName, appRootDir, port, hostname, domain, altNames, contact, directoryUrl, attemptForwarding } =
    resolveDeployArgs(args);
  if (mode === 'production' && !domain) {
    // Matches Composition.js's own check word-for-word (a plain Error, not an
    // error code, is all either layer has) so Render.js's one error matcher
    // catches this whichever side actually threw it.
    throw new Error('production mode requires a domain: ship deploy production <app> --domain=<your-domain>');
  }
  const timeoutMs = mode === 'production' ? PRODUCTION_DEPLOY_IPC_TIMEOUT_MS : DEPLOY_IPC_TIMEOUT_MS;
  return sendIpcRequest(
    ctx.socketPath,
    { type: 'deploy', appName, appRootDir, mode, port, hostname, domain, altNames, contact, directoryUrl, attemptForwarding },
    timeoutMs,
  );
}

function createConnectorVendworks(ctx) {
  return createVault({ shipHome: ctx.shipHome }).then((vault) =>
    createVendworks({ vault, registryClient: createRegistryClient(), shipHome: ctx.shipHome }),
  );
}

const COMMAND_TABLE = {
  version: async (args, ctx) => {
    try {
      const result = await sendIpcRequest(ctx.socketPath, { type: 'version' });
      return { source: 'daemon', ...result };
    } catch {
      return { source: 'cli', version: ctx.version ?? VERSION };
    }
  },

  'daemon install': async (args, ctx) => {
    return installService({
      nodePath: ctx.nodePath,
      scriptPath: ctx.scriptPath,
      logPath: ctx.logPath,
      shipHome: ctx.shipHome,
    });
  },

  'daemon uninstall': async () => {
    return uninstallService();
  },

  'daemon stop': async (args, ctx) => {
    return sendIpcRequest(ctx.socketPath, { type: 'shutdown' });
  },

  'daemon status': async (args, ctx) => {
    try {
      const result = await sendIpcRequest(ctx.socketPath, { type: 'ping' });
      return { running: true, ...result };
    } catch {
      return { running: false };
    }
  },

  logs: async (args, ctx) => {
    const [first, second] = args;
    if (first !== undefined && Number.isNaN(Number(first))) {
      const { appName, blockName } = parseAppBlockTarget(first);
      const lineCount = Number(second) || 100;
      const entries = await readBlockLogs(appName, blockName ?? 'web', lineCount, { shipHome: ctx.shipHome });
      return { appName, blockName: blockName ?? 'web', entries };
    }
    const lineCount = Number(first) || 100;
    return readLogs(ctx.shipHome, lineCount);
  },

  'vault export': async (args, ctx) => {
    const [destPath = join(ctx.shipHome, `ship-vault-backup-${Date.now()}.json`)] = args;
    const promptPassphrase = ctx.promptPassphrase ?? defaultPromptPassphrase;
    const passphrase = await promptPassphrase(t(ctx.locale, 'vaultExportPrompt'));
    const vault = await createVault({ shipHome: ctx.shipHome });
    const path = await vault.export(passphrase, destPath);
    return { exported: path };
  },

  'vault import': async (args, ctx) => {
    const [bundlePath] = args;
    if (!bundlePath) {
      throw new Error('usage: ship vault import <bundlePath>');
    }
    const promptPassphrase = ctx.promptPassphrase ?? defaultPromptPassphrase;
    const passphrase = await promptPassphrase(t(ctx.locale, 'vaultImportPrompt'));
    const vault = await createVault({ shipHome: ctx.shipHome });
    await vault.import(passphrase, bundlePath);
    return { imported: bundlePath };
  },

  login: async (args, ctx) => {
    const { flags } = parseFlags(args);
    const promptCredentials = ctx.promptCredentials ?? defaultPromptCredentials;
    const fetchImpl = ctx.fetchImpl ?? fetch;
    const { email, password } = await promptCredentials({
      email: t(ctx.locale, 'loginEmailPrompt'),
      password: t(ctx.locale, 'loginPasswordPrompt'),
    });
    const servicesUrl = resolveServicesUrl();
    const endpoint = flags.signup ? 'signup' : 'login';
    const response = await fetchImpl(`${servicesUrl}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? `${endpoint} failed with status ${response.status}`);
    }
    const vault = await createVault({ shipHome: ctx.shipHome });
    await setDaemonToken(vault, body.token, { accountId: body.accountId });
    return { accountId: body.accountId, email: body.email, loggedIn: true };
  },

  new: async (args, ctx) => {
    const { positionals } = parseFlags(args);
    const [appName] = positionals;
    if (!appName) {
      throw new Error('usage: ship new <appName>');
    }
    // Scaffolds at the filesystem root (~/<appName>), never at cwd -- running
    // `ship new` from inside a repo you happen to be working in (ship's own,
    // or any other) should never drop a starter project into it.
    const destinationDir = resolve(homedir(), appName);
    return scaffoldNewApp(appName, destinationDir);
  },

  import: async (args, ctx) => {
    const { positionals, flags } = parseFlags(args);
    const [source] = positionals;
    return importSource(source, {
      appsDir: appsDir(ctx.shipHome),
      subPath: flags.path,
      from: flags.from,
      appName: flags.name,
    });
  },

  deploy: async (args, ctx) => deployViaIpc(args, ctx, 'post'),
  'deploy production': async (args, ctx) => deployViaIpc(args, ctx, 'production'),
  production: async (args, ctx) => deployViaIpc(args, ctx, 'production'),

  stop: async (args, ctx) => {
    const { appName, blockName } = parseAppBlockTarget(args[0]);
    return sendIpcRequest(ctx.socketPath, { type: 'stop', appName, blockName });
  },

  'connector install': async (args, ctx) => {
    const [name] = args;
    if (!name) throw new Error('usage: ship connector install <name>');
    const vendworks = await createConnectorVendworks(ctx);
    return vendworks.install(name);
  },

  'connector uninstall': async (args, ctx) => {
    const [name] = args;
    if (!name) throw new Error('usage: ship connector uninstall <name>');
    const vendworks = await createConnectorVendworks(ctx);
    return vendworks.uninstall(name);
  },

  'connector list': async (args, ctx) => {
    const vendworks = await createConnectorVendworks(ctx);
    return vendworks.list();
  },

  'connector publish': async (args, ctx) => {
    const { positionals, flags } = parseFlags(args);
    const [name, version, sourceDir] = positionals;
    if (!name || !version || !sourceDir) {
      throw new Error('usage: ship connector publish <name> <version> <sourceDir> [--token=TOKEN]');
    }
    const vendworks = await createConnectorVendworks(ctx);
    return vendworks.publish({ name, version, sourceDir, token: flags.token });
  },
};

// Not in COMMAND_TABLE -- both are special-cased in main() because they
// print their own output (or, for daemon start, block forever) instead of
// returning a result for the generic renderer. Still real commands as far
// as typo suggestions are concerned, so they're listed here too.
const SPECIAL_CASE_COMMANDS = ['startup', 'help', 'daemon start'];

export function knownCommands() {
  return [...Object.keys(COMMAND_TABLE), ...SPECIAL_CASE_COMMANDS];
}

export function resolveCommand(argv) {
  const twoWord = argv.slice(0, 2).join(' ');
  if (Object.prototype.hasOwnProperty.call(COMMAND_TABLE, twoWord)) {
    return { key: twoWord, rest: argv.slice(2) };
  }
  const oneWord = argv[0];
  if (oneWord !== undefined && Object.prototype.hasOwnProperty.call(COMMAND_TABLE, oneWord)) {
    return { key: oneWord, rest: argv.slice(1) };
  }
  return null;
}

export async function dispatch(argv, ctx) {
  const resolved = resolveCommand(argv);
  if (!resolved) {
    throw new Error(`unknown command: ${argv.join(' ') || '(none)'}`);
  }
  const result = await COMMAND_TABLE[resolved.key](resolved.rest, ctx);
  return { commandKey: resolved.key, result };
}

async function buildCliContext() {
  const shipHome = resolveshipHome();
  const locale = await loadLocale(shipHome).catch(() => DEFAULT_LOCALE);
  return {
    version: VERSION,
    shipHome,
    locale,
    socketPath: socketPath(shipHome),
    logPath: daemonLogPath(shipHome),
    nodePath: process.execPath,
    scriptPath: process.argv[1],
  };
}

const HELP_TOKENS = new Set(['help', '--help', '-h']);

// Every path through here either prints its own localized output and
// returns undefined, or returns { commandKey, result } for the generic
// per-command renderer -- main() itself is where locale, printing, and
// error translation all meet, so nothing downstream has to know about any
// of the three.
export async function main(rawArgv = process.argv.slice(2)) {
  const { argv, devFlags } = stripDevFlag(rawArgv);
  const ctx = await buildCliContext();
  if (devFlags) {
    ctx.locale = await resetDevState(ctx.shipHome, ctx.locale);
  }

  try {
    if (argv.length === 0 || HELP_TOKENS.has(argv[0])) {
      renderHelp(ctx.locale);
      return undefined;
    }

    if (argv[0] === 'startup') {
      return await runStartup(ctx);
    }

    if (argv[0] === 'daemon' && argv[1] === 'start') {
      const { flags } = parseFlags(argv.slice(2));
      const verbose = Boolean(flags.dev || flags.verbose);
      const { readyReport } = await boot({ shipHome: ctx.shipHome, verbose });
      // boot() normally only logs to the daemon's log file, never stdout --
      // run this directly in a foreground terminal (not backgrounded with &
      // or installed via `ship daemon install`) and it would otherwise look
      // indistinguishable from a hang, since the daemon blocks here forever
      // by design once it's up. --dev (or --verbose) tees Block lifecycle
      // transitions, IPC traffic, and health-check timing here live, on top
      // of that same confirmation.
      printSuccess(t(ctx.locale, 'daemonStartForeground', { pid: process.pid, socket: readyReport.socket }));
      printSystem(t(ctx.locale, 'daemonStartForegroundHint'));
      if (verbose) printSystem(t(ctx.locale, 'daemonStartVerboseHint'));
      return readyReport;
    }

    if (!resolveCommand(argv)) {
      const corrected = await suggestCommand(argv, ctx.locale, knownCommands());
      if (corrected) {
        return main(corrected);
      }
      // Nothing close enough to suggest, or the suggestion was declined --
      // fall through to dispatch()'s own unknown-command error, unchanged.
    }

    const { commandKey, result } = await dispatch(argv, ctx);
    renderCommandResult(commandKey, result, ctx.locale);
    return result;
  } catch (error) {
    // Re-thrown with an already-localized message so the one catch below
    // (and anything else calling main() programmatically) doesn't need its
    // own translation logic or access to ctx.locale.
    throw new Error(translateError(error, ctx.locale));
  }
}

function isDirectRun() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then(
    () => {},
    (err) => {
      printError(err.message);
      process.exitCode = 1;
    },
  );
}
