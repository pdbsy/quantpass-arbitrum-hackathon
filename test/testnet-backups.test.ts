import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceJournal } from '../packages/testnet/src/evidence-journal.ts';
import { privateServerStorage } from '../packages/testnet/src/private-storage.ts';
import { ServerBackups, verifyServerBackup } from '../packages/testnet/src/server-backups.ts';
const identity = '0x' + 'ab'.repeat(32);
test(
  'consistent backups include all ledger rows, preserve originals during independent restore and obey total retained capacity',
  { skip: process.platform === 'win32' },
  async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-backup-'))),
      storage = privateServerStorage(join(parent, 'data'), 8000000000),
      journal = new EvidenceJournal(storage.databasePath('evidence-owner'), identity);
    try {
      const backups = new ServerBackups(storage, identity, [
        { name: 'evidence-owner', db: journal.db, evidenceIdentity: identity },
      ]);
      assert.equal(backups.due(1800000000000), true);
      const report = await backups.create(1800000000000, 'MANUAL');
      assert.equal(report.state, 'VERIFIED');
      assert.equal(backups.due(1800000000000 + 86399999), false);
      assert.equal(backups.due(1800000000000 + 86400000), true);
      const file = join(storage.folder, 'backups', report.id, 'evidence-owner.sqlite'),
        before = readFileSync(file);
      const restored = await verifyServerBackup(join(storage.folder, 'backups', report.id), identity);
      assert.equal(restored.state, 'VERIFIED');
      assert.deepEqual(readFileSync(file), before);
      const restarted = new ServerBackups(storage, identity, [
        { name: 'evidence-owner', db: journal.db, evidenceIdentity: identity },
      ]);
      assert.equal(restarted.status().lastVerifiedAt, 1800000000000);
      assert.throws(
        () =>
          new ServerBackups(storage, identity, [
            { name: 'another-owner', db: journal.db, evidenceIdentity: identity },
          ]),
        /BACKUP_SOURCE_IDENTITY/,
      );
      const manifestFile = join(storage.folder, 'backups', report.id, 'manifest.json');
      const originalManifest = readFileSync(manifestFile, 'utf8');
      for (const mutated of [
        { ...report, createdAt: -1 },
        { ...report, kind: 'INVALID' },
        { ...report, files: [] },
        { ...report, extra: true },
      ]) {
        writeFileSync(manifestFile, JSON.stringify(mutated));
        assert.throws(
          () =>
            new ServerBackups(storage, identity, [
              { name: 'evidence-owner', db: journal.db, evidenceIdentity: identity },
            ]),
          /BACKUP_/,
        );
      }
      writeFileSync(manifestFile, originalManifest);
      await restarted.verifyLatest();
      assert.equal(restarted.status().state, 'VERIFIED');
      writeFileSync(file, Buffer.from('corrupted'), { mode: 0o600 });
      await assert.rejects(
        verifyServerBackup(join(storage.folder, 'backups', report.id), identity),
        /BACKUP/,
      );
    } finally {
      journal.close();
      storage.close();
      rmSync(parent, { recursive: true, force: true });
    }
  },
);
test(
  'capacity rejection creates no partial backup or deletion and cannot bypass the configured source identity',
  { skip: process.platform === 'win32' },
  async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-backup-capacity-'))),
      storage = privateServerStorage(join(parent, 'data'), 1048576),
      journal = new EvidenceJournal(storage.databasePath('evidence-owner'), identity);
    try {
      const backups = new ServerBackups(storage, identity, [
        { name: 'evidence-owner', db: journal.db, evidenceIdentity: identity },
      ]);
      journal.db.exec(
        'CREATE TABLE retained (data TEXT); INSERT INTO retained VALUES(hex(zeroblob(400000)))',
      );
      await assert.rejects(backups.create(1800000000000, 'MANUAL'), /BACKUP_CAPACITY/);
      assert.equal(existsSync(join(storage.folder, 'backups')), false);
      assert.equal(journal.db.prepare('SELECT length(data) AS n FROM retained').get()!.n, 800000);
    } finally {
      journal.close();
      storage.close();
      rmSync(parent, { recursive: true, force: true });
    }
  },
);
