// ship
// designed and built by onyxpowered.

import { generateRsaKeyPair, exportPrivateKeyPem, importPrivateKeyPem, publicKeyFromPrivateKey } from '../Crypto/Keys.js';
import { buildName, buildCertificate, parseCertificate, extractSubjectNameDer } from '../Crypto/X509.js';

export const DEFAULT_LEAF_HOSTNAMES = Object.freeze(['localhost', '127.0.0.1', '::1']);
const LEAF_KEY_SIZE = 2048;
const LEAF_VALIDITY_MS = 397 * 24 * 60 * 60 * 1000;

function leafSlug(hostnames) {
  return [...hostnames]
    .sort()
    .join(',')
    .toLowerCase()
    .replace(/[^a-z0-9,.:_-]/g, '_')
    .replace(/[,:]/g, '-');
}

function leafPrivateKeyPath(hostnames) {
  return `interworks/postLeaf/${leafSlug(hostnames)}/privateKey`;
}

function leafCertificatePath(hostnames) {
  return `interworks/postLeaf/${leafSlug(hostnames)}/certificate`;
}

function leafCaFingerprintPath(hostnames) {
  return `interworks/postLeaf/${leafSlug(hostnames)}/caFingerprint`;
}

export function generateLeafCertificate(ca, hostnames = DEFAULT_LEAF_HOSTNAMES, { commonName = hostnames[0], keySize = LEAF_KEY_SIZE } = {}) {
  const { privateKey, publicKey } = generateRsaKeyPair(keySize);
  const subjectName = buildName({ CN: commonName });
  const issuerName = extractSubjectNameDer(ca.certificatePem);
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + LEAF_VALIDITY_MS);

  const certificatePem = buildCertificate({
    subjectPublicKey: publicKey,
    subjectName,
    issuerName,
    issuerPrivateKey: ca.privateKey,
    altNames: [...hostnames],
    notBefore,
    notAfter,
  });

  return {
    privateKeyPem: exportPrivateKeyPem(privateKey),
    certificatePem,
  };
}

export async function loadLeafCertificate(vault, hostnames = DEFAULT_LEAF_HOSTNAMES) {
  const privateKeyPem = await vault.interface.readReserved(leafPrivateKeyPath(hostnames));
  const certificatePem = await vault.interface.readReserved(leafCertificatePath(hostnames));
  const caFingerprint = await vault.interface.readReserved(leafCaFingerprintPath(hostnames));
  if (!privateKeyPem || !certificatePem) {
    return null;
  }
  return { privateKeyPem, certificatePem, caFingerprint };
}

async function saveLeafCertificate(vault, hostnames, leaf, caFingerprint) {
  await vault.interface.writeReserved(leafPrivateKeyPath(hostnames), leaf.privateKeyPem);
  await vault.interface.writeReserved(leafCertificatePath(hostnames), leaf.certificatePem);
  await vault.interface.writeReserved(leafCaFingerprintPath(hostnames), caFingerprint);
}

function describeLeaf(leaf) {
  const privateKey = importPrivateKeyPem(leaf.privateKeyPem);
  const publicKey = publicKeyFromPrivateKey(privateKey);
  const certificate = parseCertificate(leaf.certificatePem);
  return Object.freeze({
    privateKeyPem: leaf.privateKeyPem,
    certificatePem: leaf.certificatePem,
    privateKey,
    publicKey,
    certificate,
  });
}

export async function getOrCreateLeafCertificate(vault, ca, hostnames = DEFAULT_LEAF_HOSTNAMES, options = {}) {
  const caFingerprint = ca.certificate.fingerprint256;
  const existing = await loadLeafCertificate(vault, hostnames);
  if (existing && existing.caFingerprint === caFingerprint) {
    return describeLeaf(existing);
  }
  const created = generateLeafCertificate(ca, hostnames, options);
  await saveLeafCertificate(vault, hostnames, created, caFingerprint);
  return describeLeaf(created);
}

export function tlsCredentialsFor(leaf, ca) {
  return {
    key: leaf.privateKeyPem,
    cert: leaf.certificatePem,
    ca: ca.certificatePem,
  };
}
