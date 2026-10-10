import assert from 'node:assert/strict';
import test from 'node:test';
import {
  referenceInspectionDetails,
  referenceInspectionPosition,
} from '../apps/web/src/reference-inspection.ts';

test('an initial reference exposes its price but no invented executed price, time, volume or OHLCV', () => {
  for (const symbol of ['TSLA', 'amzn']) {
    const details = referenceInspectionDetails(symbol, '0.5');
    assert.ok(details);
    assert.equal(details.heading, `${symbol.toUpperCase()} PASS details`);
    assert.equal(details.kind, 'Initial reference');
    assert.deepEqual(Object.fromEntries(details.fields.map((field) => [field.key, field.value])), {
      symbol: symbol.toUpperCase(),
      price: '0.50 AF-USDC/PASS',
      source: 'Initial reference',
      status: 'No indexed trades',
      executedPrice: '—',
      tradeTime: '—',
      volume: '—',
    });
    assert.doesNotMatch(JSON.stringify(details.fields), /"(?:open|high|low|close)"|2026-|"value":"0"/);
    assert.match(details.note, /not a guaranteed resale price/);
  }
  for (const symbol of ['AAPL', '<svg>', '']) assert.equal(referenceInspectionDetails(symbol, '0.5'), null);
  for (const reference of ['', '0', 'NaN', '0.51', 'Infinity', '0.5 ETH'])
    assert.equal(referenceInspectionDetails('AMZN', reference), null);
});

test('pointer positions select the actual reference line in desktop and mobile plot geometry', () => {
  for (const bottom of [282, 370]) {
    const bounds = { left: 16, right: 818, top: 20, bottom, lineY: (20 + bottom) / 2 };
    for (const x of [16, 417, 818])
      for (const y of [20, bounds.lineY, bottom])
        assert.deepEqual(referenceInspectionPosition(x, y, bounds), { x, y: bounds.lineY });
    for (const [x, y] of [
      [15, bounds.lineY],
      [819, bounds.lineY],
      [417, 19],
      [417, bottom + 1],
      [NaN, bounds.lineY],
      [417, Infinity],
    ])
      assert.equal(
        referenceInspectionPosition(x!, y!, bounds),
        null,
        'axes and invalid points are not references',
      );
    for (const invalid of [
      { ...bounds, right: 16 },
      { ...bounds, bottom: 20 },
      { ...bounds, lineY: bottom + 1 },
      { ...bounds, top: NaN },
    ])
      assert.equal(referenceInspectionPosition(417, bounds.lineY, invalid), null);
  }
});
