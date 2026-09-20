// ship
// designed and built by onyxpowered.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile as fsCopyFile, unlink as fsUnlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export async function defaultRun(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: typeof error.code === 'number' ? error.code : 1, stdout: error.stdout ?? '', stderr: error.stderr ?? error.message };
  }
}

const DARWIN_SYSTEM_KEYCHAIN = '/Library/Keychains/System.keychain';
const LINUX_CA_CERT_DIR = '/usr/local/share/ca-certificates';

async function installDarwin(certPath, run) {
  return run('security', ['add-trusted-cert', '-d', '-r', 'trustRoot', '-k', DARWIN_SYSTEM_KEYCHAIN, certPath]);
}

async function uninstallDarwin(certPath, run) {
  return run('security', ['remove-trusted-cert', '-d', certPath]);
}

async function installWindows(certPath, run) {
  return run('certutil', ['-addstore', '-f', 'ROOT', certPath]);
}

async function uninstallWindows(commonName, run) {
  return run('certutil', ['-delstore', 'ROOT', commonName]);
}

function linuxCertFileName(name) {
  return `ship-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.crt`;
}

async function installLinux(certPath, name, run, copyFile = fsCopyFile, ensureDir = mkdir) {
  await ensureDir(LINUX_CA_CERT_DIR, { recursive: true });
  const destPath = join(LINUX_CA_CERT_DIR, linuxCertFileName(name));
  await copyFile(certPath, destPath);
  const updateResult = await run('update-ca-certificates', []);
  const nssResult = await run('certutil', [
    '-d',
    `sql:${process.env.HOME ?? ''}/.pki/nssdb`,
    '-A',
    '-t',
    'C,,',
    '-n',
    `ship Local Development CA (${name})`,
    '-i',
    certPath,
  ]);
  return { destPath, updateResult, nssResult: nssResult.code === 0 ? nssResult : { ...nssResult, optional: true } };
}

async function uninstallLinux(name, run, unlink = fsUnlink) {
  const destPath = join(LINUX_CA_CERT_DIR, linuxCertFileName(name));
  await unlink(destPath).catch(() => {});
  return run('update-ca-certificates', ['--fresh']);
}

export async function installCaTrust({
  certPath,
  name = 'ship Local Development CA',
  platform = process.platform,
  run = defaultRun,
  copyFile = fsCopyFile,
  ensureDir = mkdir,
} = {}) {
  if (platform === 'darwin') {
    return { platform, result: await installDarwin(certPath, run) };
  }
  if (platform === 'win32') {
    return { platform, result: await installWindows(certPath, run) };
  }
  if (platform === 'linux') {
    return { platform, result: await installLinux(certPath, name, run, copyFile, ensureDir) };
  }
  throw new Error(`unsupported platform for CA trust install: ${platform}`);
}

export async function uninstallCaTrust({
  certPath,
  name = 'ship Local Development CA',
  platform = process.platform,
  run = defaultRun,
  unlink = fsUnlink,
} = {}) {
  if (platform === 'darwin') {
    return { platform, result: await uninstallDarwin(certPath, run) };
  }
  if (platform === 'win32') {
    return { platform, result: await uninstallWindows(name, run) };
  }
  if (platform === 'linux') {
    return { platform, result: await uninstallLinux(name, run, unlink) };
  }
  throw new Error(`unsupported platform for CA trust uninstall: ${platform}`);
}

export function manualTrustInstructions(platform, certPath) {
  if (platform === 'darwin') {
    return `Open Keychain Access, drag in ${certPath}, then set it to "Always Trust" under the Trust section.`;
  }
  if (platform === 'win32') {
    return `Double-click ${certPath}, choose "Install Certificate", select "Local Machine", and place it in the "Trusted Root Certification Authorities" store.`;
  }
  if (platform === 'linux') {
    return `Copy ${certPath} into ${LINUX_CA_CERT_DIR}/ and run "sudo update-ca-certificates". For NSS-based browsers, also import it into ~/.pki/nssdb with certutil.`;
  }
  return `Manually trust the certificate authority at ${certPath} using your OS's certificate management tools.`;
}
