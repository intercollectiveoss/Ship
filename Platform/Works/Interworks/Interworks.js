// ship
// designed and built by onyxpowered.

export const VERSION = '0.1.0';

export { MODES, MODE_NAMES, isValidMode, resolveInterworksTarget, slugifyAppName } from './Subworks/Mode.js';

export {
  validateBlockHandle,
  waitUntilReady,
  createStaticBlockHandle,
  blockOrigin,
} from './Subworks/Block.js';

export {
  getDaemonToken,
  setDaemonToken,
  clearDaemonToken,
  requireDaemonToken,
  hasDaemonToken,
  authorizationHeader,
  resolveServicesUrl,
} from './Subworks/Auth.js';

export {
  computeArtifactIntegrity,
  deployArtifact,
  verifyArtifactIntegrity,
  integrityManifestPath,
} from './Subworks/Artifact.js';

export { getOrCreateCa, rotateCa } from './Subworks/Post/Ca.js';
export { getOrCreateLeafCertificate, DEFAULT_LEAF_HOSTNAMES } from './Subworks/Post/Leaf.js';
export { installCaTrust, uninstallCaTrust, manualTrustInstructions } from './Subworks/Post/Trust.js';
export { startPostServer } from './Subworks/Post/Server.js';

export { createTunnelClient } from './Subworks/Tunnel/Client.js';

export {
  DEFAULT_PREVIEW_DOMAIN,
  SHIP_BASE_PATH_ENV_VAR,
  previewPath,
  previewUrl,
  shipBasePathEnv,
  mergeBlockEnv,
  createPreviewTunnel,
} from './Subworks/Routing/Preview.js';

export { attemptPortForward, manualPortForwardInstructions } from './Subworks/Routing/PortForward.js';

export {
  LETS_ENCRYPT_DIRECTORY_URL,
  issueProductionCertificate,
  bootstrapProductionRouting,
} from './Subworks/Routing/Production.js';

export {
  getOrCreateAcmeAccountKey,
  getAcmeAccountKid,
  saveAcmeAccountKid,
  getOrCreateProductionLeafKey,
} from './Subworks/Routing/ProductionAccount.js';

import { MODES } from './Subworks/Mode.js';
import { getOrCreateCa } from './Subworks/Post/Ca.js';
import { getOrCreateLeafCertificate } from './Subworks/Post/Leaf.js';
import { startPostServer } from './Subworks/Post/Server.js';
import { createPreviewTunnel } from './Subworks/Routing/Preview.js';
import { bootstrapProductionRouting } from './Subworks/Routing/Production.js';
import {
  getOrCreateAcmeAccountKey,
  getAcmeAccountKid,
  saveAcmeAccountKid,
  getOrCreateProductionLeafKey,
} from './Subworks/Routing/ProductionAccount.js';

export async function startInterworks(target) {
  if (target.mode === MODES.POST) {
    const ca = await getOrCreateCa(target.vault, target.caOptions);
    const leaf = await getOrCreateLeafCertificate(target.vault, ca, target.hostnames, target.leafOptions);
    return startPostServer({ leaf, blockHandle: target.blockHandle, port: target.port, hostname: target.hostname });
  }
  if (target.mode === MODES.PREVIEW) {
    return createPreviewTunnel({
      servicesUrl: target.servicesUrl,
      token: target.token,
      appSlug: target.appSlug,
      blockHandle: target.blockHandle,
      previewDomain: target.previewDomain,
      reconnect: target.reconnect,
    });
  }
  if (target.mode === MODES.PRODUCTION) {
    if (!target.domain) {
      throw new Error('Production mode requires a domain');
    }
    // One ACME account and one leaf key per domain persist across deploys
    // (in the vault's reserved namespace, alongside the daemon's own
    // secrets) so a redeploy or a renewal reuses the same registered
    // account and key instead of hitting Let's Encrypt's newAccount/newOrder
    // rate limits on every restart.
    const [accountKey, leafKey, existingKid] = await Promise.all([
      getOrCreateAcmeAccountKey(target.vault),
      getOrCreateProductionLeafKey(target.vault, target.domain),
      getAcmeAccountKid(target.vault),
    ]);
    const result = await bootstrapProductionRouting({
      domain: target.domain,
      altNames: target.altNames ?? [target.domain],
      accountKey,
      leafKey,
      blockHandle: target.blockHandle,
      contact: target.contact ?? [],
      directoryUrl: target.directoryUrl,
      httpsPort: target.httpsPort,
      challengePort: target.challengePort,
      attemptForwarding: target.attemptForwarding,
      portForwardOptions: target.portForwardOptions,
      existingKid,
    });
    await saveAcmeAccountKid(target.vault, result.kid);
    return result;
  }
  throw new Error(`unknown Interworks mode: ${target.mode}`);
}
