import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPublicTestnetApp } from '../apps/server/src/testnet-app.ts';
import { WalletAuthStore } from '../packages/testnet/src/wallet-auth.ts';

const origin = 'https://alphaforge.example';
const owner = '0x1111111111111111111111111111111111111111';
const now = Date.parse('2026-10-01T00:00:00Z');
const headers = {
  host: 'alphaforge.example',
  origin,
  'x-alphaforge-client': '1',
  'x-forwarded-proto': 'https',
};
async function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-public-'));
  const auth = new WalletAuthStore(join(folder, 'auth.sqlite'), origin, {
    challengeTtlMs: 300000,
    sessionTtlMs: 3600000,
    maxRows: 100,
  });
  const app = await buildPublicTestnetApp({ origin, auth, now: () => now });
  return { folder, app, auth };
}

test('public profile rejects demo impersonation and cross-origin or missing-origin writes', async () => {
  const f = await fixture();
  try {
    const health = await f.app.inject({ method: 'GET', url: '/api/health', headers });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().mode, 'PUBLIC_TESTNET');
    assert.equal(health.json().chainId, 46630);
    assert.equal(health.json().orderExecution, 'DISABLED');
    assert.equal(
      (await f.app.inject({ method: 'POST', url: '/api/demo/session', headers, payload: { user: 'alice' } }))
        .statusCode,
      404,
    );
    const missingOrigin: Record<string, string> = { ...headers };
    delete missingOrigin.origin;
    for (const bad of [
      { ...headers, host: 'attacker.example' },
      { ...headers, origin: 'https://attacker.example' },
      missingOrigin,
      { ...headers, 'x-forwarded-proto': 'http' },
    ]) {
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/testnet/auth/challenge',
        headers: bad,
        payload: { owner },
      });
      assert.equal(response.statusCode, 403);
    }
    assert.equal(f.auth.db.prepare('SELECT count(*) AS n FROM auth_challenges').get()!.n, 0);
  } finally {
    await f.app.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});

test('login rejects an invalid signature and replay without minting a session or leaking error details', async () => {
  const f = await fixture();
  try {
    const challenge = await f.app.inject({
      method: 'POST',
      url: '/api/testnet/auth/challenge',
      headers,
      payload: { owner },
    });
    assert.equal(challenge.statusCode, 200);
    const payload = { owner, nonce: challenge.json().nonce, signature: '0x' + '01'.repeat(65) };
    for (let i = 0; i < 2; i++) {
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/testnet/auth/verify',
        headers,
        payload,
      });
      assert.equal(response.statusCode, 401);
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.body.includes('stack'), false);
    }
    assert.equal(f.auth.db.prepare('SELECT count(*) AS n FROM auth_sessions').get()!.n, 0);
    assert.equal(
      (await f.app.inject({ method: 'GET', url: '/api/testnet/auth/session', headers })).statusCode,
      401,
    );
  } finally {
    await f.app.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});

test('sessions require a secure opaque cookie and authenticated owner; logout invalidates it', async () => {
  const f = await fixture();
  try {
    const session = f.auth.createSession(owner, now);
    const cookie = '__Host-af_testnet=' + session.token;
    const authenticated = { ...headers, cookie };
    const read = await f.app.inject({
      method: 'GET',
      url: '/api/testnet/auth/session',
      headers: authenticated,
    });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().owner, owner);
    const logout = await f.app.inject({
      method: 'POST',
      url: '/api/testnet/auth/logout',
      headers: authenticated,
      payload: {},
    });
    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers['set-cookie']), /HttpOnly/);
    assert.match(String(logout.headers['set-cookie']), /Secure/);
    assert.match(String(logout.headers['set-cookie']), /SameSite=Strict/);
    assert.equal(
      (await f.app.inject({ method: 'GET', url: '/api/testnet/auth/session', headers: authenticated }))
        .statusCode,
      401,
    );
  } finally {
    await f.app.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});
test('storage pause rejects new persistent work but still permits owner logout', async () => {
  const auth = new WalletAuthStore(':memory:', origin, {
    challengeTtlMs: 60000,
    sessionTtlMs: 60000,
    maxRows: 10,
  });
  const session = auth.createSession(owner, now);
  const app = await buildPublicTestnetApp({ origin, auth, now: () => now, canWrite: () => false });
  try {
    const authenticated = { ...headers, cookie: '__Host-af_testnet=' + session.token };
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/testnet/auth/challenge',
          headers: authenticated,
          payload: { owner },
        })
      ).statusCode,
      503,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/testnet/auth/logout',
          headers: authenticated,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: '/api/testnet/auth/session', headers: authenticated })).statusCode,
      401,
    );
    assert.equal(auth.db.prepare('SELECT count(*) AS n FROM auth_challenges').get()!.n, 0);
  } finally {
    await app.close();
  }
});

test('live reads and MCP require a current owner session on every request and remain read-only during storage pause', async () => {
  const auth = new WalletAuthStore(':memory:', origin, {
    challengeTtlMs: 60000,
    sessionTtlMs: 60000,
    maxRows: 10,
  });
  let clock = now;
  const session = auth.createSession(owner, clock);
  const app = await buildPublicTestnetApp({ origin, auth, now: () => clock, canWrite: () => false });
  try {
    for (const url of ['/api/testnet/status', '/api/testnet/readiness', '/api/testnet/test-results']) {
      assert.equal((await app.inject({ url, headers })).statusCode, 401);
      const response = await app.inject({
        url,
        headers: { ...headers, cookie: '__Host-af_testnet=' + session.token },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(
        response.json().provenance.kind,
        url.endsWith('test-results') ? 'NOT_CONFIGURED' : 'CURRENT_PROCESS_OBSERVATION',
      );
    }
    const payload = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/testnet/mcp', headers, payload })).statusCode,
      401,
    );
    const authorized = { ...headers, authorization: 'Bearer ' + session.token };
    const list = await app.inject({ method: 'POST', url: '/api/testnet/mcp', headers: authorized, payload });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(
      list.json().result.tools.map((t: { name: string }) => t.name),
      ['alphaforge_status', 'alphaforge_test_results', 'alphaforge_readiness'],
    );
    const call = await app.inject({
      method: 'POST',
      url: '/api/testnet/mcp',
      headers: authorized,
      payload: { ...payload, method: 'tools/call', params: { name: 'alphaforge_readiness', arguments: {} } },
    });
    assert.equal(call.json().result.structuredContent.state, 'BLOCKED_FOR_PERSISTENT_TESTNET');
    assert.equal(call.json().result.structuredContent.signingEnabled, false);
    const impersonation = await app.inject({
      method: 'POST',
      url: '/api/testnet/mcp',
      headers: authorized,
      payload: {
        ...payload,
        method: 'tools/call',
        params: { name: 'alphaforge_status', arguments: { owner: 'bob' } },
      },
    });
    assert.equal(impersonation.json().error.code, -32602);
    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/api/testnet/mcp',
      headers: { ...authorized, origin: 'https://attacker.example' },
      payload,
    });
    assert.equal(wrongOrigin.statusCode, 403);
    clock += 60001;
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/testnet/mcp', headers: authorized, payload }))
        .statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});

test('status excludes other owners and secret-shaped provider fields; archived tests retain distinct source provenance', async () => {
  const { tradingRpcFixture, tradingFixtureAddress } = await import('./helpers/testnet-trading-rpc.ts');
  const { TradingChainRuntime } = await import('../apps/server/src/trading-chain-runtime.ts');
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-live-owner-'));
  const f = tradingRpcFixture();
  const runtime = new TradingChainRuntime({
    dbPath: join(folder, 'chain.sqlite'),
    evidencePath: join(folder, 'evidence.sqlite'),
    rpc: f.client,
    inventory: f.inventory,
    manifest: f.manifest,
  });
  const auth = new WalletAuthStore(':memory:', origin, {
    challengeTtlMs: 60000,
    sessionTtlMs: 60000,
    maxRows: 10,
  });
  const ownSession = auth.createSession(f.inventory.owner, now),
    otherSession = auth.createSession(owner, now);
  const app = await buildPublicTestnetApp({
    origin,
    auth,
    now: () => now,
    runtimes: [{ id: 'one', runtime }],
    runtimeStatus: {
      configurationDigest: '0x' + 'ac'.repeat(32),
      releaseIdentity: {
        schemaVersion: 1,
        sourceCommit: 'a'.repeat(40),
        sourceTree: 'b'.repeat(40),
        lockSha256: 'c'.repeat(64),
        releaseDigest: '0x' + 'd'.repeat(64),
      },
      archivedTestResults: {
        schemaVersion: 1,
        sourceCommit: 'e'.repeat(40),
        observedAt: now - 1000,
        tests: 12,
        pass: 10,
        fail: 1,
        skipped: 1,
        rawLogSha256: 'f'.repeat(64),
      },
    },
    executionStatus: () => ({
      state: 'WARMUP',
      signingEnabled: true,
      observedAt: now,
      rpcUrl: 'https://secret.invalid',
      rawTransaction: 'secret-envelope',
    }),
    backupStatus: () => ({ state: 'VERIFIED', lastVerifiedAt: now, lastBackupId: 'secret-backup-path' }),
  });
  try {
    const ownHeaders = { ...headers, cookie: '__Host-af_testnet=' + ownSession.token };
    const own = await app.inject({ url: '/api/testnet/status', headers: ownHeaders });
    assert.equal(own.json().vaults.length, 1);
    assert.equal(own.json().vaults[0].vault, tradingFixtureAddress(50));
    assert.equal(own.json().signingEnabled, true);
    assert.equal(own.body.includes('secret'), false);
    const other = await app.inject({
      url: '/api/testnet/status',
      headers: { ...headers, cookie: '__Host-af_testnet=' + otherSession.token },
    });
    assert.deepEqual(other.json().vaults, []);
    assert.equal(other.json().signingEnabled, false);
    assert.equal(other.body.includes(f.inventory.owner), false);
    const tests = await app.inject({ url: '/api/testnet/test-results', headers: ownHeaders });
    assert.equal(tests.json().provenance.kind, 'RECORDED_TEST_SNAPSHOT');
    assert.equal(tests.json().provenance.sourceCommit, 'e'.repeat(40));
    assert.equal(tests.json().currentSource.sourceCommit, 'a'.repeat(40));
    assert.equal(tests.json().results.fail, 1);
    assert.equal(tests.json().liveTestExecution, false);
  } finally {
    await app.close();
    await runtime.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
