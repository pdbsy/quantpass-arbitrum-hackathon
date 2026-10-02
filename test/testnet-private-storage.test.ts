import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
