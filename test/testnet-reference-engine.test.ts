import assert from 'node:assert/strict';
import test from 'node:test';
import { captureReferenceBatch } from '../packages/market-data/src/batch.ts';
import { createReferenceEngine, advanceReferenceEngine } from '../packages/testnet/src/reference-engine.ts';
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
async function batch(at: number, pending = '', multiplier = '2') {
  return captureReferenceBatch(
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
            ? {
                assets: assets.map((a) => ({
                  ...a,
                  currentMultiplier: multiplier,
                  pendingMultiplier: pending,
                })),
              }
            : {
                quotes: [
                  {
                    tokenSymbol: url.split('/').at(-1),
                    deployments: assets.find((a) => a.tokenSymbol === url.split('/').at(-1))!.deployments,
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
}
test('official raw midpoint applies multiplier; restart replay preserves EMA and gaps add no minutes', async () => {
  let s = createReferenceEngine(terms);
  const batches = [];
  for (let minute = 0; minute < 32; minute++) {
    const b = await batch(100000 + minute * 60000);
    batches.push(b);
    const next = advanceReferenceEngine(s, b);
    s = next.state;
    assert.equal(next.quotes![0]!.priceUsdc, '202000000');
  }
  let restored = createReferenceEngine(terms);
  for (const b of batches) restored = advanceReferenceEngine(restored, b).state;
  assert.deepEqual(restored, s);
  assert.deepEqual(s.signals, ['SELL', 'SELL', 'SELL']);
  const gap = advanceReferenceEngine(s, await batch(100000 + 40 * 60000)).state;
  assert.equal(gap.ema[terms[0]!.identity]!.slow.count, s.ema[terms[0]!.identity]!.slow.count);
  const forged = structuredClone(batches[0]!);
  forged.observations![0]!.tokenAskUsd18 = '1';
  assert.throws(() => advanceReferenceEngine(createReferenceEngine(terms), forged), /MISMATCH/);
});
test('pending or changed multipliers pause feeds and trades, including rejected captures and later normal quotes', async () => {
  for (const b of [await batch(100000, '3'), await batch(100000, '', '3')]) {
    const next = advanceReferenceEngine(createReferenceEngine(terms), b);
    assert.equal(next.state.paused, 'TERMS_CHANGED');
    assert.equal(next.quotes, null);
    assert.equal(advanceReferenceEngine(next.state, await batch(160000)).state.paused, 'TERMS_CHANGED');
  }
});
