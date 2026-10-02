import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceJournal } from '../packages/testnet/src/evidence-journal.ts';
import { tradingRpcFixture, tradingFixtureAddress as address } from './helpers/testnet-trading-rpc.ts';
import { readTradingSnapshot } from '../packages/testnet/src/trading-reader.ts';
import { tradingInterface } from '../packages/testnet/src/trading-abi.ts';
import { decodeTradingEvent } from '../apps/server/src/trading-vault-integration.ts';
import { asHexData, asTransactionHash, asBlockHash } from '../packages/chain-adapter/src/types.ts';
import type { CanonicalContractEvent } from '../packages/chain-adapter/src/reconciliation.ts';
async function evidence() {
  const f = tradingRpcFixture(),
    snapshot = await readTradingSnapshot(f.client, f.manifest, f.inventory);
  const events: CanonicalContractEvent[] = [];
  const log = (name: string, args: readonly unknown[]) => {
    const encoded = tradingInterface.encodeEventLog(tradingInterface.getEvent(name)!, [...args]);
    const raw = {
      chainId: 46630,
      address: address(50),
      blockNumber: 16n,
      blockHash: asBlockHash(snapshot.blockHash),
      transactionHash: asTransactionHash('0x' + String(events.length + 1).padStart(64, '0')),
      transactionIndex: events.length,
      logIndex: events.length,
      topics: encoded.topics.map(asHexData),
      data: asHexData(encoded.data),
      removed: false,
    };
    events.push({ ...raw, ...decodeTradingEvent(raw)! });
  };
  log('Deposited', [1000000000n, 1000000000n, 1000n * 10n ** 18n]);
  for (let i = 0; i < 3; i++)
    log('SwapExecuted', [BigInt(i + 2), 1n, address(10 + i), true, 100000000n, 10n ** 18n]);
  return { snapshot, events };
}
test('personal NAV evidence survives restart and a separate SQLite backup, with original event and source digests replayed', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-evidence-')),
    path = join(folder, 'evidence.sqlite'),
    identity = '0x' + 'ab'.repeat(32);
  let journal = new EvidenceJournal(path, identity);
  try {
    const e = await evidence(),
      first = journal.append(e.snapshot, e.events, 1800000000000);
    assert.equal(first.sequence, 1);
    assert.equal(first.performance.pnlUsdc, '0');
    assert.equal(journal.append(e.snapshot, e.events, 1800000001000).sequence, 1);
    const result = journal.verify();
    assert.equal(result.records, 1);
    assert.equal(result.tip, first.hash);
    const backup = join(folder, 'backup.sqlite');
    await journal.backupTo(backup);
    journal.close();
    journal = new EvidenceJournal(path, identity);
    assert.deepEqual(journal.verify(), result);
    const original = readFileSync(backup),
      copy = join(folder, 'restore-copy.sqlite');
    copyFileSync(backup, copy);
    const restored = new EvidenceJournal(copy, identity);
    try {
      assert.deepEqual(restored.verify(), result);
    } finally {
      restored.close();
    }
    assert.deepEqual(readFileSync(backup), original);
    journal.close();
    assert.throws(() => new EvidenceJournal(path, '0x' + 'cd'.repeat(32)), /EVIDENCE_IDENTITY/);
  } finally {
    journal.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
test('mutated NAV, source payload or hash-chain tip cannot produce a successful replay', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-evidence-corrupt-')),
    journal = new EvidenceJournal(join(folder, 'e.sqlite'), '0x' + 'ab'.repeat(32));
  try {
    const e = await evidence();
    assert.throws(
      () => journal.append({ ...e.snapshot, vaultEquity: '1000000001' }, e.events, 1800000000000),
      /EVIDENCE_RECONCILIATION/,
    );
    assert.throws(
      () => journal.append(e.snapshot, [...e.events.slice(0, -1)], 1800000000000),
      /EVIDENCE_RECONCILIATION/,
    );
    journal.append(e.snapshot, e.events, 1800000000000);
    journal.db.prepare('UPDATE evidence_records SET payload=? WHERE sequence=1').run('{}');
    assert.throws(() => journal.verify(), /EVIDENCE/);
  } finally {
    journal.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
