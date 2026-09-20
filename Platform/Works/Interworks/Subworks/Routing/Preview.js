// ship
// designed and built by onyxpowered.

import { createTunnelClient } from '../Tunnel/Client.js';
import { createBlockRequestHandler } from './Proxy.js';
import { validateBlockHandle } from '../Block.js';

export const DEFAULT_PREVIEW_DOMAIN = 'preview.onyxpowered.com';
export const SHIP_BASE_PATH_ENV_VAR = 'SHIP_BASE_PATH';

export function previewPath(appSlug) {
  if (typeof appSlug !== 'string' || appSlug.length === 0) {
    throw new Error('previewPath requires a non-empty appSlug');
  }
  return `/${appSlug}`;
}

export function previewUrl(appSlug, previewDomain = DEFAULT_PREVIEW_DOMAIN) {
  return `https://${previewDomain}${previewPath(appSlug)}`;
}

export function shipBasePathEnv(appSlug) {
  return Object.freeze({ [SHIP_BASE_PATH_ENV_VAR]: previewPath(appSlug) });
}

export function mergeBlockEnv(existingEnv, appSlug) {
  return Object.freeze({ ...existingEnv, ...shipBasePathEnv(appSlug) });
}

export function createPreviewTunnel({
  servicesUrl,
  token,
  appSlug,
  blockHandle,
  previewDomain = DEFAULT_PREVIEW_DOMAIN,
  WebSocketImpl,
  reconnect,
}) {
  validateBlockHandle(blockHandle);

  const tunnel = createTunnelClient({
    url: servicesUrl,
    token,
    appSlug,
    mode: 'preview',
    requestHandler: createBlockRequestHandler(blockHandle),
    ...(WebSocketImpl ? { WebSocketImpl } : {}),
    ...(reconnect ? { reconnect } : {}),
  });

  let assignedPreviewUrl = null;
  tunnel.on('helloAck', (message) => {
    if (message.previewUrl) {
      assignedPreviewUrl = message.previewUrl;
    }
  });

  return Object.freeze({
    tunnel,
    expectedPreviewUrl: previewUrl(appSlug, previewDomain),
    assignedPreviewUrl: () => assignedPreviewUrl,
    isConnected: tunnel.isConnected,
    close: tunnel.close,
  });
}
