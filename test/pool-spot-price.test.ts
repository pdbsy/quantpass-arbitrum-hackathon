import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPoolSpotPrice } from '../apps/web/src/pool-spot-price.ts';

test('pool spot keeps the real sub-micro AMZN price movement in its reserve ratio', () => {
  assert.equal(formatPoolSpotPrice('250000020097', '499999960108008183036872'), '0.500000080086');
  assert.equal(formatPoolSpotPrice('250000000000', '500000000000000000000000'), '0.50');
  assert.equal(formatPoolSpotPrice('250001000000', '500000000000000000000000'), '0.500002');
});

test('pool ratio rounds half up to twelve decimals without converting reserves to Number', () => {
  assert.equal(formatPoolSpotPrice('1', '2000000000000000000000000'), '0.000000000001');
  assert.equal(formatPoolSpotPrice('3999999999999', '2000000000000000000000000'), '2.00');
  assert.equal(formatPoolSpotPrice('9007199254740993', '1000000000000000000'), '9007199254.740993');
});

test('missing, zero, malformed and out-of-range reserves remain unavailable', () => {
  for (const value of [undefined, null, 0, '0', '-1', '1.5', '01', ' 1', '0x01', 'bad', String(2n ** 256n)]) {
    assert.equal(formatPoolSpotPrice(value, '1000000000000000000'), null);
    assert.equal(formatPoolSpotPrice('500000', value), null);
  }
});
