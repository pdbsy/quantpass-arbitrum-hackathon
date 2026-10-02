import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceJournal } from '../packages/testnet/src/evidence-journal.ts';
import { privateServerStorage } from '../packages/testnet/src/private-storage.ts';
import { ServerBackups, verifyServerBackup } from '../packages/testnet/src/server-backups.ts';
import { OrderJournal } from '../packages/testnet/src/order-journal.ts';
import { BatchJournal, REFERENCE_BATCH_APPLICATION_ID } from '../packages/market-data/src/batch-journal.ts';
import { captureReferenceBatch } from '../packages/market-data/src/batch.ts';
import { createReferenceEngine, advanceReferenceEngine } from '../packages/testnet/src/reference-engine.ts';
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

test(
  'private automatic backups replay populated reference batches and retain unresolved nonce reservations',
  { skip: process.platform === 'win32' },
  async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-private-backup-'))),
      storage = privateServerStorage(join(parent, 'data'), 8000000000);
    const orders = new OrderJournal(storage.databasePath('orders'), identity),
      batches = new BatchJournal(storage.databasePath('reference-batches', REFERENCE_BATCH_APPLICATION_ID));
    const assets = ['MSFT', 'NVDA', 'AAPL'].map((symbol, i) => ({
      id: '0x' + String(i + 1).repeat(64),
      tokenSymbol: symbol,
      tokenDecimals: 18,
      status: 'ASSET_STATUS_ACTIVE',
      currentMultiplier: '2',
      pendingMultiplier: '',
      deployments: [{ chainId: 4663, contractAddress: '0x' + String(i + 1).repeat(40) }],
    }));
    const terms = assets.map((a) => ({
      identity: '4663:' + a.deployments[0]!.contractAddress,
      assetId: a.id,
      symbol: a.tokenSymbol,
      multiplier: '2',
    }));
    try {
      let expected = createReferenceEngine(terms);
      for (let minute = 0; minute < 32; minute++) {
        const at = 100000 + minute * 60000;
        const batch = await captureReferenceBatch(
          {
            selections: assets.map((a) => ({
              chainId: 4663,
              contractAddress: a.deployments[0]!.contractAddress,
              symbol: a.tokenSymbol,
            })),
            maxAgeMs: 30000,
            maxQuoteSkewMs: 10000,
            maxCaptureSpanMs: 1000,
          },
          async (url) =>
            new Response(
              JSON.stringify(
                url.endsWith('/assets')
                  ? { assets }
                  : {
                      quotes: [
                        {
                          tokenSymbol: url.split('/').at(-1),
                          deployments: assets.find((a) => a.tokenSymbol === url.split('/').at(-1))!
                            .deployments,
                          bid: '100',
                          ask: '102',
                          currency: 'USD',
                          isTradingHalt: false,
                          generatedAt: new Date(at).toISOString(),
                        },
                      ],
                    },
              ),
            ),
          () => at,
        );
        batches.append(batch);
        expected = advanceReferenceEngine(expected, batch).state;
      }
      const executor = '0x' + '22'.repeat(20);
      orders.prepare({
        id: 'retained-nonce',
        chainId: 46630,
        owner: '0x' + '11'.repeat(20),
        executor,
        vault: '0x' + '33'.repeat(20),
        manifestDigest: identity,
        sourceDigest: identity,
        grantVersion: '1',
        stateVersion: '4',
        snapshotHash: identity,
        calldata: '0x12345678',
        createdAt: 1000,
      });
      orders.reserve('retained-nonce', '7');
      const sources = [
        { name: 'orders', db: orders.db },
        { name: 'reference-batches', db: batches.database, referenceTerms: terms },
      ];
      const backups = new ServerBackups(storage, identity, sources),
        report = await backups.create(1800000000000, 'AUTOMATIC'),
        folder = join(storage.folder, 'backups', report.id);
      const originals = report.files.map((f) => readFileSync(join(folder, f.name + '.sqlite')));
      const restored = await verifyServerBackup(folder, identity);
      const reference = restored.replay.find((r) => r.name === 'reference-batches')!;
      assert.deepEqual(reference.ema, expected.ema);
      assert.equal(reference.lastMinute, expected.lastMinute);
      assert.deepEqual(reference.terms, terms);
      assert.equal(reference.referencePaused, null);
      const restoredOrders = restored.replay.find((r) => r.name === 'orders')!;
      assert.equal(restoredOrders.integrity, 'VERIFIED');
      assert.equal(orders.get('retained-nonce')!.state, 'RESERVED');
      assert.equal(orders.blocked(executor), true);
      for (const [i, file] of report.files.entries())
        assert.deepEqual(readFileSync(join(folder, file.name + '.sqlite')), originals[i]);
      assert.equal(report.kind, 'AUTOMATIC');
      assert.equal(
        report.files.find((f) => f.name === 'reference-batches')!.tables.reference_batches!.rows,
        32,
      );
      assert.equal(new ServerBackups(storage, identity, sources).status().lastVerifiedAt, 1800000000000);
    } finally {
      orders.close();
      batches.close();
      storage.close();
      rmSync(parent, { recursive: true, force: true });
    }
  },
);
