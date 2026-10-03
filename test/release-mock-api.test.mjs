import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tokenInterface, tradingInterface } from '../packages/testnet/src/trading-abi.ts';
import {
  createReleaseSession,
  OWNER_A,
  OWNER_B,
  mockSignature,
} from '../tools/testing/alphaforge-release-mock/session.mjs';

async function withSession(run) {
  const s = await createReleaseSession();
  try {
    await run(s);
  } finally {
    await s.close();
  }
}

test('release fixtures have per-run databases, MOCK identity and production ingress boundaries', async () => {
  const a = await createReleaseSession(),
    b = await createReleaseSession();
  try {
    assert.notEqual(a.directory, b.directory);
    assert.equal(a.mode, 'MOCK');
    assert.equal(a.auth.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    const cookie = await a.login(OWNER_A);
    assert.equal((await b.request('/api/testnet/vaults', undefined, cookie)).statusCode, 401);
    for (const url of [
      '/api/demo/session',
      '/api/testnet/mock/deposit',
      '/api/testnet/sign',
      '/api/testnet/executor/start',
    ])
      assert.equal((await a.request(url, {}, cookie)).statusCode, 404);
    assert.equal((await a.request('/api/health')).json().orderExecution, 'OWNER_WALLET_ONLY');
    assert.equal(a.walletRequests.length, 0);
    assert.equal(a.broadcasts, 0);
    for (const headers of [
      { origin: 'https://other.invalid' },
      { host: 'other.invalid' },
      { 'x-forwarded-proto': 'http' },
      { 'sec-fetch-site': 'cross-site' },
    ])
      assert.equal(
        (await a.request('/api/testnet/auth/challenge', { owner: OWNER_A }, '', headers)).statusCode,
        403,
      );
  } finally {
    await a.close();
    await b.close();
  }
});

test('challenge verification covers valid, replay, expired, wrong-owner and wrong-signature sessions', async () =>
  withSession(async (s) => {
    const challenge = (await s.request('/api/testnet/auth/challenge', { owner: OWNER_A })).json();
    assert.match(challenge.message, /Chain ID: 46630/);
    const payload = {
      owner: OWNER_A,
      nonce: challenge.nonce,
      signature: mockSignature(challenge.message, OWNER_A),
    };
    const valid = await s.request('/api/testnet/auth/verify', payload);
    assert.equal(valid.statusCode, 200);
    assert.match(String(valid.headers['set-cookie']), /HttpOnly.*Secure|Secure.*HttpOnly/);
    assert.match(String(valid.headers['set-cookie']), /SameSite=Strict/);
    assert.equal((await s.request('/api/testnet/auth/verify', payload)).statusCode, 401);
    const expired = (await s.request('/api/testnet/auth/challenge', { owner: OWNER_A })).json();
    s.advance(60000);
    assert.equal(
      (
        await s.request('/api/testnet/auth/verify', {
          owner: OWNER_A,
          nonce: expired.nonce,
          signature: mockSignature(expired.message, OWNER_A),
        })
      ).statusCode,
      401,
    );
    for (const wrong of ['owner', 'signature', 'domain', 'chain']) {
      const c = (await s.request('/api/testnet/auth/challenge', { owner: OWNER_A })).json();
      const message =
        wrong === 'domain'
          ? c.message.replace(s.origin, 'https://other.invalid')
          : wrong === 'chain'
            ? c.message.replace('46630', '4663')
            : c.message;
      const response = await s.request('/api/testnet/auth/verify', {
        owner: wrong === 'owner' ? OWNER_B : OWNER_A,
        nonce: c.nonce,
        signature: wrong === 'signature' ? '0x01' : mockSignature(message, OWNER_A),
      });
      assert.equal(response.statusCode, 401, wrong);
    }
    assert.equal(s.auth.db.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 1);
  }));

test('owner B cannot read or prepare owner A state; expiry, logout and restart retain authentication policy', async () =>
  withSession(async (s) => {
    const a = await s.login(OWNER_A),
      b = await s.login(OWNER_B);
    const view = (await s.request('/api/testnet/vaults', undefined, a)).json();
    assert.equal(view.vaults.length, 1);
    assert.equal(view.vaults[0].snapshot.owner, OWNER_A);
    assert.equal((await s.request('/api/testnet/vaults', undefined, b)).json().vaults.length, 0);
    assert.equal(
      (await s.request('/api/testnet/vaults/mock-owner-a/prepare', { action: { kind: 'STOP' } }, b))
        .statusCode,
      404,
    );
    await s.restart();
    assert.equal((await s.request('/api/testnet/auth/session', undefined, a)).statusCode, 200);
    assert.equal((await s.request('/api/testnet/auth/logout', {}, a)).statusCode, 200);
    await s.restart();
    assert.equal((await s.request('/api/testnet/auth/session', undefined, a)).statusCode, 401);
    s.advance(3600000);
    assert.equal((await s.request('/api/testnet/auth/session', undefined, b)).statusCode, 401);
  }));

for (const kind of [
  'APPROVE_USDC',
  'APPROVE_PASS',
  'DEPOSIT',
  'ALLOCATE',
  'DEALLOCATE',
  'WITHDRAW',
  'AUTHORIZE',
  'STOP',
  'REVOKE',
]) {
  test(`public ${kind} preview is unsigned, typed, finite and exact in base units`, async () =>
    withSession(async (s) => {
      const cookie = await s.login(OWNER_A);
      const action =
        kind === 'AUTHORIZE'
          ? {
              kind,
              executor: s.executor,
              expiresAt: '1100',
              liquidationWindow: '60',
              maxOrderUsdc: '1000001',
              maxTotalBuyUsdc: '3000003',
              maxSlippageBps: '40',
            }
          : ['STOP', 'REVOKE'].includes(kind)
            ? { kind }
            : { kind, amountUsdc: '1000001' };
      const response = await s.request('/api/testnet/vaults/mock-owner-a/prepare', { action }, cookie);
      assert.equal(response.statusCode, 200, response.body);
      const preview = response.json();
      assert.equal(preview.requiresOwnerWallet, true);
      assert.equal(preview.transaction.chainId, '0xb626');
      assert.equal(preview.transaction.value, '0x0');
      assert.equal(preview.transaction.from, OWNER_A);
      const abi = kind.startsWith('APPROVE') ? tokenInterface : tradingInterface;
      const decoded = abi.parseTransaction({ data: preview.transaction.data });
      if (kind === 'APPROVE_PASS') assert.equal(decoded.args[1], 1000001n * 10n ** 12n);
      else if (kind === 'APPROVE_USDC') assert.equal(decoded.args[1], 1000001n);
      else if (kind === 'AUTHORIZE') {
        assert.equal(decoded.args[0].maxOrderUsdc, 1000001n);
        assert.equal(decoded.args[0].maxTotalBuyUsdc, 3000003n);
        assert.equal(decoded.args[0].liquidationWindow, 60n);
        assert.equal(decoded.args[0].maxSlippageBps, 40n);
      } else if (!['STOP', 'REVOKE'].includes(kind)) assert.equal(decoded.args[0], 1000001n);
      assert.equal(s.broadcasts, 0);
    }));
}

test('invalid action budgets and impersonation fields do not create owner intents', async () =>
  withSession(async (s) => {
    const cookie = await s.login(OWNER_A);
    for (const action of [
      { kind: 'DEPOSIT', amountUsdc: '1.1' },
      { kind: 'DEPOSIT', amountUsdc: '0' },
      {
        kind: 'AUTHORIZE',
        executor: OWNER_A,
        expiresAt: '1100',
        liquidationWindow: '60',
        maxOrderUsdc: '1',
        maxTotalBuyUsdc: '3',
        maxSlippageBps: '40',
      },
      {
        kind: 'AUTHORIZE',
        executor: s.executor,
        expiresAt: '1000',
        liquidationWindow: '0',
        maxOrderUsdc: '1',
        maxTotalBuyUsdc: '3',
        maxSlippageBps: '40',
      },
      { kind: 'DEPOSIT', amountUsdc: '1', chainId: 4663 },
    ])
      assert.equal(
        (await s.request('/api/testnet/vaults/mock-owner-a/prepare', { action }, cookie)).statusCode,
        500,
      );
    assert.equal(
      (
        await s.request(
          '/api/testnet/vaults/mock-owner-a/prepare',
          { action: { kind: 'STOP' }, owner: OWNER_B },
          cookie,
        )
      ).statusCode,
      400,
    );
    assert.equal(s.runtime.store.db.prepare('SELECT count(*) AS n FROM chain_transactions').get().n, 0);
  }));

test('storage pause fails closed, preserves evidence and permits logout', async () =>
  withSession(async (s) => {
    const cookie = await s.login(OWNER_A),
      before = s.runtime.evidence.verify();
    s.setWritable(false);
    assert.equal(
      (await s.request('/api/testnet/vaults/mock-owner-a/prepare', { action: { kind: 'STOP' } }, cookie))
        .statusCode,
      503,
    );
    assert.equal((await s.request('/api/health')).json().storage, 'BLOCKED');
    assert.deepEqual(s.runtime.evidence.verify(), before);
    assert.equal((await s.request('/api/testnet/auth/logout', {}, cookie)).statusCode, 200);
  }));

test('API evidence excludes opaque cookies and mock signature material', async () =>
  withSession(async (s) => {
    const cookie = await s.login(OWNER_A);
    await s.request('/api/testnet/vaults', undefined, cookie);
    const bytes = readFileSync(join(s.directory, 'api.jsonl'), 'utf8');
    assert.equal(bytes.includes(cookie), false);
    assert.equal(bytes.includes('__Host-af_testnet='), false);
    assert.equal(bytes.includes('fixture.invalid'), false);
    assert.match(bytes, /MOCK/);
  }));
