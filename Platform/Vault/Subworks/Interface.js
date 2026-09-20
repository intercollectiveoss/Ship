// ship
// designed and built by onyxpowered.

export const RESERVED_ROLE = '_ship';

function isReservedRole(role) {
  return typeof role === 'string' && role.toLowerCase() === RESERVED_ROLE.toLowerCase();
}

export function createVaultInterface(backend) {
  return Object.freeze({
    async read(role, path) {
      if (isReservedRole(role)) {
        throw new Error('the _ship namespace cannot be read via a declared role');
      }
      return backend.read(role, path);
    },
    async write(role, path, value) {
      if (isReservedRole(role)) {
        throw new Error('the _ship namespace cannot be written via a declared role');
      }
      return backend.write(role, path, value);
    },
    async readReserved(path) {
      return backend.read(RESERVED_ROLE, path);
    },
    async writeReserved(path, value) {
      return backend.write(RESERVED_ROLE, path, value);
    },
    async declareRole(role) {
      if (isReservedRole(role)) {
        throw new Error('_ship is reserved and cannot be declared as a role');
      }
      return backend.declareRole(role);
    },
    async roleDataDir(role) {
      if (isReservedRole(role)) {
        throw new Error('the _ship namespace cannot be accessed via a declared role');
      }
      return backend.roleDataDir(role);
    },
    async getRoleKey(role) {
      if (isReservedRole(role)) {
        throw new Error('the _ship namespace cannot be accessed via a declared role');
      }
      return backend.getRoleKey(role);
    },
    async wipeRole(role) {
      if (isReservedRole(role)) {
        throw new Error('the _ship namespace cannot be wiped via a declared role');
      }
      return backend.wipeRole(role);
    },
  });
}
