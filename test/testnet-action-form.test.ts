import assert from 'node:assert/strict';
import test from 'node:test';
import { decimalRaw, formAction } from '../apps/web/src/testnet-action-form.ts';
test('wallet amounts preserve all six decimals and reject silent truncation, exponents or approximate numbers', () => {
  assert.equal(decimalRaw('12.000001', 6), '12000001');
  assert.equal(decimalRaw('1', 18), '1000000000000000000');
  for (const v of ['1.0000001', '1e6', '-1', 'NaN', '01', ' 1', '']) assert.throws(() => decimalRaw(v, 6));
  assert.deepEqual(formAction({ kind: 'DEPOSIT', amount: '100.5' }, '1000000'), {
    kind: 'DEPOSIT',
    amountUsdc: '100500000',
  });
});
test('percentage bounds use the reviewed current unit NAV while absolute stock prices use six decimals', () => {
  const fields = {
    kind: 'BOUNDS',
    boundMode: 'PERCENT',
    lower: '10',
    upper: '20',
    lowerMSFT: '',
    upperMSFT: '200',
    lowerNVDA: '',
    upperNVDA: '',
    lowerAAPL: '',
    upperAAPL: '',
  };
  assert.deepEqual(formAction(fields, '1200000'), {
    kind: 'BOUNDS',
    lowerUnitNav: '1080000',
    upperUnitNav: '1440000',
    lowerPrices: ['0', '0', '0'],
    upperPrices: ['200000000', '0', '0'],
  });
  assert.throws(() => formAction(fields, null));
  assert.throws(() => formAction({ ...fields, lower: '100' }, '1000000'));
  assert.deepEqual(formAction({ kind: 'BOUNDS', boundMode: 'ABSOLUTE', lower: '0.9', upper: '1.2' }, null), {
    kind: 'BOUNDS',
    lowerUnitNav: '900000',
    upperUnitNav: '1200000',
    lowerPrices: ['0', '0', '0'],
    upperPrices: ['0', '0', '0'],
  });
});
test('execution grants require explicit values and expose neither trading authority nor operational defaults through login', () => {
  const grant = {
    kind: 'AUTHORIZE',
    executor: '0x' + '22'.repeat(20),
    expiresAt: '1800000000',
    liquidationWindow: '600',
    maxOrder: '100',
    maxTotal: '300',
    maxSlippageBps: '40',
  };
  assert.deepEqual(formAction(grant, null), {
    kind: 'AUTHORIZE',
    executor: grant.executor,
    expiresAt: grant.expiresAt,
    liquidationWindow: '600',
    maxOrderUsdc: '100000000',
    maxTotalBuyUsdc: '300000000',
    maxSlippageBps: '40',
  });
  assert.throws(() => formAction({ ...grant, maxOrder: '' }, null));
  assert.deepEqual(
    formAction(
      {
        kind: 'RECOVERY_SELL',
        stock: '0x' + '33'.repeat(20),
        amount: '1.01',
        minimum: '25.1',
        deadline: '1800000000',
      },
      null,
    ),
    {
      kind: 'RECOVERY_SELL',
      stock: '0x' + '33'.repeat(20),
      amountRaw: '1010000000000000000',
      minAmountOut: '25100000',
      deadline: '1800000000',
    },
  );
});
