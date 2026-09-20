// ship
// designed and built by onyxpowered.

import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { validateBlockHandle } from '../Block.js';

const BAD_GATEWAY_BODY = 'ship: the Block behind this route is not reachable.';

// Blocks see this proxy's own socket as the connecting peer unless told
// otherwise -- any Block doing IP-based logic (rate limiting, blocklists,
// geo checks) needs the real chain, not ship's loopback.
//
// This proxy is always the FIRST hop for whoever is connecting here (a
// direct internet client in Production/PortForward mode, or a local client
// in Post mode) -- there is no upstream proxy of ship's own to chain with.
// So these three headers are always set from what ship itself observed on
// this socket, never from whatever the client sent: trusting an incoming
// x-forwarded-* header here would let any client spoof its own IP/host/proto
// to a Block that trusts these for rate limiting, allow-listing, or logging.
// req.headers.host is also allowed to be absent (a bare HTTP/1.0 request
// with no Host header is valid input, not malformed) -- falling back to ''
// keeps every value here a string, since Node's http.request throws
// synchronously on an `undefined` header value, which previously let one
// Host-less request crash the whole daemon.
function forwardedHeaders(req) {
  const clientIp = req.socket.remoteAddress ?? '';
  return {
    ...req.headers,
    'x-forwarded-for': clientIp,
    'x-forwarded-proto': req.socket.encrypted ? 'https' : 'http',
    'x-forwarded-host': req.headers.host ?? '',
  };
}

function sendBadGateway(res) {
  if (!res.headersSent) {
    res.writeHead(502, { 'content-type': 'text/plain' });
  }
  res.end(BAD_GATEWAY_BODY);
}

export function streamProxyRequest(req, res, blockHandle) {
  validateBlockHandle(blockHandle);

  // http.request() validates its headers option synchronously and throws
  // before returning if anything about this specific request is malformed
  // (an invalid header value, an unparseable method) -- one bad request
  // must become a 502 to its own caller, not an uncaught exception that
  // takes every other Block on this daemon down with it.
  let upstream;
  try {
    upstream = httpRequest(
      {
        host: blockHandle.host,
        port: blockHandle.port,
        method: req.method,
        path: req.url,
        headers: forwardedHeaders(req),
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.statusMessage, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
  } catch {
    sendBadGateway(res);
    return;
  }

  upstream.on('error', () => sendBadGateway(res));

  req.pipe(upstream);
}

export function streamProxyUpgrade(req, clientSocket, head, blockHandle) {
  validateBlockHandle(blockHandle);

  const upstreamSocket = netConnect(blockHandle.port, blockHandle.host, () => {
    try {
      const headerLines = Object.entries(forwardedHeaders(req)).map(([key, value]) => `${key}: ${value}`);
      const requestLine = `${req.method} ${req.url} HTTP/1.1`;
      upstreamSocket.write(`${[requestLine, ...headerLines].join('\r\n')}\r\n\r\n`);
      if (head && head.length > 0) {
        upstreamSocket.write(head);
      }
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    } catch {
      clientSocket.end();
      upstreamSocket.end();
    }
  });

  upstreamSocket.on('error', () => {
    clientSocket.end();
  });
  clientSocket.on('error', () => {
    upstreamSocket.end();
  });
}

export async function bufferedProxyRequest(blockHandle, { method, url, headers = {}, body = null }) {
  validateBlockHandle(blockHandle);

  return new Promise((resolve, reject) => {
    const upstream = httpRequest(
      {
        host: blockHandle.host,
        port: blockHandle.port,
        method,
        path: url,
        headers,
      },
      (upstreamRes) => {
        const chunks = [];
        upstreamRes.on('data', (chunk) => chunks.push(chunk));
        upstreamRes.on('end', () => {
          resolve({
            statusCode: upstreamRes.statusCode,
            headers: upstreamRes.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );

    upstream.on('error', reject);
    if (body && body.length > 0) {
      upstream.write(body);
    }
    upstream.end();
  });
}

export function createBlockRequestHandler(blockHandle) {
  return async (request) => bufferedProxyRequest(blockHandle, request);
}
