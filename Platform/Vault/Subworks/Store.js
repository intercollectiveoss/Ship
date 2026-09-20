// ship
// designed and built by onyxpowered.

import { mkdir, readFile, writeFile, rm, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { generateKey, encrypt, decrypt, deriveRoleKey } from './Crypto.js';
import { RESERVED_ROLE } from './Interface.js';

const MASTER_KEY_FILE = 'master.key';
const ROLES_MANIFEST_FILE = 'roles.json';
const SEGMENT_PATTERN = /^[a-zA-Z0-9._-]+$/;
const ROLE_PATTERN = /^[a-z0-9_-]+$/;
const SECRET_FILE_MODE = 0o600;
const SECRET_DIR_MODE = 0o700;

function sanitizeRole(role) {
  if (typeof role !== 'string' || role.length === 0) {
    throw new Error('a Vault role must be a non-empty string');
  }
  if (!ROLE_PATTERN.test(role)) {
    throw new Error(`invalid Vault role: "${role}" (lowercase letters, digits, "_" and "-" only)`);
  }
  return role.toLowerCase();
}

function sanitizePathSegments(path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('a Vault path must be a non-empty string');
  }
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error('a Vault path must contain at least one segment');
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || !SEGMENT_PATTERN.test(segment)) {
      throw new Error(`invalid Vault path segment: "${segment}"`);
    }
  }
  return segments;
}

function roleDataFile(dataDir, role, path) {
  const segments = sanitizePathSegments(path);
  const last = segments.pop();
  return join(dataDir, role, ...segments, `${last}.json`);
}

async function loadOrCreateMasterKey(rootDir) {
  const keyPath = join(rootDir, MASTER_KEY_FILE);
  if (existsSync(keyPath)) {
    return readFile(keyPath);
  }
  const key = generateKey();
  try {
    await writeFile(keyPath, key, { mode: SECRET_FILE_MODE, flag: 'wx' });
    return key;
  } catch (error) {
    if (error.code === 'EEXIST') {
      return readFile(keyPath);
    }
    throw error;
  }
}

async function loadRolesManifest(rootDir) {
  const manifestPath = join(rootDir, ROLES_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return [];
  }
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.roles) ? parsed.roles : [];
}

async function writeJsonAtomic(filePath, data, pretty = false) {
  await mkdir(dirname(filePath), { recursive: true, mode: SECRET_DIR_MODE });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), {
    mode: SECRET_FILE_MODE,
  });
  await rename(tmpPath, filePath);
}

async function saveRolesManifest(rootDir, roles) {
  const manifestPath = join(rootDir, ROLES_MANIFEST_FILE);
  await writeJsonAtomic(manifestPath, { roles }, true);
}

async function dumpRolePaths(dataDir, role) {
  const roleDir = join(dataDir, role);
  if (!existsSync(roleDir)) return [];
  const paths = [];
  async function walk(dir, prefix) {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full, [...prefix, item.name]);
      } else if (item.name.endsWith('.json')) {
        const segment = item.name.slice(0, -5);
        paths.push([...prefix, segment].join('/'));
      }
    }
  }
  await walk(roleDir, []);
  return paths;
}

export async function createFileStore(vaultRootDir) {
  await mkdir(vaultRootDir, { recursive: true, mode: SECRET_DIR_MODE });
  const dataDir = join(vaultRootDir, 'roles');
  await mkdir(dataDir, { recursive: true, mode: SECRET_DIR_MODE });
  await mkdir(join(dataDir, RESERVED_ROLE), { recursive: true, mode: SECRET_DIR_MODE });

  const masterKey = await loadOrCreateMasterKey(vaultRootDir);
  const declaredRoles = new Set(await loadRolesManifest(vaultRootDir));

  function ensureRoleDeclared(role) {
    if (role !== RESERVED_ROLE.toLowerCase() && !declaredRoles.has(role)) {
      throw new Error(`role "${role}" has not been declared in this Vault`);
    }
  }

  function ensureNotReserved(role) {
    if (role === RESERVED_ROLE.toLowerCase()) {
      throw new Error(`"${role}" is the reserved _ship namespace and cannot be used as a declared role`);
    }
  }

  const store = {
    async declareRole(role) {
      const normalizedRole = sanitizeRole(role);
      ensureNotReserved(normalizedRole);
      if (declaredRoles.has(normalizedRole)) return;
      declaredRoles.add(normalizedRole);
      await mkdir(join(dataDir, normalizedRole), { recursive: true, mode: SECRET_DIR_MODE });
      await saveRolesManifest(vaultRootDir, [...declaredRoles]);
    },

    async wipeRole(role) {
      const normalizedRole = sanitizeRole(role);
      ensureNotReserved(normalizedRole);
      ensureRoleDeclared(normalizedRole);
      declaredRoles.delete(normalizedRole);
      await saveRolesManifest(vaultRootDir, [...declaredRoles]);
      await rm(join(dataDir, normalizedRole), { recursive: true, force: true });
    },

    async read(role, path) {
      const normalizedRole = sanitizeRole(role);
      ensureRoleDeclared(normalizedRole);
      const filePath = roleDataFile(dataDir, normalizedRole, path);
      if (!existsSync(filePath)) return undefined;
      const raw = await readFile(filePath, 'utf8');
      const record = JSON.parse(raw);
      const plaintext = decrypt(deriveRoleKey(masterKey, normalizedRole), {
        iv: Buffer.from(record.iv, 'base64'),
        authTag: Buffer.from(record.authTag, 'base64'),
        ciphertext: Buffer.from(record.ciphertext, 'base64'),
      });
      return JSON.parse(plaintext.toString('utf8'));
    },

    async write(role, path, value) {
      const normalizedRole = sanitizeRole(role);
      ensureRoleDeclared(normalizedRole);
      const filePath = roleDataFile(dataDir, normalizedRole, path);
      const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
      const { iv, authTag, ciphertext } = encrypt(deriveRoleKey(masterKey, normalizedRole), plaintext);
      await writeJsonAtomic(filePath, {
        v: 1,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      });
    },

    // The path to a role's own data directory, and the key that decrypts it
    // -- nothing else. Handed to code that must decrypt its own role without
    // a daemon round-trip (see Connectors.js) without also handing over the
    // master key, which would let the holder derive every other role's key.
    roleDataDir(role) {
      const normalizedRole = sanitizeRole(role);
      ensureRoleDeclared(normalizedRole);
      return join(dataDir, normalizedRole);
    },

    getRoleKey(role) {
      const normalizedRole = sanitizeRole(role);
      ensureRoleDeclared(normalizedRole);
      return deriveRoleKey(masterKey, normalizedRole);
    },

    async listRoles() {
      return [...declaredRoles];
    },

    async exportAll() {
      const roles = [RESERVED_ROLE.toLowerCase(), ...declaredRoles];
      const dump = {};
      for (const role of roles) {
        const paths = await dumpRolePaths(dataDir, role);
        dump[role] = [];
        for (const path of paths) {
          const value = await store.read(role, path);
          dump[role].push({ path, value });
        }
      }
      return dump;
    },

    async importAll(dump) {
      for (const [role, entries] of Object.entries(dump)) {
        if (role.toLowerCase() !== RESERVED_ROLE.toLowerCase()) {
          await store.declareRole(role);
        }
        for (const { path, value } of entries) {
          await store.write(role, path, value);
        }
      }
    },

    getMasterKey() {
      return masterKey;
    },
  };

  return store;
}
