// ship
// designed and built by onyxpowered.

// Duplicated from Interworks/Subworks/Mode.js rather than imported --
// Interworks' own Mode.js imports from Blockworks/ConfigSchema.js, so
// importing Interworks back from here would create a cross-Works cycle over
// one six-line pure function.
function slugifyAppName(appName) {
  return appName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Blocks are separate OS processes, not in-process objects -- "wiring up" a
// connector can't hand over a live JS reference. Instead, ship provisions
// whatever the connector needs (here: declaring the app's Vault role) and
// tells the Block where to find it over env vars. The Block reads/writes
// that same on-disk store directly, in the same encrypted format ship's own
// Vault uses -- no new IPC protocol, no daemon round-trip per read/write.
//
// What gets handed over is scoped to exactly this role: its own data
// directory (a subdirectory of the vault, not the vault root) and a key
// derived from the master key for this role alone (see Crypto.js's
// deriveRoleKey). The master key itself is never exposed here -- a Block
// with only its own derived key cannot compute any other app's role key, so
// one App's Block can no longer read another App's secrets (or ship's own
// reserved _ship secrets) just by having Vault access at all.
async function resolveVaultConnectorEnv(vault, appSlug) {
  await vault.interface.declareRole(appSlug);
  const [roleDataDir, roleKey] = await Promise.all([
    vault.interface.roleDataDir(appSlug),
    vault.interface.getRoleKey(appSlug),
  ]);
  return {
    SHIP_VAULT_ROLE_DIR: roleDataDir,
    SHIP_VAULT_ROLE_KEY: roleKey.toString('base64'),
  };
}

const RESOLVERS = Object.freeze({
  vault: resolveVaultConnectorEnv,
});

/**
 * One Vault role per App (not per Block) -- Blocks within the same App are
 * expected to share one secure store unless there's a real reason not to;
 * per-Block isolation can be revisited if that stops being true.
 */
export async function resolveConnectorEnv(vault, appName, connectorNames = []) {
  if (connectorNames.length === 0) return {};
  if (!vault) {
    throw new Error(`connectors [${connectorNames.join(', ')}] declared, but this daemon composition has no Vault`);
  }

  const appSlug = slugifyAppName(appName);
  let env = {};
  for (const name of connectorNames) {
    const resolver = RESOLVERS[name];
    if (!resolver) throw new Error(`no resolver registered for connector "${name}"`);
    env = { ...env, ...(await resolver(vault, appSlug)) };
  }
  return env;
}
