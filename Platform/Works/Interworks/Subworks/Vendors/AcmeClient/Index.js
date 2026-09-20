// ship
// designed and built by onyxpowered.

import { createAcmeClient, acmeError } from './Client.js';

export { createAcmeClient, acmeError };
export { signJws } from './Jws.js';
export { acmeRequest, nonceFromHeaders, locationFromHeaders, linksFromHeaders } from './Http.js';

async function noop() {}

export async function issueCertificate({
  directoryUrl,
  accountKey,
  altNames,
  commonName = altNames[0],
  leafKey,
  fulfillChallenge,
  removeChallenge = noop,
  contact = [],
  existingKid = null,
  pollOptions = {},
  fetchImpl = fetch,
}) {
  if (typeof fulfillChallenge !== 'function') {
    throw new Error('issueCertificate requires a fulfillChallenge(challenge, keyAuthorization, authorization) function');
  }

  const client = createAcmeClient({ directoryUrl, accountKey, fetchImpl });

  if (existingKid) {
    client.useExistingAccount(existingKid);
  } else {
    await client.createAccount({ contact });
  }

  const { orderUrl, order } = await client.createOrder(altNames);
  const fulfilled = [];

  try {
    for (const authorizationUrl of order.authorizations) {
      const authorization = await client.getAuthorization(authorizationUrl);
      const challenge = authorization.challenges.find((candidate) => candidate.type === 'http-01');
      if (!challenge) {
        throw new Error(`no http-01 challenge offered for identifier ${JSON.stringify(authorization.identifier)}`);
      }

      const keyAuthorization = client.keyAuthorizationFor(challenge.token);
      await fulfillChallenge(challenge, keyAuthorization, authorization);
      fulfilled.push({ challenge, authorization });

      await client.respondToChallenge(challenge.url);
    }

    const readyOrder = await client.waitForOrderReady(orderUrl, pollOptions);
    await client.finalizeOrder(readyOrder, {
      leafPrivateKey: leafKey.privateKey,
      leafPublicKey: leafKey.publicKey,
      commonName,
      altNames,
    });

    const validOrder = await client.waitForOrderValid(orderUrl, pollOptions);
    const certificateChainPem = await client.downloadCertificate(validOrder.certificate);

    return Object.freeze({ certificateChainPem, kid: client.getKid() });
  } finally {
    for (const { challenge, authorization } of fulfilled) {
      await removeChallenge(challenge, authorization).catch(() => {});
    }
  }
}
