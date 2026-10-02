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
