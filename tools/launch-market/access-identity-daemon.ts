import { chmodSync, chownSync, lstatSync, realpathSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyRequest } from 'fastify';
import { AccessIdentityBridge } from '../../apps/server/src/launch-market-adapters/access-identity.ts';
import {
  IDENTITY_SOCKET_MAX_BYTES,
  IDENTITY_SOCKET_PATH,
  IDENTITY_SOCKET_TIMEOUT_MS,
  identitySocketDirectory,
  identitySocketQuery,
  identitySocketResponse,
} from '../../apps/server/src/launch-market-adapters/access-identity-socket.ts';

export interface AccessIdentityDaemonOptions {
  readonly dbPath: string;
  readonly socketPath: string;
  readonly now?: () => number;
}
function privateIdentityDatabase(path: string): void {
  if (!isAbsolute(path) || path !== resolve(path) || realpathSync(dirname(path)) !== dirname(path))
    throw new Error('IDENTITY_DATABASE_UNSAFE_PATH');
  const db = lstatSync(path),
    parent = lstatSync(dirname(path));
  if (
    !db.isFile() ||
    db.nlink !== 1 ||
    db.uid !== process.getuid?.() ||
    (db.mode & 0o777) !== 0o600 ||
    !parent.isDirectory() ||
    parent.uid !== db.uid ||
    (parent.mode & 0o777) !== 0o700 ||
    realpathSync(path) !== path
  )
    throw new Error('IDENTITY_DATABASE_UNSAFE_FILE');
}

/** Runs under the existing authentication UID. Only bounded identities leave the private DB. */
export async function startAccessIdentityDaemon(options: AccessIdentityDaemonOptions) {
  privateIdentityDatabase(options.dbPath);
  const directory = identitySocketDirectory(options.socketPath);
  if (directory.uid !== process.getuid?.()) throw new Error('IDENTITY_SOCKET_OWNER_MISMATCH');
  try {
    lstatSync(options.socketPath);
    throw new Error('IDENTITY_SOCKET_ALREADY_EXISTS');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const bridge = new AccessIdentityBridge(options.dbPath, options.now);
  let active = true;
  const respond = (response: ServerResponse, status: number, identity: unknown = null) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      connection: 'close',
    });
    response.end(JSON.stringify({ identity }));
  };
  const handle = async (incoming: IncomingMessage, response: ServerResponse) => {
    if (
      !active ||
      incoming.method !== 'POST' ||
      incoming.url !== IDENTITY_SOCKET_PATH ||
      incoming.headers['content-type'] !== 'application/json' ||
      incoming.headers['content-encoding'] !== undefined
    ) {
      respond(response, 400);
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    const deadline = setTimeout(() => incoming.destroy(), IDENTITY_SOCKET_TIMEOUT_MS);
    try {
      for await (const chunk of incoming) {
        const part = Buffer.from(chunk as Uint8Array);
        bytes += part.length;
        if (bytes > IDENTITY_SOCKET_MAX_BYTES) {
          respond(response, 413);
          return;
        }
        chunks.push(part);
      }
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      let input: unknown;
      try {
        input = JSON.parse(decoded);
      } catch {
        respond(response, 400);
        return;
      }
      const query = identitySocketQuery(input);
      if (!query) {
        respond(response, 400);
        return;
      }
      const identity = bridge.identity({
        method: query.method,
        cookies: { '__Host-ikol_session': query.sessionToken },
        headers: query.csrfToken === null ? {} : { 'x-csrf-token': query.csrfToken },
      } as unknown as FastifyRequest);
      respond(response, 200, identitySocketResponse({ identity }));
    } catch {
      respond(response, 503);
    } finally {
      clearTimeout(deadline);
    }
  };
  const server = createServer(
    { maxHeaderSize: 4096, requestTimeout: IDENTITY_SOCKET_TIMEOUT_MS },
    (incoming, response) => {
      void handle(incoming, response);
    },
  );
  server.headersTimeout = IDENTITY_SOCKET_TIMEOUT_MS;
  server.keepAliveTimeout = IDENTITY_SOCKET_TIMEOUT_MS;
  server.maxRequestsPerSocket = 1;
  server.maxConnections = 100;
  server.on('connection', (socket) => {
    // Bound incomplete headers too; the HTTP request handler may not have run yet.
    const deadline = setTimeout(() => socket.destroy(), IDENTITY_SOCKET_TIMEOUT_MS);
    socket.once('close', () => clearTimeout(deadline));
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  const previousUmask = process.umask(0o077);
  try {
    await new Promise<void>((accept, reject) => {
      server.once('error', reject);
      server.listen(options.socketPath, () => {
        server.removeListener('error', reject);
        try {
          chownSync(options.socketPath, directory.uid, directory.gid);
          chmodSync(options.socketPath, 0o660);
          accept();
        } catch {
          reject(new Error('IDENTITY_SOCKET_PERMISSION_REJECTED'));
        }
      });
    });
  } catch {
    active = false;
    server.close();
    bridge.close();
    throw new Error('IDENTITY_DAEMON_STARTUP_REJECTED');
  } finally {
    process.umask(previousUmask);
  }
  return {
    async close(): Promise<void> {
      active = false;
      server.closeAllConnections();
      await new Promise<void>((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
      bridge.close();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const dbPath = process.env.AF_ACCESS_IDENTITY_DB,
      socketPath = process.env.AF_ACCESS_IDENTITY_SOCKET;
    if (!dbPath || !socketPath) throw new Error('IDENTITY_DAEMON_CONFIGURATION_REQUIRED');
    const daemon = await startAccessIdentityDaemon({ dbPath, socketPath });
    const stop = () => {
      void daemon.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    console.log('Verified identity socket ready. No credentials or identity records are logged.');
  } catch {
    console.error('IDENTITY_DAEMON_STARTUP_REJECTED');
    process.exitCode = 1;
  }
}
