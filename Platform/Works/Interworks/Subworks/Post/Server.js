// ship
// designed and built by onyxpowered.

import { createServer as createHttpsServer } from 'node:https';
import { validateBlockHandle, blockOrigin } from '../Block.js';
import { streamProxyRequest, streamProxyUpgrade } from '../Routing/Proxy.js';

export function createPostServer({ leaf, blockHandle }) {
  validateBlockHandle(blockHandle);

  const server = createHttpsServer(
    { key: leaf.privateKeyPem, cert: leaf.certificatePem },
    (req, res) => streamProxyRequest(req, res, blockHandle),
  );

  server.on('upgrade', (req, socket, head) => streamProxyUpgrade(req, socket, head, blockHandle));

  return server;
}

export async function startPostServer({ leaf, blockHandle, port = 0, hostname = '127.0.0.1' }) {
  const server = createPostServer({ leaf, blockHandle });
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
    url: `https://${hostname}:${address.port}`,
    upstream: blockOrigin(blockHandle),
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  });
}
