import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyRequest } from 'fastify';
import { VerifiedEthReference, priceToRaw } from '../apps/server/src/launch-market-adapters/eth-reference.ts';
import { AccessIdentityBridge } from '../apps/server/src/launch-market-adapters/access-identity.ts';

test('native reference checks both exchange timestamps and disagreement without price floating point', async () => {
  let primaryPrice = '3000.000001';
  let checkedPrice = '3000.000000';
  let sourceTime = 1000;
  let now = 1000;
  const fetcher = (async (url: string | URL | Request) => {
    const value = String(url).includes('coinbase')
      ? { price: primaryPrice, time: new Date(sourceTime * 1000).toISOString() }
      : { error: [], result: { XETHZUSD: [[checkedPrice, '1', sourceTime, 'b', 'm', '']], last: '1' } };
    return Response.json(value);
  }) as typeof fetch;
  const reference = new VerifiedEthReference({ fetcher, now: () => now });
  const initial = await reference.read();
  assert.equal(initial.priceRaw, '3000000001');
  assert.equal(initial.observedAt, 1000);
  now = 1031;
  await assert.rejects(reference.read(), /STALE_REFERENCE_PRICE/);
  sourceTime = now;
  primaryPrice = '3000';
  checkedPrice = '3060.000001';
  await assert.rejects(reference.read(), /REFERENCE_PRICE_DEVIATION/);
  checkedPrice = '3060';
  assert.equal((await reference.read()).deviationBps, 200);
  now = 1040;
  sourceTime = 1041;
  await assert.rejects(reference.read(), /STALE_REFERENCE_PRICE/);
  assert.equal(priceToRaw('0.000001'), 1n);
  assert.throws(() => priceToRaw('1e6'), /INVALID_REFERENCE_PRICE/);
  assert.throws(() => priceToRaw('0'), /INVALID_REFERENCE_PRICE/);
});

test('reference outage and oversized payload never produce a new native quotation', async () => {
  await assert.rejects(
    new VerifiedEthReference({
      fetcher: (async () => new Response('', { status: 503 })) as typeof fetch,
    }).read(),
    /REFERENCE_UNAVAILABLE/,
  );
  await assert.rejects(
    new VerifiedEthReference({
      fetcher: (async () => new Response(' '.repeat(262145))) as typeof fetch,
    }).read(),
    /REFERENCE_RESPONSE_TOO_LARGE/,
  );
});

test('existing verified session bridge rejects native/demo users, revoked identity and CSRF forgery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-verified-session-'));
  const file = join(dir, 'access.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE whitelist(email TEXT PRIMARY KEY);
    CREATE TABLE identities(email TEXT PRIMARY KEY,subject TEXT UNIQUE);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,subject TEXT,csrf_token TEXT,expires_at INTEGER);
    CREATE TABLE revoked_sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER);`);
  const token = 'A'.repeat(43);
  const hash = createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO whitelist VALUES (?)').run('alice@example.test');
  db.prepare('INSERT INTO identities VALUES (?,?)').run('alice@example.test', 'verified-google-subject');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(
    hash,
    'alice@example.test',
    'verified-google-subject',
    'server-csrf',
    1100,
  );
  const bridge = new AccessIdentityBridge(file, () => 1000);
  const request = (method: string, cookies: Record<string, string>, headers = {}) =>
    ({ method, cookies, headers }) as FastifyRequest;
  try {
    assert.equal(bridge.identity(request('GET', { qp_demo: 'alice' })), null);
    assert.equal(bridge.identity(request('GET', { '__Host-ikol_session': token }))?.verified, true);
    assert.equal(
      bridge.identity(request('POST', { '__Host-ikol_session': token }, { 'x-csrf-token': 'wrong' })),
      null,
    );
    assert.equal(
      bridge.identity(request('POST', { '__Host-ikol_session': token }, { 'x-csrf-token': 'server-csrf' }))
        ?.subject,
      'verified-google-subject',
    );
    db.prepare('INSERT INTO revoked_sessions VALUES (?,?)').run(hash, 1100);
    assert.equal(bridge.identity(request('GET', { '__Host-ikol_session': token })), null);
    db.prepare('DELETE FROM revoked_sessions').run();
    db.prepare('UPDATE identities SET subject=?').run('changed-subject');
    assert.equal(bridge.identity(request('GET', { '__Host-ikol_session': token })), null);
  } finally {
    bridge.close();
    db.close();
    rmSync(dir, { recursive: true });
  }
});
