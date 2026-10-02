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
