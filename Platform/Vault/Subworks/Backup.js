// ship
// designed and built by onyxpowered.

import { writeFile, readFile } from 'node:fs/promises';
import { deriveKeyFromPassphrase, generateSalt, encrypt, decrypt, DEFAULT_SCRYPT_PARAMS } from './Crypto.js';

const BUNDLE_FORMAT_VERSION = 1;

export async function exportVaultBundle(store, passphrase, destPath) {
  const dump = await store.exportAll();
  const plaintext = Buffer.from(JSON.stringify(dump), 'utf8');
  const salt = generateSalt();
  const key = deriveKeyFromPassphrase(passphrase, salt, DEFAULT_SCRYPT_PARAMS);
  const { iv, authTag, ciphertext } = encrypt(key, plaintext);
  const bundle = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    kdf: {
      name: 'scrypt',
      N: DEFAULT_SCRYPT_PARAMS.N,
      r: DEFAULT_SCRYPT_PARAMS.r,
      p: DEFAULT_SCRYPT_PARAMS.p,
      salt: salt.toString('base64'),
    },
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  await writeFile(destPath, JSON.stringify(bundle, null, 2), { mode: 0o600 });
  return destPath;
}

export async function readBundleHeader(bundlePath) {
  const raw = await readFile(bundlePath, 'utf8');
  const bundle = JSON.parse(raw);
  if (bundle.formatVersion !== BUNDLE_FORMAT_VERSION) {
    throw new Error(
      `unsupported Vault bundle format version: ${bundle.formatVersion}, expected ${BUNDLE_FORMAT_VERSION}`,
    );
  }
  if (bundle.kdf?.name !== 'scrypt') {
    throw new Error(`unsupported Vault bundle KDF: ${bundle.kdf?.name}`);
  }
  return bundle;
}

export async function importVaultBundle(store, passphrase, bundlePath) {
  const bundle = await readBundleHeader(bundlePath);
  const salt = Buffer.from(bundle.kdf.salt, 'base64');
  const key = deriveKeyFromPassphrase(passphrase, salt, bundle.kdf);
  let plaintext;
  try {
    plaintext = decrypt(key, {
      iv: Buffer.from(bundle.iv, 'base64'),
      authTag: Buffer.from(bundle.authTag, 'base64'),
      ciphertext: Buffer.from(bundle.ciphertext, 'base64'),
    });
  } catch {
    throw new Error('failed to decrypt Vault bundle: wrong passphrase or corrupt file');
  }
  const dump = JSON.parse(plaintext.toString('utf8'));
  await store.importAll(dump);
  return dump;
}
