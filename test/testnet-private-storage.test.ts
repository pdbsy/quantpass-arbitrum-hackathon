import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { BatchJournal, REFERENCE_BATCH_APPLICATION_ID } from '../packages/market-data/src/batch-journal.ts';
import { privateServerStorage } from '../packages/testnet/src/private-storage.ts';

test(
  'private runtime owns one directory and one process lock; capacity includes backups without deleting them',
  { skip: process.platform === 'win32' },
  () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-storage-'))),
      folder = join(parent, 'data');
    const storage = privateServerStorage(folder, 1048576);
    try {
      assert.throws(() => privateServerStorage(folder, 1048576), /TESTNET_STORAGE_LOCKED/);
      assert.match(storage.databasePath('wallet-auth'), /wallet-auth\.sqlite$/);
      assert.throws(() => storage.databasePath('../escape'), /TESTNET_STORAGE_INPUT/);
      mkdirSync(join(folder, 'backups'), { mode: 0o700 });
      writeFileSync(join(folder, 'backups', 'retained.sqlite'), Buffer.alloc(1048576), { mode: 0o600 });
      assert.equal(storage.canWrite(), false);
      assert.equal(storage.bytes() > 1048576, true);
    } finally {
      storage.close();
      rmSync(parent, { recursive: true, force: true });
    }
  },
);
test(
  'unsafe file or directory links cannot redirect runtime storage',
  { skip: process.platform === 'win32' },
  () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-storage-links-'))),
      folder = join(parent, 'data');
    mkdirSync(folder, { mode: 0o700 });
    const storage = privateServerStorage(folder, 1048576);
    try {
      writeFileSync(join(parent, 'outside'), 'unchanged');
      symlinkSync(join(parent, 'outside'), join(folder, 'wallet-auth.sqlite'));
      assert.throws(() => storage.databasePath('wallet-auth'), /TESTNET_STORAGE_UNSAFE/);
      assert.equal(storage.canWrite(), false);
    } finally {
      storage.close();
      rmSync(parent, { recursive: true, force: true });
    }
  },
);

test(
  'only a newly claimed private journal receives an application identity; preexisting empty files remain blocked',
  { skip: process.platform === 'win32' },
  () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-storage-journal-'))),
      storage = privateServerStorage(join(parent, 'data'), 1048576);
    try {
      const path = storage.databasePath('new-batches', REFERENCE_BATCH_APPLICATION_ID),
        batch = new BatchJournal(path);
      batch.close();
      const reopened = new BatchJournal(storage.databasePath('new-batches', REFERENCE_BATCH_APPLICATION_ID));
      reopened.close();
      assert.ok(storage.bytes() > 0);
      const existing = storage.databasePath('retained-empty'),
        before = readFileSync(existing);
      assert.throws(
        () => storage.databasePath('retained-empty', REFERENCE_BATCH_APPLICATION_ID),
        /TESTNET_STORAGE_DATABASE_IDENTITY/,
      );
      assert.deepEqual(readFileSync(existing), before);
      for (const id of [0, -1, NaN, 2 ** 31])
        assert.throws(() => storage.databasePath('invalid', id), /TESTNET_STORAGE_INPUT/);
    } finally {
      storage.close();
      rmSync(parent, { recursive: true, force: true });
    }
  },
);

test(
  'persistent namespace refuses configuration changes and cross-profile reuse after restart',
  { skip: process.platform === 'win32' },
  () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-namespace-'))),
      folder = join(parent, 'data');
    let storage = privateServerStorage(folder, 1048576);
    const digest = '0x' + 'ab'.repeat(32);
    try {
      assert.equal(typeof storage.bindIdentity, 'function');
      storage.bindIdentity('PUBLIC_TESTNET', digest);
      storage.close();
      storage = privateServerStorage(folder, 1048576);
      storage.bindIdentity('PUBLIC_TESTNET', digest);
      assert.throws(
        () => storage.bindIdentity('RESTRICTED_TESTNET_EXECUTOR', digest),
        /TESTNET_STORAGE_NAMESPACE/,
      );
      assert.throws(
        () => storage.bindIdentity('PUBLIC_TESTNET', '0x' + 'cd'.repeat(32)),
        /TESTNET_STORAGE_NAMESPACE/,
      );
      const identity = readFileSync(join(folder, 'network-identity.json'), 'utf8');
      assert.equal(JSON.parse(identity).digest, digest);
    } finally {
      storage.close();
      rmSync(parent, { recursive: true, force: true });
    }
  },
);

test(
  'one host nonce ownership directory rejects a second process/data-root claim and retains unknown locks',
  { skip: process.platform === 'win32' },
  async () => {
    const { claimNonceOwnership } = await import('../packages/testnet/src/nonce-ownership.ts');
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-nonce-owner-')));
    const address = '0x' + '1'.repeat(40);
    let lease;
    try {
      lease = claimNonceOwnership(folder, [address, address], '0x' + 'ab'.repeat(32));
      assert.throws(
        () => claimNonceOwnership(folder, [address], '0x' + 'ab'.repeat(32)),
        /EXECUTOR_NONCE_OWNERSHIP_LOCKED/,
      );
      lease.close();
      lease = claimNonceOwnership(folder, [address], '0x' + 'ab'.repeat(32));
      lease.close();
      assert.throws(
        () => claimNonceOwnership(folder, [address], '0x' + 'cd'.repeat(32)),
        /EXECUTOR_NONCE_OWNERSHIP_IDENTITY/,
      );
      writeFileSync(join(folder, address.slice(2) + '.lock'), '{"pid":999999}', { mode: 0o600 });
      assert.throws(
        () => claimNonceOwnership(folder, [address], '0x' + 'ab'.repeat(32)),
        /EXECUTOR_NONCE_OWNERSHIP_LOCKED/,
      );
      assert.equal(readFileSync(join(folder, address.slice(2) + '.lock'), 'utf8'), '{"pid":999999}');
    } finally {
      lease?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  },
);
