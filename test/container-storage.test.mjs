import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  linkSync,
  existsSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retainedBytes, acquireLease } from '../deploy/container/volume.mjs';
import { snapshot, verifySnapshot, restoreCopy } from '../deploy/container/recovery.mjs';
function fixture(t) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'af-container-')));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  for (const p of ['public', 'executor', 'status', 'recovery']) mkdirSync(join(d, p));
  writeFileSync(join(d, 'executor', 'orders.sqlite'), 'RESERVED_NONCE_17_UNKNOWN');
  return d;
}
test('storage traversal counts backups and partial evidence but rejects links', (t) => {
  const d = fixture(t);
  writeFileSync(join(d, 'recovery', 'partial'), 'abc');
  assert.equal(retainedBytes(d), 28);
  symlinkSync('/etc/passwd', join(d, 'public', 'alias'));
  assert.throws(() => retainedBytes(d));
  rmSync(join(d, 'public', 'alias'));
  linkSync(join(d, 'executor', 'orders.sqlite'), join(d, 'public', 'hard'));
  assert.throws(() => retainedBytes(d));
});
test('exclusive durable lease never silently resets a crash lock', (t) => {
  const d = fixture(t);
  const lease = acquireLease(d);
  assert.throws(() => acquireLease(d));
  lease.release();
  assert.doesNotThrow(() => acquireLease(d).release());
});
test('cold snapshot verifies byte identity and restores to new path without clearing unknown orders', (t) => {
  const d = fixture(t);
  const id = snapshot(d, { limit: 100000, reserve: 100 });
  assert.equal(verifySnapshot(d, id).files.filter((f) => !f.directory).length, 1);
  const restored = restoreCopy(d, id, { limit: 100000, reserve: 100 });
  assert.equal(
    readFileSync(join(restored, 'executor', 'orders.sqlite'), 'utf8'),
    'RESERVED_NONCE_17_UNKNOWN',
  );
  assert.equal(readFileSync(join(d, 'executor', 'orders.sqlite'), 'utf8'), 'RESERVED_NONCE_17_UNKNOWN');
  writeFileSync(join(d, 'recovery', id, 'payload', 'executor', 'orders.sqlite'), 'tampered');
  assert.throws(() => verifySnapshot(d, id));
});
test('backup refuses insufficient total retained capacity and live lease', (t) => {
  const d = fixture(t);
  assert.throws(() => snapshot(d, { limit: 100, reserve: 80 }));
  const lease = acquireLease(d);
  assert.throws(() => snapshot(d, { limit: 100000, reserve: 100 }));
  assert.ok(existsSync(join(d, 'executor', 'orders.sqlite')));
  lease.release();
});
test('cold snapshots retain hidden partial status evidence without deleting it', (t) => {
  const d = fixture(t);
  writeFileSync(join(d, 'status', '.status-partial'), 'unfinished');
  const id = snapshot(d, { limit: 100000, reserve: 100 });
  const copy = restoreCopy(d, id, { limit: 100000, reserve: 100 });
  assert.equal(readFileSync(join(copy, 'status', '.status-partial'), 'utf8'), 'unfinished');
});
test('network sidecar and shared nonce identity/lock bytes survive cold backup and independent copy', (t) => {
  const d = fixture(t);
  mkdirSync(join(d, 'executor', 'host-nonces'));
  const sidecar =
    '{"schemaVersion":1,"environment":"robinhood-chain-testnet","chainId":46630,"profile":"RESTRICTED_TESTNET_EXECUTOR","digest":"0x' +
    '11'.repeat(32) +
    '"}\n';
  writeFileSync(join(d, 'executor', 'network-identity.json'), sidecar, { mode: 0o600 });
  writeFileSync(join(d, 'executor', 'host-nonces', '.executor.identity.json'), 'NETWORK_NAMESPACE_A', {
    mode: 0o600,
  });
  writeFileSync(join(d, 'executor', 'host-nonces', '.executor.lock'), 'UNKNOWN_OWNER_LOCK', { mode: 0o600 });
  const id = snapshot(d, { limit: 100000, reserve: 100 });
  const copy = restoreCopy(d, id, { limit: 100000, reserve: 100 });
  assert.equal(readFileSync(join(copy, 'executor', 'network-identity.json'), 'utf8'), sidecar);
  assert.equal(
    readFileSync(join(copy, 'executor', 'host-nonces', '.executor.identity.json'), 'utf8'),
    'NETWORK_NAMESPACE_A',
  );
  assert.equal(
    readFileSync(join(copy, 'executor', 'host-nonces', '.executor.lock'), 'utf8'),
    'UNKNOWN_OWNER_LOCK',
  );
});
