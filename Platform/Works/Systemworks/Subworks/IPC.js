// ship
// designed and built by onyxpowered.

import { createServer, createConnection } from 'node:net';
import { existsSync, unlinkSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';

function frameMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

function createLineReader(socket, onMessage) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.length > 0) {
        try {
          onMessage(JSON.parse(line));
        } catch {}
      }
      index = buffer.indexOf('\n');
    }
  });
}

// This socket has no application-level authentication of its own -- anyone
// who can connect to it can deploy, stop, or shut down the daemon. On POSIX,
// connect access to a Unix socket is gated by filesystem permissions, so
// those have to actually be locked down rather than left at whatever the
// process umask defaults to: both the containing directory (nothing else
// guarantees $SHIP_HOME is private) and the socket file itself, since
// net.Server.listen() doesn't set either. There's no equivalent lockdown
// for a Windows named pipe here -- that trust boundary is left to whatever
// ACLs the pipe gets by default.
//
// The containing directory isn't always ship's own: Paths.js falls back to
// the OS's shared tmpdir when $SHIP_HOME's own socket path would be too
// long for the platform's sun_path limit. chmod-ing that directory is both
// pointless (it's shared by every other app's temp files, not something
// ship should be locking to 0700) and, on macOS, outright refused by the
// OS -- which previously crashed the daemon on startup instead of degrading
// gracefully. Only harden the directory when it's plausibly ship's own;
// either way the socket FILE itself always gets locked down below, which is
// what actually gates who can connect().
function securePosixSocketLocation(socketPath) {
  const dir = dirname(socketPath);
  const shipOwnedDir = dir !== tmpdir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (shipOwnedDir) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Best-effort: a shared system directory we don't own may refuse
      // this. The socket file's own mode, set after listen() below, is
      // the fix that actually matters.
    }
  }
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }
}

// A stale socket file (left behind by a daemon that crashed instead of
// shutting down cleanly) is safe to reclaim -- nothing is listening on it,
// so connecting fails immediately. A live one means another daemon is
// already bound here, and unlinking it out from under that process would
// silently orphan it: it keeps running, keeps holding the vault and every
// supervised Block, but becomes unreachable by any future `ship` command,
// since the socket path now points elsewhere.
//
// This checks at the connection level rather than round-tripping an actual
// IPC request/response: a busy daemon (e.g. mid health-check sweep across
// several Blocks) can be slow to answer application-level messages while
// still very much alive, and a response-timeout guard would misread that
// as dead and steal its socket anyway. A raw connect() succeeding is proof
// enough that something is bound to this path, independent of how quickly
// it gets around to replying.
export function isSocketListening(socketPath, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    const finish = (result) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    // can't confirm either way -- assume alive rather than risk orphaning a live daemon
    const timer = setTimeout(() => finish(true), timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function refuseIfDaemonAlreadyRunning(socketPath) {
  if (await isSocketListening(socketPath)) {
    throw new Error(
      `a ship daemon is already listening on ${socketPath} -- stop it first with \`ship daemon stop\``,
    );
  }
}

export async function startIpcServer(socketPath, requestHandler) {
  await refuseIfDaemonAlreadyRunning(socketPath);
  if (process.platform !== 'win32') {
    securePosixSocketLocation(socketPath);
  }
  const server = createServer((socket) => {
    createLineReader(socket, async (message) => {
      let response;
      try {
        const result = await requestHandler(message);
        response = { id: message.id, ok: true, result };
      } catch (error) {
        response = { id: message.id, ok: false, error: error.message };
      }
      socket.end(frameMessage(response));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      if (process.platform !== 'win32') {
        chmodSync(socketPath, 0o600);
      }
      resolve(server);
    });
  });
}

let requestCounter = 0;

export function sendIpcRequest(socketPath, request, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const id = `${process.pid}-${Date.now()}-${requestCounter++}`;
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('IPC request timed out'));
    }, timeoutMs);

    socket.once('connect', () => {
      socket.write(frameMessage({ ...request, id }));
    });

    createLineReader(socket, (message) => {
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.destroy();
      if (message.ok) {
        resolve(message.result);
      } else {
        reject(new Error(message.error));
      }
    });

    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
