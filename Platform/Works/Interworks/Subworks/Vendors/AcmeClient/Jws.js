// ship
// designed and built by onyxpowered.

import { sign as cryptoSign } from 'node:crypto';
import { getJwk, signatureAlgorithmForKey } from '../../Crypto/Keys.js';

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString('base64url');
}

export function signJws({ privateKey, publicKey, payload, url, nonce = null, kid = null }) {
  const { hash, jwsAlg } = signatureAlgorithmForKey(publicKey);
  const header = { alg: jwsAlg, url };
  if (nonce) {
    header.nonce = nonce;
  }
  if (kid) {
    header.kid = kid;
  } else {
    header.jwk = getJwk(publicKey);
  }

  const protectedHeader = base64url(JSON.stringify(header));
  const encodedPayload = payload === '' ? '' : base64url(JSON.stringify(payload));
  const signingInput = Buffer.from(`${protectedHeader}.${encodedPayload}`);

  const isEc = publicKey.asymmetricKeyType === 'ec';
  const signOptions = isEc ? { key: privateKey, dsaEncoding: 'ieee-p1363' } : privateKey;
  const signature = cryptoSign(hash, signingInput, signOptions);

  return {
    protected: protectedHeader,
    payload: encodedPayload,
    signature: base64url(signature),
  };
}
