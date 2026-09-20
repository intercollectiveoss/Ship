// ship
// designed and built by onyxpowered.

import { acmeRequest, nonceFromHeaders, locationFromHeaders } from './Http.js';
import { signJws } from './Jws.js';
import { getJwk, jwkThumbprint } from '../../Crypto/Keys.js';
import { buildCsr } from '../../Crypto/X509.js';
import { decodePem } from '../../Crypto/Pem.js';

const MAX_BAD_NONCE_RETRIES = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function acmeError(status, data) {
  const detail = data && typeof data === 'object' ? data.detail ?? JSON.stringify(data) : String(data);
  const error = new Error(`ACME request failed with status ${status}: ${detail}`);
  error.status = status;
  error.data = data;
  return error;
}

export function createAcmeClient({ directoryUrl, accountKey, fetchImpl = fetch }) {
  const { privateKey, publicKey } = accountKey;
  let directoryCache = null;
  let nonceCache = null;
  let kid = null;

  async function getDirectory() {
    if (!directoryCache) {
      const resp = await acmeRequest(directoryUrl, { fetchImpl });
      if (resp.status >= 400) {
        throw acmeError(resp.status, resp.data);
      }
      directoryCache = resp.data;
    }
    return directoryCache;
  }

  async function freshNonce() {
    const dir = await getDirectory();
    const resp = await acmeRequest(dir.newNonce, { method: 'HEAD', fetchImpl });
    const nonce = nonceFromHeaders(resp.headers);
    if (!nonce) {
      throw new Error('ACME server did not return a replay-nonce from newNonce');
    }
    return nonce;
  }

  async function takeNonce() {
    if (nonceCache) {
      const nonce = nonceCache;
      nonceCache = null;
      return nonce;
    }
    return freshNonce();
  }

  function captureNonce(resp) {
    const nonce = nonceFromHeaders(resp.headers);
    if (nonce) {
      nonceCache = nonce;
    }
  }

  async function signedRequest(url, payload, attempt = 0) {
    const nonce = await takeNonce();
    const body = signJws({ privateKey, publicKey, payload, url, nonce, kid });
    const resp = await acmeRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/jose+json' },
      body: JSON.stringify(body),
      fetchImpl,
    });
    captureNonce(resp);

    const isBadNonce = resp.status === 400 && resp.data && resp.data.type === 'urn:ietf:params:acme:error:badNonce';
    if (isBadNonce && attempt < MAX_BAD_NONCE_RETRIES) {
      return signedRequest(url, payload, attempt + 1);
    }
    return resp;
  }

  async function createAccount({ termsOfServiceAgreed = true, contact = [] } = {}) {
    const dir = await getDirectory();
    const resp = await signedRequest(dir.newAccount, { termsOfServiceAgreed, contact });
    if (resp.status >= 400) {
      throw acmeError(resp.status, resp.data);
    }
    kid = locationFromHeaders(resp.headers);
    return { kid, account: resp.data };
  }

  function useExistingAccount(existingKid) {
    kid = existingKid;
  }

  async function createOrder(identifiers) {
    const dir = await getDirectory();
    const resp = await signedRequest(dir.newOrder, {
      identifiers: identifiers.map((value) => ({ type: 'dns', value })),
    });
    if (resp.status >= 400) {
      throw acmeError(resp.status, resp.data);
    }
    return { orderUrl: locationFromHeaders(resp.headers), order: resp.data };
  }

  async function fetchResource(url) {
    const resp = await signedRequest(url, '');
    if (resp.status >= 400) {
      throw acmeError(resp.status, resp.data);
    }
    return resp.data;
  }

  async function getAuthorization(authorizationUrl) {
    return fetchResource(authorizationUrl);
  }

  function keyAuthorizationFor(token) {
    const thumbprint = jwkThumbprint(getJwk(publicKey));
    return `${token}.${thumbprint}`;
  }

  async function respondToChallenge(challengeUrl) {
    const resp = await signedRequest(challengeUrl, {});
    if (resp.status >= 400) {
      throw acmeError(resp.status, resp.data);
    }
    return resp.data;
  }

  async function pollUntil(url, predicate, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const resource = await fetchResource(url);
      if (predicate(resource)) {
        return resource;
      }
      if (resource.status === 'invalid') {
        throw new Error(`ACME resource became invalid: ${JSON.stringify(resource)}`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ACME resource to be ready: ${url}`);
      }
      await sleep(intervalMs);
    }
  }

  async function waitForOrderReady(orderUrl, options) {
    return pollUntil(orderUrl, (order) => order.status === 'ready', options);
  }

  async function waitForOrderValid(orderUrl, options) {
    return pollUntil(orderUrl, (order) => order.status === 'valid', options);
  }

  async function finalizeOrder(order, { leafPrivateKey, leafPublicKey, commonName = null, altNames }) {
    const csrPem = buildCsr({ privateKey: leafPrivateKey, publicKey: leafPublicKey, commonName, altNames });
    const { der } = decodePem(csrPem, 'CERTIFICATE REQUEST');
    const resp = await signedRequest(order.finalize, { csr: der.toString('base64url') });
    if (resp.status >= 400) {
      throw acmeError(resp.status, resp.data);
    }
    return resp.data;
  }

  async function downloadCertificate(certificateUrl) {
    return fetchResource(certificateUrl);
  }

  return Object.freeze({
    getDirectory,
    createAccount,
    useExistingAccount,
    createOrder,
    getAuthorization,
    keyAuthorizationFor,
    respondToChallenge,
    waitForOrderReady,
    waitForOrderValid,
    finalizeOrder,
    downloadCertificate,
    getKid: () => kid,
  });
}
