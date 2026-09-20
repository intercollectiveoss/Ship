// ship
// designed and built by onyxpowered.

export function createEnforcedVault({ vaultInterface, role, declaredPaths, connectorName }) {
  if (vaultInterface == null || typeof vaultInterface.read !== 'function' || typeof vaultInterface.write !== 'function') {
    throw new Error('createEnforcedVault requires a Vault interface exposing read(role, path) and write(role, path, value)');
  }
  if (typeof role !== 'string' || role.length === 0) {
    throw new Error('createEnforcedVault requires a role');
  }
  const allowed = new Set(declaredPaths ?? []);

  function assertDeclared(path) {
    if (!allowed.has(path)) {
      const declaredList = [...allowed].join(', ') || 'none';
      throw new Error(
        `connector "${connectorName ?? role}" attempted to access undeclared Vault path "${path}" (declared paths: ${declaredList})`,
      );
    }
  }

  return Object.freeze({
    async read(path) {
      assertDeclared(path);
      return vaultInterface.read(role, path);
    },
    async write(path, value) {
      assertDeclared(path);
      return vaultInterface.write(role, path, value);
    },
  });
}
