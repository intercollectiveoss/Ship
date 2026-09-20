// ship
// designed and built by onyxpowered.

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { streamProxyRequest, streamProxyUpgrade } from './Proxy.js';
import { attemptPortForward } from './PortForward.js';
import { validateBlockHandle, blockOrigin } from '../Block.js';
import { issueCertificate } from '../Vendors/AcmeClient/Index.js';
import { exportPrivateKeyPem } from '../Crypto/Keys.js';

export const LETS_ENCRYPT_DIRECTORY_URL = 'https://acme-v02.api.letsencrypt.org/directory';
const HTTP01_CHALLENGE_PATH_PREFIX = '/.well-known/acme-challenge/';

export function createHttp01ChallengeServer() {
  const tokens = new Map();

  const server = createHttpServer((req, res) => {
    if (!req.url.startsWith(HTTP01_CHALLENGE_PATH_PREFIX)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const token = req.url.slice(HTTP01_CHALLENGE_PATH_PREFIX.length);
    const keyAuthorization = tokens.get(token);
    if (!keyAuthorization) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(keyAuthorization);
  });

  return Object.freeze({
    server,
    setToken: (token, keyAuthorization) => tokens.set(token, keyAuthorization),
    clearToken: (token) => tokens.delete(token),
    listen: (port = 80, hostname = '0.0.0.0') => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, hostname, () => {
        server.removeListener('error', reject);
        resolve(server.address());
      });
    }),
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  });
}

export async function issueProductionCertificate({
  domain,
  altNames = [domain],
  accountKey,
  leafKey,
  directoryUrl = LETS_ENCRYPT_DIRECTORY_URL,
  contact = [],
  existingKid = null,
  challengeServerPort = 80,
  challengeServerHost = '0.0.0.0',
  challengeServerFactory = createHttp01ChallengeServer,
  pollOptions,
  fetchImpl,
}) {
  const challengeServer = challengeServerFactory();
  await challengeServer.listen(challengeServerPort, challengeServerHost);
  try {
    return await issueCertificate({
      directoryUrl,
      accountKey,
      altNames,
      commonName: domain,
      leafKey,
      contact,
      existingKid,
      pollOptions,
      fetchImpl,
      fulfillChallenge: async (challenge, keyAuthorization) => {
        challengeServer.setToken(challenge.token, keyAuthorization);
      },
      removeChallenge: async (challenge) => {
        challengeServer.clearToken(challenge.token);
      },
    });
  } finally {
    await challengeServer.close();
  }
}

export function createProductionServer({ certificatePem, privateKeyPem, blockHandle }) {
  validateBlockHandle(blockHandle);

  const server = createHttpsServer(
    { key: privateKeyPem, cert: certificatePem },
    (req, res) => streamProxyRequest(req, res, blockHandle),
  );
  server.on('upgrade', (req, socket, head) => streamProxyUpgrade(req, socket, head, blockHandle));
  return server;
}

export async function startProductionServer({ certificatePem, privateKeyPem, blockHandle, port = 443, hostname = '0.0.0.0' }) {
  const server = createProductionServer({ certificatePem, privateKeyPem, blockHandle });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return Object.freeze({
    server,
    port: address.port,
    hostname,
    upstream: blockOrigin(blockHandle),
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  });
}

export async function bootstrapProductionRouting({
  domain,
  altNames,
  accountKey,
  leafKey,
  blockHandle,
  contact = [],
  directoryUrl = LETS_ENCRYPT_DIRECTORY_URL,
  httpsPort = 443,
  challengePort = 80,
  attemptForwarding = true,
  portForwardOptions = {},
  challengeServerFactory,
  pollOptions,
  fetchImpl,
  existingKid = null,
}) {
  validateBlockHandle(blockHandle);

  let portForwardResults = null;
  if (attemptForwarding) {
    portForwardResults = {
      https: await attemptPortForward(httpsPort, portForwardOptions),
      challenge: await attemptPortForward(challengePort, portForwardOptions),
    };
    // A router can grant UPnP/NAT-PMP a DIFFERENT external port than the one
    // requested -- most often because the requested port is already taken
    // externally by something else (very commonly the router's own admin UI
    // squatting on 80). That's not "forwarding failed" (attemptPortForward
    // wouldn't report a mechanism at all in that case, and we don't treat
    // that as fatal here either -- the ports may simply already be forwarded
    // by hand). It's a mapping that unambiguously will never work for ACME's
    // HTTP-01 challenge or for a browser connecting to the default HTTPS
    // port, both of which require the exact port, not just *a* port. Catch
    // it here with a clear, actionable message instead of letting a doomed
    // ACME order fail minutes later with an opaque "resource became invalid".
    for (const [label, port, result] of [
      ['HTTPS', httpsPort, portForwardResults.https],
      ['ACME HTTP-01 challenge', challengePort, portForwardResults.challenge],
    ]) {
      if (result.mechanism && result.port !== port) {
        throw new Error(
          `Automatic port forwarding (${result.mechanism}) mapped external port ${result.port} instead of the requested ${port} for ${label} -- your router granted a different port, almost certainly because ${port} is already in use externally (a common cause: the router's own admin UI listens on port 80). ACME and a browser's default port both require the exact port, so this can't proceed automatically. Free up port ${port} on your router (or move its admin UI off it) and try again, or configure port forwarding for ${port} manually instead of relying on UPnP/NAT-PMP.`,
        );
      }
    }
  }

  const { certificateChainPem, kid } = await issueProductionCertificate({
    domain,
    altNames: altNames ?? [domain],
    accountKey,
    leafKey,
    directoryUrl,
    contact,
    existingKid,
    challengeServerPort: challengePort,
    challengeServerFactory,
    pollOptions,
    fetchImpl,
  });

  const running = await startProductionServer({
    certificatePem: certificateChainPem,
    privateKeyPem: exportPrivateKeyPem(leafKey.privateKey),
    blockHandle,
    port: httpsPort,
  });

  return Object.freeze({ ...running, url: `https://${domain}`, kid, certificateChainPem, portForwardResults });
}
