import assert from 'node:assert/strict';
import test from 'node:test';
import { candleDetails, candleIndex } from '../apps/web/src/kline-hover.ts';

const candle = {
  time: Date.UTC(2026, 8, 12, 0),
  open: 10000,
  high: 11500,
  low: 9500,
  close: 11000,
  volume: 125.25,
  quoteVolume: 1260000,
};
test('candle details use candle open as baseline and the supplied turnover', () => {
  assert.deepEqual(candleDetails(candle), {
    time: '2026-09-12 00:00 UTC',
    open: '100.00 ETH',
    close: '110.00 ETH',
    high: '115.00 ETH',
    low: '95.00 ETH',
    change: '+10.00 ETH',
    changePercent: '+10.00%',
    amplitude: '20.00%',
    volume: '125.25 Pass',
    turnover: '12,600.00 ETH',
  });
  const falling = candleDetails({ ...candle, close: 9500 });
  assert.equal(falling.change, '−5.00 ETH');
  assert.equal(falling.changePercent, '−5.00%');
  assert.equal(candleDetails({ ...candle, close: candle.open }).change, '0.00 ETH');
});
test('missing or invalid values stay unavailable and zero is not treated as missing', () => {
  const zero = candleDetails({ ...candle, open: 0, volume: 0, quoteVolume: 0 });
  assert.equal(zero.changePercent, '—');
  assert.equal(zero.amplitude, '—');
  assert.equal(zero.volume, '0 Pass');
  assert.equal(zero.turnover, '0.00 ETH');
  const missing = candleDetails({ time: NaN, open: NaN, high: Infinity, low: 9500, close: NaN });
  for (const key of [
    'time',
    'open',
    'high',
    'close',
    'change',
    'changePercent',
    'amplitude',
    'volume',
    'turnover',
  ] as const)
    assert.equal(missing[key], '—', key);
  const invalid = candleDetails({ ...candle, time: 9e15, high: 1, low: 2, volume: -1, quoteVolume: -1 });
  for (const key of ['time', 'amplitude', 'volume', 'turnover'] as const) assert.equal(invalid[key], '—');
  assert.equal(candleDetails({ ...candle, open: Number.MIN_VALUE }).changePercent, '—');
});
test('pointer bins match candle centers and reject axes instead of selecting an edge candle', () => {
  for (const count of [1, 24, 56, 90]) {
    for (let i = 0; i < count; i++)
      assert.equal(candleIndex(16 + ((i + 0.5) / count) * 802, count, 16, 818), i);
    assert.equal(candleIndex(16, count, 16, 818), 0);
    assert.equal(candleIndex(818, count, 16, 818), count - 1);
    assert.equal(candleIndex(15, count, 16, 818), null);
    assert.equal(candleIndex(819, count, 16, 818), null);
  }
  assert.equal(candleIndex(NaN, 24, 16, 818), null);
  assert.equal(candleIndex(100, 0, 16, 818), null);
  assert.equal(candleIndex(100, 1.5, 16, 818), null);
  assert.equal(candleIndex(100, 24, 16, 16), null);
});

test('amplitude never treats a non-finite price as a valid zero percent', () => {
  for (const field of ['open', 'high', 'low'] as const)
    for (const value of [Infinity, -Infinity, NaN])
      assert.equal(candleDetails({ ...candle, [field]: value }).amplitude, '—', `${field}: ${value}`);
});
