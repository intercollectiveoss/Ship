// ship
// designed and built by onyxpowered.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const SERVICE_LABEL = 'com.onyxpowered.ship.daemon';
const WINDOWS_SERVICE_NAME = 'shipDaemon';

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function macLaunchAgentPath(homeDir) {
  return join(homeDir, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

function macEnvironmentBlock(shipHome, path) {
  const entries = [
    ...(shipHome ? [['SHIP_HOME', shipHome]] : []),
    // launchd services get a bare-minimum PATH (just /usr/bin:/bin:/usr/sbin:/sbin),
    // not the interactive shell's -- without this, any Block whose command relies on
    // something installed via nvm/homebrew/etc (npm, yarn, pnpm...) fails to spawn at
    // all under the installed daemon even though it works fine run by hand. Carry over
    // whatever PATH the install command itself was run with.
    ...(path ? [['PATH', path]] : []),
  ];
  if (entries.length === 0) return '';
  const pairs = entries.map(([key, value]) => `    <key>${key}</key>\n    <string>${escapeXml(value)}</string>`).join('\n');
  return `  <key>EnvironmentVariables</key>\n  <dict>\n${pairs}\n  </dict>\n`;
}

function macPlistContents(nodePath, scriptPath, logPath, shipHome, path) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>daemon</string>
    <string>start</string>
  </array>
${macEnvironmentBlock(shipHome, path)}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

async function installMac(nodePath, scriptPath, logPath, exec, homeDir, shipHome, path) {
  const plistPath = macLaunchAgentPath(homeDir);
  await mkdir(join(homeDir, 'Library', 'LaunchAgents'), { recursive: true });
  await writeFile(plistPath, macPlistContents(nodePath, scriptPath, logPath, shipHome, path));
  await exec('launchctl', ['load', '-w', plistPath]);
  return { mechanism: 'launchd', path: plistPath };
}

async function uninstallMac(exec, homeDir) {
  const plistPath = macLaunchAgentPath(homeDir);
  if (existsSync(plistPath)) {
    await exec('launchctl', ['unload', '-w', plistPath]).catch(() => {});
    await rm(plistPath, { force: true });
  }
  return { mechanism: 'launchd', path: plistPath };
}

function linuxUnitPath(homeDir) {
  return join(homeDir, '.config', 'systemd', 'user', 'ship-daemon.service');
}

// Both values come from this process's own environment (SHIP_HOME, PATH),
// but a systemd unit file is line-oriented -- a literal newline embedded in
// either would inject an extra directive into the [Service] block rather
// than just producing a weird PATH. Reject rather than silently strip, the
// same way escapeXml() sidesteps the equivalent risk in the macOS plist.
function assertNoNewline(name, value) {
  if (/[\r\n]/.test(value)) {
    throw new Error(`refusing to write a systemd unit: ${name} contains a newline`);
  }
}

function linuxUnitContents(nodePath, scriptPath, shipHome, path) {
  if (shipHome) assertNoNewline('SHIP_HOME', shipHome);
  if (path) assertNoNewline('PATH', path);
  // A systemd user unit gets systemd's own minimal default PATH, not the
  // interactive shell's -- same class of issue as launchd on macOS. Without
  // this, any Block command relying on something installed via nvm/etc fails
  // to spawn under the installed daemon even though it works run by hand.
  const envLines = [
    ...(shipHome ? [`Environment=SHIP_HOME=${shipHome}`] : []),
    ...(path ? [`Environment=PATH=${path}`] : []),
  ]
    .map((line) => `${line}\n`)
    .join('');
  return `[Unit]
Description=ship Daemon

[Service]
${envLines}ExecStart=${nodePath} ${scriptPath} daemon start
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

async function installLinux(nodePath, scriptPath, exec, homeDir, shipHome, path) {
  const unitPath = linuxUnitPath(homeDir);
  await mkdir(join(homeDir, '.config', 'systemd', 'user'), { recursive: true });
  await writeFile(unitPath, linuxUnitContents(nodePath, scriptPath, shipHome, path));
  await exec('systemctl', ['--user', 'daemon-reload']);
  await exec('systemctl', ['--user', 'enable', '--now', 'ship-daemon.service']);
  return { mechanism: 'systemd', path: unitPath };
}

async function uninstallLinux(exec, homeDir) {
  const unitPath = linuxUnitPath(homeDir);
  await exec('systemctl', ['--user', 'disable', '--now', 'ship-daemon.service']).catch(() => {});
  await rm(unitPath, { force: true });
  return { mechanism: 'systemd', path: unitPath };
}

async function installWindows(nodePath, scriptPath, exec, shipHome, path) {
  const binPath = `"${nodePath}" "${scriptPath}" daemon start`;
  await exec('sc.exe', ['create', WINDOWS_SERVICE_NAME, 'binPath=', binPath, 'start=', 'auto']);
  // A Windows service gets SCM's own default environment, not the interactive
  // shell's -- same class of issue as launchd/systemd. Without PATH, any Block
  // command relying on something installed via nvm/etc fails to spawn under
  // the installed service even though it works run by hand.
  const envEntries = [...(shipHome ? [`SHIP_HOME=${shipHome}`] : []), ...(path ? [`PATH=${path}`] : [])];
  if (envEntries.length > 0) {
    await exec('reg', [
      'add',
      `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${WINDOWS_SERVICE_NAME}`,
      '/v',
      'Environment',
      '/t',
      'REG_MULTI_SZ',
      '/d',
      envEntries.join('\0'),
      '/f',
    ]);
  }
  return { mechanism: 'windows-service', name: WINDOWS_SERVICE_NAME };
}

async function uninstallWindows(exec) {
  await exec('sc.exe', ['stop', WINDOWS_SERVICE_NAME]).catch(() => {});
  await exec('sc.exe', ['delete', WINDOWS_SERVICE_NAME]);
  return { mechanism: 'windows-service', name: WINDOWS_SERVICE_NAME };
}

export async function installService({
  nodePath = process.execPath,
  scriptPath,
  logPath,
  exec = execFileAsync,
  platformName = platform(),
  homeDir = homedir(),
  shipHome = process.env.SHIP_HOME,
  path = process.env.PATH,
}) {
  if (platformName === 'darwin') return installMac(nodePath, scriptPath, logPath, exec, homeDir, shipHome, path);
  if (platformName === 'linux') return installLinux(nodePath, scriptPath, exec, homeDir, shipHome, path);
  if (platformName === 'win32') return installWindows(nodePath, scriptPath, exec, shipHome, path);
  throw new Error(`unsupported platform for service registration: ${platformName}`);
}

export async function uninstallService({
  exec = execFileAsync,
  platformName = platform(),
  homeDir = homedir(),
} = {}) {
  if (platformName === 'darwin') return uninstallMac(exec, homeDir);
  if (platformName === 'linux') return uninstallLinux(exec, homeDir);
  if (platformName === 'win32') return uninstallWindows(exec);
  throw new Error(`unsupported platform for service registration: ${platformName}`);
}
