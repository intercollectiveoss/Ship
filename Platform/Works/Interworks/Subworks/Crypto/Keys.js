// ship
// designed and built by onyxpowered.

import { generateKeyPairSync, createPublicKey, createPrivateKey, createHash, sign as cryptoSign } from 'node:crypto';

export function generateRsaKeyPair(modulusLength = 2048) {
  return generateKeyPairSync('rsa', { modulusLength });
}

export function generateEcKeyPair(namedCurve = 'P-256') {
  return generateKeyPairSync('ec', { namedCurve });
}

export function exportPrivateKeyPem(privateKey) {
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

export function importPrivateKeyPem(pem) {
  return createPrivateKey(pem);
}

export function importPublicKeyPem(pem) {
  return createPublicKey(pem);
}

export function publicKeyFromPrivateKey(privateKey) {
  return createPublicKey(privateKey);
}

export function exportPublicKeySpkiDer(publicKey) {
  return publicKey.export({ type: 'spki', format: 'der' });
}

function sortedJwk(jwk) {
  return Object.keys(jwk)
    .sort()
    .reduce((result, key) => {
      result[key] = jwk[key];
      return result;
    }, {});
}

export function getJwk(publicKey) {
  return sortedJwk(publicKey.export({ format: 'jwk' }));
}

const THUMBPRINT_MEMBERS = {
  RSA: ['e', 'kty', 'n'],
  EC: ['crv', 'kty', 'x', 'y'],
  OKP: ['crv', 'kty', 'x'],
};

export function jwkThumbprint(jwk) {
  const members = THUMBPRINT_MEMBERS[jwk.kty];
  if (!members) {
    throw new Error(`unsupported JWK kty for thumbprint: ${jwk.kty}`);
  }
  const canonical = {};
  for (const member of members) {
    canonical[member] = jwk[member];
  }
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json, 'utf8').digest('base64url');
}

const EC_CURVE_ALGORITHMS = {
  'P-256': { hash: 'sha256', oid: '1.2.840.10045.4.3.2' },
  'P-384': { hash: 'sha384', oid: '1.2.840.10045.4.3.3' },
  'P-521': { hash: 'sha512', oid: '1.2.840.10045.4.3.4' },
};

export function signatureAlgorithmForKey(publicKey) {
  if (publicKey.asymmetricKeyType === 'rsa') {
    return { hash: 'sha256', oid: '1.2.840.113549.1.1.11', jwsAlg: 'RS256' };
  }
  if (publicKey.asymmetricKeyType === 'ec') {
    const jwk = getJwk(publicKey);
    const entry = EC_CURVE_ALGORITHMS[jwk.crv];
    if (!entry) {
      throw new Error(`unsupported EC curve for signing: ${jwk.crv}`);
    }
    const jwsAlg = { sha256: 'ES256', sha384: 'ES384', sha512: 'ES512' }[entry.hash];
    return { hash: entry.hash, oid: entry.oid, jwsAlg, curve: jwk.crv };
  }
  throw new Error(`unsupported key type for signing: ${publicKey.asymmetricKeyType}`);
}

export function signTbs(privateKey, tbsDer) {
  const publicKey = createPublicKey(privateKey);
  const { hash } = signatureAlgorithmForKey(publicKey);
  return cryptoSign(hash, tbsDer, privateKey);
}
