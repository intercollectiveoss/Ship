// ship
// designed and built by onyxpowered.

import { generateRsaKeyPair, exportPrivateKeyPem, importPrivateKeyPem, publicKeyFromPrivateKey } from '../Crypto/Keys.js';
import { buildName, buildCertificate, parseCertificate } from '../Crypto/X509.js';

const CA_PRIVATE_KEY_PATH = 'interworks/postCa/privateKey';
const CA_CERTIFICATE_PATH = 'interworks/postCa/certificate';
const CA_KEY_SIZE = 2048;
const CA_VALIDITY_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const DEFAULT_CA_COMMON_NAME = 'ship Local Development CA';

function buildCaCertificate(privateKey, publicKey, commonName) {
  const name = buildName({ CN: commonName, O: 'onyxpowered', OU: 'ship' });
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + CA_VALIDITY_MS);
  return buildCertificate({
    subjectPublicKey: publicKey,
    subjectName: name,
    issuerName: name,
    issuerPrivateKey: privateKey,
    isCA: true,
    pathLen: 0,
    notBefore,
    notAfter,
  });
}

export function generateCa(commonName = DEFAULT_CA_COMMON_NAME, keySize = CA_KEY_SIZE) {
  const { privateKey, publicKey } = generateRsaKeyPair(keySize);
  const privateKeyPem = exportPrivateKeyPem(privateKey);
  const certificatePem = buildCaCertificate(privateKey, publicKey, commonName);
  return { privateKeyPem, certificatePem };
}

export async function loadCa(vault) {
  const privateKeyPem = await vault.interface.readReserved(CA_PRIVATE_KEY_PATH);
  const certificatePem = await vault.interface.readReserved(CA_CERTIFICATE_PATH);
  if (!privateKeyPem || !certificatePem) {
    return null;
  }
  return { privateKeyPem, certificatePem };
}

export async function saveCa(vault, ca) {
  await vault.interface.writeReserved(CA_PRIVATE_KEY_PATH, ca.privateKeyPem);
  await vault.interface.writeReserved(CA_CERTIFICATE_PATH, ca.certificatePem);
}

export async function getOrCreateCa(vault, { commonName = DEFAULT_CA_COMMON_NAME, keySize = CA_KEY_SIZE } = {}) {
  const existing = await loadCa(vault);
  if (existing) {
    return describeCa(existing);
  }
  const created = generateCa(commonName, keySize);
  await saveCa(vault, created);
  return describeCa(created);
}

function describeCa(ca) {
  const privateKey = importPrivateKeyPem(ca.privateKeyPem);
  const publicKey = publicKeyFromPrivateKey(privateKey);
  const certificate = parseCertificate(ca.certificatePem);
  return Object.freeze({
    privateKeyPem: ca.privateKeyPem,
    certificatePem: ca.certificatePem,
    privateKey,
    publicKey,
    certificate,
  });
}

export async function rotateCa(vault, options = {}) {
  const created = generateCa(options.commonName ?? DEFAULT_CA_COMMON_NAME, options.keySize ?? CA_KEY_SIZE);
  await saveCa(vault, created);
  return describeCa(created);
}
