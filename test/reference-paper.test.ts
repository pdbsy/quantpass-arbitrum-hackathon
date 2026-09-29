import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as minutes from '../packages/automata/src/reference-minutes.ts';
import * as ema from '../packages/automata/src/reference-ema.ts';
import type { ReferenceObservation } from '../packages/market-data/src/robinhood.ts';
const identities = [1, 2, 3].map((n) => '4663:0x' + String(n).repeat(40));
function quotes(at: number, price = '100000000000000000000'): ReferenceObservation[] {
  return identities.map((identity, i) => ({
    kind: 'REFERENCE_ONLY',
    identity,
    assetId: 'asset-' + i,
    symbol: ['MSFT', 'NVDA', 'AAPL'][i]!,
    generatedAt: at,
    receivedAt: at,
    underlyingBid: '100',
    underlyingAsk: '101',
    multiplier: '1',
    tokenBidUsd18: price,
    tokenAskUsd18: (BigInt(price) + 10n ** 18n).toString(),
  }));
}
test('minute closes require all source clocks past the boundary and use only prices inside the minute', () => {
  const state = minutes.createMinutes(identities);
  let result = minutes.advanceMinutes(state, quotes(50000), 30000);
  assert.deepEqual(result.events, []);
  const crossing = quotes(60000, '200000000000000000000');
  crossing[1]!.generatedAt = 59000;
  result = minutes.advanceMinutes(result.state, crossing, 30000);
  assert.deepEqual(result.events, []);
  result = minutes.advanceMinutes(result.state, quotes(65000, '300000000000000000000'), 30000);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0], {
    kind: 'CLOSE',
    at: 60000,
    prices: {
      [identities[0]!]: '100000000000000000000',
      [identities[1]!]: '200000000000000000000',
      [identities[2]!]: '100000000000000000000',
    },
  });
  assert.equal(state.nextMinute, null);
});
test('duplicate quotes cannot form extra periods and same-time changed prices fail atomically', () => {
  const before = minutes.advanceMinutes(minutes.createMinutes(identities), quotes(50000), 30000).state;
  const duplicate = minutes.advanceMinutes(before, quotes(50000), 30000);
  assert.deepEqual(duplicate.state, before);
  assert.deepEqual(duplicate.events, []);
  assert.throws(
    () => minutes.advanceMinutes(before, quotes(50000, '101000000000000000000'), 30000),
    /REFERENCE_QUOTE_CONFLICT/,
  );
  assert.throws(() => minutes.advanceMinutes(before, quotes(49000), 30000), /REFERENCE_QUOTE_REGRESSION/);
});
test('missing or distant minute closes produce gaps rather than carry-forward prices', () => {
  const before = minutes.advanceMinutes(minutes.createMinutes(identities), quotes(10000), 30000).state;
  const after = minutes.advanceMinutes(before, quotes(180050000), 30000);
  assert.deepEqual(after.events, [{ kind: 'GAP', from: 0, until: 180000000 }]);
  assert.equal(Object.keys(after.state.pending).length, 1);
});
test('streaming EMA keeps exact original seed/recurrence and bounded state after 150 minutes', () => {
  let state = ema.createEma();
  for (let i = 1; i <= 30; i++) state = ema.advanceEma(state, BigInt(i).toString());
  assert.equal(state.fast.value, '23000000');
  assert.equal(state.slow.value, '15500000');
  state = ema.advanceEma(state, '31');
  assert.equal(state.fast.value, '24000000');
  assert.equal(state.slow.value, '16500000');
  for (let i = 32; i <= 160; i++) state = ema.advanceEma(state, BigInt(i).toString());
  assert.equal(state.fast.value, '153000000');
  assert.equal(state.slow.value, '145500000');
  assert.equal(state.fast.count, 15);
  assert.equal(state.slow.count, 30);
  assert.equal(state.slow.sum, '0');
});

import * as paper from '../packages/automata/src/reference-paper.ts';
import { captureReferenceBatch } from '../packages/market-data/src/batch.ts';
import type { ReadTransport } from '../packages/market-data/src/capture.ts';
function paperConfig() {
  return {
    version: 'alphaforge-reference-paper-1',
    mode: 'REFERENCE_PAPER',
    market: {
      selections: identities.map((identity, i) => ({
        chainId: 4663,
        contractAddress: identity.split(':')[1]!,
        symbol: ['MSFT', 'NVDA', 'AAPL'][i]!,
      })),
      maxAgeMs: 30000,
      maxQuoteSkewMs: 10000,
      maxCaptureSpanMs: 30000,
    },
    minuteCloseMaxAgeMs: 30000,
    gapPolicy: 'retain',
    feeBps: 30,
    slippageBps: 10,
    initialCash6: '1000000000',
    limits: { mode: 'off' },
  };
}
async function batch(at: number, bid = '100', ask = bid) {
  const assets = identities.map((identity, i) => ({
    id: '0x' + String(i + 1).repeat(64),
    tokenSymbol: ['MSFT', 'NVDA', 'AAPL'][i],
    tokenDecimals: 18,
    status: 'ASSET_STATUS_ACTIVE',
    currentMultiplier: '1',
    pendingMultiplier: '',
    deployments: [{ chainId: 4663, contractAddress: identity.split(':')[1] }],
  }));
  const transport: ReadTransport = async (url) => {
    if (url.endsWith('/assets')) return new Response(JSON.stringify({ assets }));
    const asset = assets.find((a) => url.endsWith('/' + a.tokenSymbol))!;
    return new Response(
      JSON.stringify({
        quotes: [
          {
            tokenSymbol: asset.tokenSymbol,
            deployments: asset.deployments,
            bid,
            ask,
            currency: 'USD',
            isTradingHalt: false,
            generatedAt: new Date(at).toISOString(),
          },
        ],
      }),
    );
  };
  return captureReferenceBatch(paperConfig().market, transport, () => at);
}
test('paper entry accounts for ask, adverse slippage and rounded fee with 18-decimal quantity', async () => {
  let state = paper.createPaper(paperConfig());
  state = paper.applyPaperBatch(state, await batch(50000, '100', '101')).state;
  const result = paper.executePaperOrder(state, identities[0]!, 'buy', '1000000000000000000');
  assert.equal(result.state.cash6, '898595697');
  assert.equal(result.state.positions[identities[0]!]!.cost6, '101404303');
  assert.equal(result.state.fees6, '303303');
  assert.equal(paper.paperNav(result.state, 50000), '998595697');
  assert.equal(result.events[0]!.kind, 'FILL');
});
test('paper exit preserves net PnL and charges bid-side slippage and sell fee', async () => {
  let state = paper.applyPaperBatch(paper.createPaper(paperConfig()), await batch(50000, '100', '101')).state;
  state = paper.executePaperOrder(state, identities[0]!, 'buy', '1000000000000000000').state;
  const result = paper.executePaperOrder(state, identities[0]!, 'sell', '1000000000000000000');
  assert.equal(result.state.cash6, '998195997');
  assert.equal(result.state.fees6, '603003');
  assert.equal(result.state.realizedPnl6, '-1804003');
  assert.equal(result.state.positions[identities[0]!]!.quantity18, '0');
});
test('one-third cap includes cost and fees and blocks new buying in an overweight position', async () => {
  let state = paper.applyPaperBatch(paper.createPaper(paperConfig()), await batch(50000)).state;
  assert.throws(
    () => paper.executePaperOrder(state, identities[0]!, 'buy', '4000000000000000000'),
    /ALLOCATION_LIMIT/,
  );
  state = paper.executePaperOrder(state, identities[0]!, 'buy', '3000000000000000000').state;
  state = paper.applyPaperBatch(state, await batch(65000, '200')).state;
  const before = structuredClone(state.positions);
  assert.throws(
    () => paper.executePaperOrder(state, identities[0]!, 'buy', '1000000000000000000'),
    /ALLOCATION_LIMIT/,
  );
  assert.deepEqual(state.positions, before);
});
test('virtual cash withdrawals never sell assets and cashflow-neutral return survives deposit and withdrawal', async () => {
  let state = paper.applyPaperBatch(paper.createPaper(paperConfig()), await batch(50000)).state;
  state = paper.executePaperOrder(state, identities[0]!, 'buy', '1000000000000000000').state;
  const ret = paper.paperReturn(state, 50000);
  state = paper.fundPaper(state, 'in', '100000000', 50000).state;
  assert.deepEqual(paper.paperReturn(state, 50000), ret);
  state = paper.fundPaper(state, 'out', '50000000', 50000).state;
  assert.deepEqual(paper.paperReturn(state, 50000), ret);
  const positions = structuredClone(state.positions);
  assert.throws(() => paper.fundPaper(state, 'out', '2000000000', 50000), /INSUFFICIENT_CASH/);
  assert.deepEqual(state.positions, positions);
  assert.equal(paper.paperNav(state, 80001), null);
  assert.throws(() => paper.fundPaper(state, 'in', '100', 80001), /STALE_PAPER_VALUATION/);
});
test('manual stop latches immediately, stale prices block fills, and later fresh input liquidates without a new entry', async () => {
  let state = paper.applyPaperBatch(paper.createPaper(paperConfig()), await batch(50000)).state;
  state = paper.executePaperOrder(state, identities[0]!, 'buy', '1000000000000000000').state;
  state = paper.stopPaper(state, 80001).state;
  assert.equal(state.status, 'liquidating');
  assert.equal(state.positions[identities[0]!]!.quantity18, '1000000000000000000');
  state = paper.applyPaperBatch(state, await batch(85000)).state;
  assert.equal(state.status, 'stopped');
  assert.equal(state.positions[identities[0]!]!.quantity18, '0');
  assert.throws(() => paper.executePaperOrder(state, identities[0]!, 'buy', '1'), /PAPER_NOT_RUNNING/);
});
test('configured percentage liquidation uses unit return and cannot be defeated by adding cash', async () => {
  const config = { ...paperConfig(), limits: { mode: 'percent', lowerBps: -500, upperBps: 500 } };
  let state = paper.applyPaperBatch(paper.createPaper(config), await batch(50000)).state;
  state = paper.executePaperOrder(state, identities[0]!, 'buy', '3000000000000000000').state;
  state = paper.fundPaper(state, 'in', '1000000000', 50000).state;
  state = paper.applyPaperBatch(state, await batch(65000, '50')).state;
  assert.equal(state.trigger, 'lower');
  assert.equal(state.status, 'stopped');
});
test('150+ closed minutes produce one entry per symbol, duplicate capture never produces another fill', async () => {
  let state = paper.createPaper(paperConfig());
  for (let i = 0; i <= 160; i++)
    state = paper.applyPaperBatch(state, await batch(i * 60000 + 50000, String(100 + i))).state;
  assert.equal(state.fills, 3);
  assert.equal(state.closedMinutes, 160);
  assert.equal(state.emas[identities[0]!]!.slow.count, 30);
  const result = paper.applyPaperBatch(state, await batch(160 * 60000 + 50000, '260'));
  assert.equal(result.state.fills, 3);
  assert.ok(!result.events.some((e) => e.kind === 'FILL'));
  assert.ok(JSON.stringify(result.state).length < 20000);
});
test('gap policy retains warmed EMA and records missing minutes rather than generated candles', async () => {
  let state = paper.createPaper(paperConfig());
  for (let i = 0; i <= 30; i++)
    state = paper.applyPaperBatch(state, await batch(i * 60000 + 50000, '100')).state;
  const result = paper.applyPaperBatch(state, await batch(40 * 60000 + 50000, '100'));
  assert.equal(result.state.closedMinutes, 31);
  assert.equal(result.state.emas[identities[0]!]!.slow.count, 30);
  assert.ok(result.events.some((e) => e.kind === 'GAP'));
});
test('configuration refuses implicit funds, extra fields, invalid limits and a different market policy', async () => {
  for (const config of [
    { ...paperConfig(), initialCash6: '0' },
    { ...paperConfig(), private: 'x' },
    { ...paperConfig(), feeBps: 10000 },
    { ...paperConfig(), limits: { mode: 'percent', lowerBps: 500 } },
  ])
    assert.throws(() => paper.createPaper(config), /INVALID_/);
  const state = paper.createPaper({ ...paperConfig(), market: { ...paperConfig().market, maxAgeMs: 10000 } });
  assert.throws(() => paper.applyPaperBatch(state, {} as never), /INVALID_/);
  const other = await batch(50000);
  assert.throws(() => paper.applyPaperBatch(state, other), /PAPER_POLICY_MISMATCH/);
});

import { BatchJournal } from '../packages/market-data/src/batch-journal.ts';
import * as ledger from '../packages/automata/src/reference-paper-journal.ts';
import * as worker from '../packages/automata/src/reference-paper-worker.ts';
import { mkdtempSync, realpathSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
function databases() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-paper-'))),
    sourcePath = join(dir, 'source.sqlite'),
    paperPath = join(dir, 'paper.sqlite');
  return { dir, sourcePath, paperPath, source: new BatchJournal(sourcePath) };
}
test('batch read-only mode never creates a missing database and forbids append without changing source bytes', async () => {
  const d = databases();
  try {
    assert.throws(
      () => new BatchJournal(join(d.dir, 'absent.sqlite'), { readOnly: true }),
      /JOURNAL_NOT_FOUND/,
    );
    assert.equal(existsSync(join(d.dir, 'absent.sqlite')), false);
    d.source.append(await batch(50000));
    d.source.close();
    const bytes = readFileSync(d.sourcePath);
    const reader = new BatchJournal(d.sourcePath, { readOnly: true });
    const next = reader.next(0)!;
    assert.equal(next.id, 1);
    assert.match(next.sha256, /^[0-9a-f]{64}$/);
    assert.equal(reader.next(1), null);
    assert.throws(() => reader.append(next.batch), /JOURNAL_READ_ONLY/);
    reader.close();
    assert.deepEqual(readFileSync(d.sourcePath), bytes);
  } finally {
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('paper ledger restarts exactly once and deterministic replay preserves fills and checkpoint', async () => {
  const d = databases();
  try {
    for (let i = 0; i <= 32; i++) d.source.append(await batch(i * 60000 + 50000, String(100 + i)));
    const reader = new BatchJournal(d.sourcePath, { readOnly: true });
    let journal = new ledger.PaperJournal(d.paperPath, paperConfig(), reader);
    for (let row = reader.next(0); row; row = reader.next(row.id)) journal.consume(row);
    const before = journal.snapshot();
    assert.equal(before.cursor, 33);
    assert.equal(before.state.fills, 3);
    journal.close();
    journal = new ledger.PaperJournal(d.paperPath, paperConfig(), reader);
    assert.deepEqual(journal.snapshot(), before);
    assert.throws(() => journal.consume(reader.entry(33)), /PAPER_INPUT_ORDER/);
    assert.deepEqual(journal.snapshot(), before);
    journal.close();
    reader.close();
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('ledger commits state and cursor atomically and refuses a stale writer revision', async () => {
  const d = databases();
  try {
    d.source.append(await batch(50000));
    d.source.append(await batch(65000));
    const reader = new BatchJournal(d.sourcePath, { readOnly: true });
    const a = new ledger.PaperJournal(d.paperPath, paperConfig(), reader),
      b = new ledger.PaperJournal(d.paperPath, paperConfig(), reader);
    a.consume(reader.entry(1));
    assert.throws(() => b.consume(reader.entry(1)), /PAPER_REVISION_CONFLICT/);
    const before = a.snapshot(),
      db = new DatabaseSync(d.paperPath);
    db.exec(
      "CREATE TRIGGER fail_step BEFORE INSERT ON paper_steps BEGIN SELECT RAISE(ABORT,'forced write failure'); END;",
    );
    assert.throws(() => a.consume(reader.entry(2)), /forced write failure/);
    assert.deepEqual(a.snapshot(), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM paper_steps').get()!.n, 1);
    db.exec('DROP TRIGGER fail_step');
    db.close();
    a.consume(reader.entry(2));
    assert.equal(a.snapshot().cursor, 2);
    a.close();
    b.close();
    reader.close();
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('ledger rejects a different source anchor or changed configured costs on restart', async () => {
  const d = databases();
  try {
    d.source.append(await batch(50000));
    const reader = new BatchJournal(d.sourcePath, { readOnly: true });
    new ledger.PaperJournal(d.paperPath, paperConfig(), reader).close();
    assert.throws(
      () => new ledger.PaperJournal(d.paperPath, { ...paperConfig(), feeBps: 31 }, reader),
      /PAPER_CONFIG_MISMATCH/,
    );
    const other = new BatchJournal(join(d.dir, 'other.sqlite'));
    other.append(await batch(51000));
    assert.throws(() => new ledger.PaperJournal(d.paperPath, paperConfig(), other), /PAPER_SOURCE_MISMATCH/);
    other.close();
    reader.close();
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('even refreshed outer hashes cannot legitimize fabricated paper balances', async () => {
  const d = databases();
  try {
    d.source.append(await batch(50000));
    const reader = new BatchJournal(d.sourcePath, { readOnly: true }),
      j = new ledger.PaperJournal(d.paperPath, paperConfig(), reader);
    j.consume(reader.entry(1));
    j.close();
    const db = new DatabaseSync(d.paperPath);
    assert.throws(() => db.exec("UPDATE paper_steps SET payload='{}'"), /immutable/);
    db.exec('DROP TRIGGER immutable_paper_step_update');
    const row = db.prepare('SELECT payload FROM paper_steps WHERE revision=1').get()!,
      payload = JSON.parse(row.payload as string);
    payload.result.state.cash6 = '9000000000';
    const raw = JSON.stringify(payload),
      hash = createHash('sha256').update(raw).digest('hex');
    db.prepare('UPDATE paper_steps SET payload=?,sha256=? WHERE revision=1').run(raw, hash);
    db.close();
    assert.throws(() => new ledger.PaperJournal(d.paperPath, paperConfig(), reader), /PAPER_REPLAY_MISMATCH/);
    reader.close();
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('consumer finishes bounded input, waits for appended rows and stops without consuming after cancellation', async () => {
  const d = databases();
  try {
    d.source.append(await batch(50000));
    const reader = new BatchJournal(d.sourcePath, { readOnly: true }),
      j = new ledger.PaperJournal(d.paperPath, paperConfig(), reader);
    let result = await worker.consumePaper(
      reader,
      j,
      { pollMs: 1, maxInputs: 1 },
      new AbortController().signal,
    );
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.inputs, 1);
    assert.equal(j.snapshot().cursor, 1);
    const controller = new AbortController();
    const promise = worker.consumePaper(reader, j, { pollMs: 1, maxInputs: 1 }, controller.signal);
    d.source.append(await batch(65000));
    result = await promise;
    assert.equal(result.inputs, 1);
    assert.equal(j.snapshot().cursor, 2);
    controller.abort();
    result = await worker.consumePaper(reader, j, { pollMs: 1, maxInputs: null }, controller.signal);
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.inputs, 0);
    j.close();
    reader.close();
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('paper CLI help is offline and invalid inputs exit before creating databases', () => {
  const d = databases(),
    script = join(process.cwd(), 'tools/automata/reference-paper.ts');
  try {
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /REFERENCE_PAPER/);
    const configPath = join(d.dir, 'invalid.json');
    writeFileSync(configPath, '{}');
    const result = spawnSync(process.execPath, [script, 'run', configPath, d.sourcePath, d.paperPath, '1'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.equal(existsSync(d.paperPath), false);
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});

test('CLI invalid consumer policy does not initialize a paper database after parsing a valid capital config', async () => {
  const d = databases(),
    script = join(process.cwd(), 'tools/automata/reference-paper.ts');
  try {
    d.source.append(await batch(50000));
    const configPath = join(d.dir, 'config.json');
    writeFileSync(configPath, JSON.stringify(paperConfig()));
    const result = spawnSync(
      process.execPath,
      [script, 'run', configPath, d.sourcePath, d.paperPath, '1', '0'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.equal(existsSync(d.paperPath), false);
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('paper price thresholds trigger on fresh quotes before EMA warmup', async () => {
  const cfg = {
    ...paperConfig(),
    limits: {
      mode: 'price',
      identity: identities[0],
      lowerUsd18: '90000000000000000000',
      upperUsd18: '110000000000000000000',
    },
  };
  let state = paper.applyPaperBatch(paper.createPaper(cfg), await batch(50000)).state;
  state = paper.executePaperOrder(state, identities[0]!, 'buy', '1000000000000000000').state;
  const result = paper.applyPaperBatch(state, await batch(65000, '110'));
  assert.equal(result.state.trigger, 'upper');
  assert.equal(result.state.status, 'stopped');
  assert.equal(result.state.fills, 2);
  assert.equal(result.state.closedMinutes, 1);
});
test('zero-cash exit preserves historical unit value for a later virtual deposit', async () => {
  let state = paper.applyPaperBatch(paper.createPaper(paperConfig()), await batch(50000, '100', '101')).state;
  state = paper.executePaperOrder(state, identities[0]!, 'buy', '1000000000000000000').state;
  state = paper.executePaperOrder(state, identities[0]!, 'sell', '1000000000000000000').state;
  const value = paper.paperReturn(state, 50000);
  state = paper.fundPaper(state, 'out', state.cash6, 50000).state;
  assert.equal(state.units.numerator, '0');
  assert.deepEqual(paper.paperReturn(state, 50000), value);
  state = paper.fundPaper(state, 'in', '100000000', 50000).state;
  assert.deepEqual(paper.paperReturn(state, 50000), value);
});
test('quote conflicts are journaled diagnostically without advancing strategy or changing valuations', async () => {
  const before = paper.applyPaperBatch(paper.createPaper(paperConfig()), await batch(50000)).state;
  const result = paper.applyPaperBatch(before, await batch(50000, '101'));
  assert.equal(result.events[0]!.reason, 'REFERENCE_QUOTE_CONFLICT');
  assert.deepEqual(result.state.minutes, before.minutes);
  assert.deepEqual(result.state.quotes, before.quotes);
  assert.equal(result.state.fills, 0);
});
test('minute-close policy rejects stale final samples while keeping valid surrounding reference batches', async () => {
  const state = paper.applyPaperBatch(paper.createPaper(paperConfig()), await batch(10000)).state;
  const result = paper.applyPaperBatch(state, await batch(65000));
  assert.equal(result.state.closedMinutes, 0);
  assert.equal(result.state.fills, 0);
  assert.deepEqual(result.events[0], { kind: 'GAP', from: 0, until: 60000 });
});
test('continuous consumer reloads owner virtual cash controls rather than failing on a stale writer', async () => {
  const d = databases();
  try {
    d.source.append(await batch(50000));
    d.source.append(await batch(55000));
    const reader = new BatchJournal(d.sourcePath, { readOnly: true });
    const a = new ledger.PaperJournal(d.paperPath, paperConfig(), reader);
    a.consume(reader.entry(1));
    const b = new ledger.PaperJournal(d.paperPath, paperConfig(), reader);
    b.fund('in', '100000000', 52000);
    b.close();
    const result = await worker.consumePaper(
      reader,
      a,
      { pollMs: 1, maxInputs: 1 },
      new AbortController().signal,
    );
    assert.equal(result.status, 'COMPLETED');
    assert.equal(a.snapshot().revision, 3);
    assert.equal(a.snapshot().state.cash6, '1100000000');
    a.close();
    reader.close();
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('accepted old batches after a newer control cannot rewind time or place historical orders', async () => {
  let state = paper.applyPaperBatch(paper.createPaper(paperConfig()), await batch(50000)).state;
  state = paper.fundPaper(state, 'in', '100000000', 55000).state;
  const result = paper.applyPaperBatch(state, await batch(52000));
  assert.equal(result.state.clock, 55000);
  assert.equal(result.events[0]!.reason, 'PAPER_INPUT_BEFORE_CONTROL');
  assert.deepEqual(result.state.minutes, state.minutes);
});
test('new-entry transaction costs can trigger the configured return stop immediately', async () => {
  const cfg = { ...paperConfig(), limits: { mode: 'percent', lowerBps: -1, upperBps: null } };
  let state = paper.createPaper(cfg);
  for (let i = 0; i <= 30; i++)
    state = paper.applyPaperBatch(state, await batch(i * 60000 + 50000, String(100 + i))).state;
  assert.equal(state.status, 'stopped');
  assert.equal(state.trigger, 'lower');
  assert.equal(state.fills, 2);
});

test('new batch evidence is losslessly compressed while its identity hashes the original receipt payload', async () => {
  const d = databases();
  try {
    const input = await batch(50000);
    d.source.append(input);
    const db = new DatabaseSync(d.sourcePath),
      row = db.prepare('SELECT payload,sha256 FROM reference_batches WHERE id=1').get()!;
    assert.match(row.payload as string, /^AFG1:/);
    assert.equal(row.sha256, createHash('sha256').update(JSON.stringify(input)).digest('hex'));
    assert.deepEqual(d.source.read(1), input);
    db.close();
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('compressed evidence corruption cannot become a reference observation', async () => {
  const d = databases();
  try {
    d.source.append(await batch(50000));
    const db = new DatabaseSync(d.sourcePath);
    db.exec('DROP TRIGGER immutable_batch_update');
    db.prepare('UPDATE reference_batches SET payload=? WHERE id=1').run('AFG1:AAAA');
    assert.throws(() => d.source.read(1), /BATCH_INTEGRITY_FAILED/);
    db.close();
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});

import { gzipSync } from 'node:zlib';
import { decodeBatchPayload } from '../packages/market-data/src/batch-codec.ts';
test('compressed receipt decoding refuses expansion beyond the supported raw evidence bound', () => {
  const bytes = gzipSync(Buffer.alloc(48 * 1024 * 1024 + 1, 32));
  assert.throws(() => decodeBatchPayload('AFG1:' + bytes.toString('base64')), /BATCH_INTEGRITY_FAILED/);
});
test('fund and stop controls survive replay while duplicate or changed batch receipts cannot advance it', async () => {
  const d = databases();
  try {
    for (let i = 0; i <= 30; i++) d.source.append(await batch(i * 60000 + 50000, String(100 + i)));
    const reader = new BatchJournal(d.sourcePath, { readOnly: true }),
      j = new ledger.PaperJournal(d.paperPath, paperConfig(), reader);
    for (let row = reader.next(0); row; row = reader.next(row.id)) j.consume(row);
    j.fund('in', '100000000', 1850000);
    j.fund('out', '100000000', 1850000);
    j.stop(1850000);
    const before = j.snapshot();
    assert.equal(before.state.status, 'stopped');
    assert.throws(() => j.consume({ ...reader.entry(31), id: 32 }), /PAPER_INPUT_ORDER/);
    j.close();
    const again = new ledger.PaperJournal(d.paperPath, paperConfig(), reader);
    assert.deepEqual(again.snapshot(), before);
    again.close();
    reader.close();
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('completed worker report never counts rejected market input as a successful fill', async () => {
  const d = databases();
  try {
    const good = await batch(50000);
    d.source.append({ ...good, status: 'REJECTED', reason: 'BATCH_QUOTE_SKEW', observations: null });
    const reader = new BatchJournal(d.sourcePath, { readOnly: true }),
      j = new ledger.PaperJournal(d.paperPath, paperConfig(), reader);
    const result = await worker.consumePaper(
      reader,
      j,
      { pollMs: 1, maxInputs: 1 },
      new AbortController().signal,
    );
    assert.equal(result.accepted, 0);
    assert.equal(result.rejected, 1);
    assert.equal(result.fills, 0);
    j.close();
    reader.close();
  } finally {
    d.source.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});

test('order counter exhaustion cannot partially debit cash or create an unrecorded holding', async () => {
  let state = paper.createPaper(paperConfig());
  for (let i = 0; i <= 30; i++)
    state = paper.applyPaperBatch(state, await batch(i * 60000 + 50000, '100')).state;
  state = paper.applyPaperBatch(state, await batch(31 * 60000 + 50000, '120')).state;
  state.fills = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(state.positions),
    cash = state.cash6;
  const result = paper.applyPaperBatch(state, await batch(32 * 60000 + 50000, '120'));
  assert.equal(result.state.cash6, cash);
  assert.deepEqual(result.state.positions, before);
  assert.ok(result.events.some((e) => e.reason === 'PAPER_COUNTER_LIMIT'));
});
