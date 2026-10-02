import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WalletAuthStore } from '../packages/testnet/src/wallet-auth.ts';

const owner = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const origin = 'https://alphaforge.example';
const now = Date.parse('2026-10-01T00:00:00Z');
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-auth-'));
  const path = join(folder, 'auth.sqlite');
  const store = new WalletAuthStore(path, origin, {
    challengeTtlMs: 300000,
    sessionTtlMs: 3600000,
    maxRows: 100,
  });
  return { folder, path, store };
}

test('wallet challenges bind origin, chain, address and time; consuming a challenge is durable and one-use', () => {
  const f = fixture();
  try {
    const challenge = f.store.issue(owner, now);
    assert.match(challenge.message, /^alphaforge\.example wants you to sign in with your Ethereum account:/);
    assert.match(challenge.message, /URI: https:\/\/alphaforge\.example\nVersion: 1\nChain ID: 46630/);
    assert.match(
      challenge.message,
      /This signature only logs in to AlphaForge Testnet\. It does not authorize trades or withdrawals\./,
    );
    assert.equal(f.store.consume(challenge.nonce, other, now), null);
    assert.equal(f.store.consume(challenge.nonce, owner, now)?.message, challenge.message);
    f.store.close();
    f.store = new WalletAuthStore(f.path, origin, {
      challengeTtlMs: 300000,
      sessionTtlMs: 3600000,
      maxRows: 100,
    });
    assert.equal(f.store.consume(challenge.nonce, owner, now), null);
  } finally {
    f.store.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});

test('expired and future challenges fail without allowing a valid signature to renew the original nonce', () => {
  const f = fixture();
  try {
    const old = f.store.issue(owner, now);
    assert.equal(f.store.consume(old.nonce, owner, now - 1), null);
    assert.equal(f.store.consume(old.nonce, owner, now + 300000), null);
  } finally {
    f.store.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});

test('only opaque session hashes persist; logout and expiry survive reopening without cross-owner access', () => {
  const f = fixture();
  try {
    const session = f.store.createSession(owner, now);
    assert.equal(f.store.owner(session.token, now), owner);
    assert.equal(f.store.owner('wrong-token', now), null);
    const stored = f.store.db.prepare('SELECT token_hash FROM auth_sessions').get()!.token_hash;
    assert.notEqual(stored, session.token);
    f.store.close();
    f.store = new WalletAuthStore(f.path, origin, {
      challengeTtlMs: 300000,
      sessionTtlMs: 3600000,
      maxRows: 100,
    });
    assert.equal(f.store.owner(session.token, now + 1), owner);
    assert.equal(f.store.owner(session.token, now + 3600000), null);
    const second = f.store.createSession(other, now);
    f.store.logout(second.token);
    assert.equal(f.store.owner(second.token, now), null);
  } finally {
    f.store.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});

test('session stores cannot be reused under a different public origin or broadened to mainnet', () => {
  const f = fixture();
  try {
    f.store.issue(owner, now);
    f.store.close();
    assert.throws(
      () =>
        new WalletAuthStore(f.path, 'https://other.example', {
          challengeTtlMs: 300000,
          sessionTtlMs: 3600000,
          maxRows: 100,
        }),
      /AUTH_DATABASE_IDENTITY/,
    );
    assert.throws(
      () =>
        new WalletAuthStore(':memory:', 'http://public.example', {
          challengeTtlMs: 300000,
          sessionTtlMs: 3600000,
          maxRows: 100,
        }),
      /AUTH_CONFIGURATION/,
    );
  } finally {
    f.store.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
});
