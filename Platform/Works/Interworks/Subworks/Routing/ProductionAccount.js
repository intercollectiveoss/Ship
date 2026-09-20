// ship
// designed and built by onyxpowered.

import { generateEcKeyPair, exportPrivateKeyPem, importPrivateKeyPem, publicKeyFromPrivateKey } from '../Crypto/Keys.js';

// One ACME account per ship install, shared across every domain it issues
// for -- this mirrors how Let's Encrypt itself expects accounts to be used
// (register once, order many certificates), not one account per domain.
const ACCOUNT_KEY_PATH = 'interworks/production/accountKey';
const ACCOUNT_KID_PATH = 'interworks/production/accountKid';

function domainSlug(domain) {
  return domain.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
}

function leafKeyPath(domain) {
  return `interworks/production/leaf/${domainSlug(domain)}/privateKey`;
}

async function loadOrCreateKeyPair(vault, path) {
  const existingPem = await vault.interface.readReserved(path);
  if (existingPem) {
    const privateKey = importPrivateKeyPem(existingPem);
    return { privateKey, publicKey: publicKeyFromPrivateKey(privateKey) };
  }
  const { privateKey, publicKey } = generateEcKeyPair('P-256');
  await vault.interface.writeReserved(path, exportPrivateKeyPem(privateKey));
  return { privateKey, publicKey };
}

export async function getOrCreateAcmeAccountKey(vault) {
  return loadOrCreateKeyPair(vault, ACCOUNT_KEY_PATH);
}

export async function getAcmeAccountKid(vault) {
  return vault.interface.readReserved(ACCOUNT_KID_PATH);
}

export async function saveAcmeAccountKid(vault, kid) {
  await vault.interface.writeReserved(ACCOUNT_KID_PATH, kid);
}

export async function getOrCreateProductionLeafKey(vault, domain) {
  return loadOrCreateKeyPair(vault, leafKeyPath(domain));
}
