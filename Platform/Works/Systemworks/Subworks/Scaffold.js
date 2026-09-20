// ship
// designed and built by onyxpowered.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_PORT = 4227;

const ENTRY_FILE = `import { createServer } from 'node:http';

const port = process.env.PORT || ${DEFAULT_PORT};

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('shipped.');
});

server.listen(port, () => {
  console.log(\`listening on \${port}\`);
});
`;

const PACKAGE_JSON = (name) =>
  JSON.stringify(
    {
      name,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: { start: 'node index.js' },
    },
    null,
    2,
  ) + '\n';

const SHIP_CONFIG = `export default {
  blocks: {
    web: {
      command: 'npm start',
      expose: true,
      healthCheck: { port: ${DEFAULT_PORT} },
    },
  },
};
`;

export async function scaffoldNewApp(appName, destinationDir) {
  if (!appName || typeof appName !== 'string') {
    throw new Error('ship new requires an app name');
  }
  // destinationDir is always homedir()-joined with this name (see CLI.js) so
  // that `ship new` can never land outside ~ -- a name containing a path
  // separator or ".." would defeat that on join()/resolve(), which silently
  // honors them instead of treating the name as a single path segment.
  if (/[\\/]/.test(appName) || appName === '.' || appName === '..') {
    throw new Error(`invalid app name "${appName}" -- app names cannot contain path separators`);
  }
  if (existsSync(destinationDir)) {
    throw new Error(`${destinationDir} already exists`);
  }

  await mkdir(destinationDir, { recursive: true });
  await writeFile(join(destinationDir, 'index.js'), ENTRY_FILE);
  await writeFile(join(destinationDir, 'package.json'), PACKAGE_JSON(appName));
  await writeFile(join(destinationDir, 'ship.config.js'), SHIP_CONFIG);

  return Object.freeze({ appName, appRootDir: destinationDir });
}
