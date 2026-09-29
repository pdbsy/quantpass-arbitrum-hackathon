import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datasetFrames } from '../packages/automata/src/fixtures.ts';
import {
  beginResearch,
  advanceResearch,
  replayResearch,
  researchReport,
} from '../tools/automata/research.mjs';

test('closed-period EMA decisions execute at the next observation, never on their signal price', () => {
  const result = replayResearch();
  const buy = result.run.trades.find((t) => t.side === 'buy');
  assert.equal(buy.at, 32000);
  assert.equal(buy.price, '102000000');
  assert.equal(result.decisions[0].signalFrame, 31);
  assert.equal(result.decisions[0].executionFrame, 32);
  assert.equal(result.run.trades.length, 4);
});
test('research checkpoint resume and paced recorded events preserve the entire ledger', async () => {
  const frames = datasetFrames('ema-cycle');
  const full = replayResearch();
  let resumed = frames.slice(0, 50).reduce(advanceResearch, beginResearch());
  resumed = JSON.parse(JSON.stringify(resumed));
  resumed = frames.slice(50).reduce(advanceResearch, resumed);
  assert.deepEqual(resumed, full);
  let paced = beginResearch();
  for (const frame of frames) {
    await new Promise((r) => setImmediate(r));
    paced = advanceResearch(paced, frame);
  }
  assert.deepEqual(paced, full);
  for (let i = 0; i < 20; i++) assert.deepEqual(replayResearch(), full);
});
test('changing only future observations cannot alter earlier signals or fills', () => {
  const frames = datasetFrames('ema-cycle');
  const changed = structuredClone(frames);
  for (const frame of changed.slice(50))
    for (const quote of frame.quotes) {
      quote.bid = '900000000';
      quote.ask = '900000000';
    }
  assert.deepEqual(
    replayResearch({ frames: frames.slice(0, 50) }),
    replayResearch({ frames: changed.slice(0, 50) }),
  );
  const original = replayResearch({ frames }),
    revised = replayResearch({ frames: changed });
  assert.deepEqual(
    original.decisions.filter((d) => d.signalFrame <= 50),
    revised.decisions.filter((d) => d.signalFrame <= 50),
  );
  assert.deepEqual(
    original.run.trades.filter((t) => t.at <= 50000),
    revised.run.trades.filter((t) => t.at <= 50000),
  );
  assert.notDeepEqual(original, revised);
});
test('research manifests bind data/model/code and fixed-path stress costs reconcile', () => {
  const first = researchReport();
  assert.equal(first.manifestId, researchReport().manifestId);
  const changed = datasetFrames('ema-cycle');
  changed[0].quotes[0].bid = '99000000';
  assert.notEqual(first.manifestId, researchReport({ frames: changed }).manifestId);
  assert.notEqual(first.manifestId, researchReport({ feeBps: 20 }).manifestId);
  assert.equal(first.fixedPathCosts[0].endEquity, '1150000000');
  assert.equal(first.fixedPathCosts[1].endEquity, '1148850000');
  assert.equal(first.fixedPathCosts[2].endEquity, '1145975375');
  assert.equal(first.fixedPathCosts[3].endEquity, '1143100750');
  for (const row of first.fixedPathCosts)
    assert.equal(BigInt(row.endEquity), 1000000000n + BigInt(row.grossPnl) - BigInt(row.fees));
});
