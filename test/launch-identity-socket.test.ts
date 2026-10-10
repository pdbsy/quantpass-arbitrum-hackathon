import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  AccessIdentitySocketClient,
  IDENTITY_SOCKET_MAX_BYTES,
  identitySocketQuery,
  identitySocketResponse,
} from '../apps/server/src/launch-market-adapters/access-identity-socket.ts';
import { startAccessIdentityDaemon } from '../tools/launch-market/access-identity-daemon.ts';
import { startMarketServer } from '../tools/launch-market/server.ts';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'af-identity-socket-')),
    databaseDirectory = join(root, 'private'),
    socketDirectory = join(root, 'socket');
  mkdirSync(databaseDirectory, { mode: 0o700 });
  mkdirSync(socketDirectory, { mode: 0o710 });
  const dbPath = join(databaseDirectory, 'access.sqlite'),
    socketPath = join(socketDirectory, 'identity.sock'),
    db = new DatabaseSync(dbPath);
  chmodSync(dbPath, 0o600);
  db.exec(`CREATE TABLE whitelist(email TEXT PRIMARY KEY);
    CREATE TABLE identities(email TEXT PRIMARY KEY,subject TEXT UNIQUE);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,subject TEXT,csrf_token TEXT,expires_at INTEGER);
    CREATE TABLE revoked_sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER);`);
  const sessionToken = randomBytes(32).toString('base64url'),
    websiteToken = randomBytes(32).toString('base64url'),
    csrfToken = randomBytes(24).toString('base64url'),
    tokenHash = createHash('sha256').update(sessionToken).digest('hex'),
    websiteHash = createHash('sha256').update(websiteToken).digest('hex');
  db.prepare('INSERT INTO whitelist VALUES (?)').run('fixture@example.test');
  db.prepare('INSERT INTO identities VALUES (?,?)').run('fixture@example.test', 'fixture-google-subject');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(
    tokenHash,
    'fixture@example.test',
    'fixture-google-subject',
    csrfToken,
    1100,
  );
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(websiteHash, null, null, csrfToken, 1100);
  let now = 1000;
  const daemon = await startAccessIdentityDaemon({ dbPath, socketPath, now: () => now }),
    client = new AccessIdentitySocketClient(socketPath);
  const incoming = (method = 'GET', token = sessionToken, csrf: string | null = null) => ({
    method,
    cookies: { '__Host-ikol_session': token },
    headers: csrf === null ? {} : { 'x-csrf-token': csrf },
  });
  return {
    root,
    db,
    dbPath,
    socketPath,
    sessionToken,
    websiteToken,
    csrfToken,
    tokenHash,
    daemon,
    client,
    incoming,
    setNow: (value: number) => {
      now = value;
    },
    async close() {
      await daemon.close();
      db.close();
      rmSync(root, { recursive: true });
    },
  };
}
async function raw(socketPath: string, body: string, path = '/v1/identity', method = 'POST') {
  return new Promise<{ status: number; body: string }>((complete) => {
    const outgoing = request(
      {
        socketPath,
        method,
        path,
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (response) => {
        let content = '';
        response.setEncoding('utf8');
        response.on('data', (part) => {
          content += part;
        });
        response.on('end', () => complete({ status: response.statusCode ?? 0, body: content }));
        response.on('error', () => complete({ status: 0, body: '' }));
      },
    );
    outgoing.setTimeout(3000, () => outgoing.destroy());
    outgoing.on('error', () => complete({ status: 0, body: '' }));
    outgoing.end(body);
  });
}

test('Unix bridge exposes only a verified existing Google identity and applies mutation CSRF', async () => {
  const f = await fixture();
  try {
    assert.equal(lstatSync(f.socketPath).mode & 0o777, 0o660);
    assert.deepEqual(await f.client.identity(f.incoming()), {
      email: 'fixture@example.test',
      subject: 'fixture-google-subject',
      verified: true,
    });
    assert.equal(await f.client.identity(f.incoming('GET', f.websiteToken)), null);
    assert.equal(
      await f.client.identity({
        method: 'GET',
        cookies: { qp_demo: 'fixture' },
        headers: {
          'x-verified-email': 'fixture@example.test',
          'x-identity-subject': 'fixture-google-subject',
        },
      }),
      null,
    );
    assert.equal(await f.client.identity(f.incoming('POST')), null);
    assert.equal(await f.client.identity(f.incoming('POST', f.sessionToken, 'incorrect')), null);
    assert.equal((await f.client.identity(f.incoming('POST', f.sessionToken, f.csrfToken)))?.verified, true);
  } finally {
    await f.close();
  }
});

test('no identity cache survives revocation, expiry, whitelist removal or subject change', async () => {
  const f = await fixture();
  try {
    assert.ok(await f.client.identity(f.incoming()));
    f.db.prepare('INSERT INTO revoked_sessions VALUES (?,?)').run(f.tokenHash, 1100);
    assert.equal(await f.client.identity(f.incoming()), null);
    f.db.exec('DELETE FROM revoked_sessions');
    f.setNow(1100);
    assert.equal(await f.client.identity(f.incoming()), null);
    f.setNow(1000);
    f.db.exec('DELETE FROM whitelist');
    assert.equal(await f.client.identity(f.incoming()), null);
    f.db.prepare('INSERT INTO whitelist VALUES (?)').run('fixture@example.test');
    f.db.prepare('UPDATE identities SET subject=?').run('different-google-subject');
    assert.equal(await f.client.identity(f.incoming()), null);
  } finally {
    await f.close();
  }
});

test('fixed POST protocol rejects unknown fields, bad methods, malformed or oversized bodies', async () => {
  const f = await fixture();
  try {
    const valid = { sessionToken: f.sessionToken, method: 'GET', csrfToken: null };
    for (const body of [
      JSON.stringify({ ...valid, email: 'forged@example.test' }),
      '{',
      JSON.stringify({ ...valid, method: 'TRACE' }),
      JSON.stringify({ ...valid, csrfToken: 'x'.repeat(257) }),
    ]) {
      const result = await raw(f.socketPath, body);
      assert.equal(result.status, 400);
      assert.deepEqual(JSON.parse(result.body), { identity: null });
    }
    assert.equal((await raw(f.socketPath, JSON.stringify(valid), '/wrong')).status, 400);
    assert.equal((await raw(f.socketPath, JSON.stringify(valid), '/v1/identity?query=1')).status, 400);
    assert.equal((await raw(f.socketPath, JSON.stringify(valid), '/v1/identity', 'GET')).status, 400);
    const large = await raw(f.socketPath, ' '.repeat(IDENTITY_SOCKET_MAX_BYTES + 1));
    assert.ok(large.status === 413 || large.status === 0);
    assert.ok(await f.client.identity(f.incoming()));
    assert.equal(identitySocketQuery({ ...valid, sessionToken: 'x'.repeat(129) }), null);
    assert.equal(
      identitySocketResponse({
        identity: { email: 'fixture@example.test', subject: 's', verified: true, token: f.sessionToken },
      }),
      null,
    );
  } finally {
    await f.close();
  }
});

test('client fails closed for missing sockets, insecure permissions, symlinks and unsupported paths', async () => {
  const f = await fixture();
  try {
    assert.equal(
      await new AccessIdentitySocketClient(join(f.root, 'socket', 'missing.sock')).identity(f.incoming()),
      null,
    );
    assert.throws(() => new AccessIdentitySocketClient('relative.sock'), /UNSAFE_PATH/);
    chmodSync(f.socketPath, 0o666);
    assert.equal(await f.client.identity(f.incoming()), null);
    chmodSync(f.socketPath, 0o660);
    const alias = join(f.root, 'socket', 'alias.sock');
    symlinkSync(f.socketPath, alias);
    assert.equal(await new AccessIdentitySocketClient(alias).identity(f.incoming()), null);
    unlinkSync(alias);
    chmodSync(join(f.root, 'socket'), 0o770);
    assert.equal(await f.client.identity(f.incoming()), null);
    assert.throws(() => new AccessIdentitySocketClient(f.socketPath), /UNSAFE_DIRECTORY/);
    chmodSync(join(f.root, 'socket'), 0o710);
  } finally {
    await f.close();
  }
});

test('daemon refuses existing socket and insecure database permissions without replacing either', async () => {
  const f = await fixture();
  try {
    const original = lstatSync(f.socketPath);
    await assert.rejects(
      startAccessIdentityDaemon({ dbPath: f.dbPath, socketPath: f.socketPath }),
      /ALREADY_EXISTS/,
    );
    assert.equal(lstatSync(f.socketPath).ino, original.ino);
    chmodSync(f.dbPath, 0o644);
    await assert.rejects(
      startAccessIdentityDaemon({ dbPath: f.dbPath, socketPath: f.socketPath }),
      /UNSAFE_FILE/,
    );
    chmodSync(f.dbPath, 0o600);
  } finally {
    await f.close();
  }
});

test('market server rejects mixed database and socket identity configurations before touching storage', async () => {
  await assert.rejects(
    startMarketServer({
      AF_MARKET_ORIGIN: 'https://identity-fixture.example.test',
      AF_MARKET_DATA_DIR: '/nonexistent/fixture-must-not-be-created',
      AF_ACCESS_IDENTITY_DB: '/nonexistent/private-fixture.sqlite',
      AF_ACCESS_IDENTITY_SOCKET: '/nonexistent/fixture.sock',
    }),
    /IDENTITY_BRIDGE_CONFIGURATION_CONFLICT/,
  );
});

test('daemon closes incomplete headers and bodies within a bounded connection lifetime', async () => {
  const f = await fixture();
  try {
    for (const data of [
      'POST /v1/identity HTTP/1.1\r\n',
      'POST /v1/identity HTTP/1.1\r\nHost: identity\r\nContent-Type: application/json\r\nContent-Length: 900\r\n\r\n{',
    ]) {
      const before = Date.now();
      await new Promise<void>((complete, reject) => {
        const socket = createConnection(f.socketPath, () => socket.write(data));
        socket.setTimeout(2500, () => {
          socket.destroy();
          reject(new Error('SOCKET_LIFETIME_NOT_BOUNDED'));
        });
        socket.on('data', () => {});
        socket.once('error', reject);
        socket.once('close', () => complete());
      });
      assert.ok(Date.now() - before < 2500);
    }
    assert.ok(await f.client.identity(f.incoming()));
  } finally {
    await f.close();
  }
});

test('malformed, oversized and unresponsive socket responses fail closed within the deadline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'af-identity-bad-peer-')),
    socketPath = join(root, 'identity.sock');
  chmodSync(root, 0o710);
  let mode = 'malformed';
  const server = createServer((_incoming, response) => {
    if (mode === 'timeout') return;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(mode === 'malformed' ? '{' : 'x'.repeat(IDENTITY_SOCKET_MAX_BYTES + 1));
  });
  await new Promise<void>((accept) => server.listen(socketPath, accept));
  chmodSync(socketPath, 0o660);
  const client = new AccessIdentitySocketClient(socketPath),
    incoming = {
      method: 'GET',
      cookies: { '__Host-ikol_session': randomBytes(32).toString('base64url') },
      headers: {},
    };
  try {
    assert.equal(await client.identity(incoming), null);
    mode = 'oversized';
    assert.equal(await client.identity(incoming), null);
    mode = 'timeout';
    const before = Date.now();
    assert.equal(await client.identity(incoming), null);
    assert.ok(Date.now() - before < 2500);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((accept) => server.close(() => accept()));
    rmSync(root, { recursive: true });
  }
});
