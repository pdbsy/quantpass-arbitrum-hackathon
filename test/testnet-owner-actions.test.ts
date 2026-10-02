import assert from 'node:assert/strict';
import test from 'node:test';
import { ownerAction } from '../packages/testnet/src/owner-actions.ts';
import { tradingInterface, tokenInterface } from '../packages/testnet/src/trading-abi.ts';
const owner = '0x' + '11'.repeat(20),
  executor = '0x' + '22'.repeat(20),
  vault = '0x' + '33'.repeat(20),
  pass = '0x' + '44'.repeat(20),
  usdc = '0x' + '55'.repeat(20);
const identity = { owner, vault, pass, usdc, blockTimestamp: '1000' };
test('owner intent is exact raw units, constrained to the known contract and separates token approval from deposit', () => {
  const deposit = ownerAction(identity, { kind: 'DEPOSIT', amountUsdc: '1000000' });
  assert.equal(deposit.to, vault);
  assert.equal(deposit.value, '0x0');
  assert.equal(tradingInterface.decodeFunctionData('deposit', deposit.data)[0], 1000000n);
  const approval = ownerAction(identity, { kind: 'APPROVE_PASS', amountUsdc: '1000000' });
  assert.equal(approval.to, pass);
  assert.equal(tokenInterface.decodeFunctionData('approve', approval.data)[1], 10n ** 18n);
  for (const bad of [
    { kind: 'TRANSFER', to: executor },
    { kind: 'DEPOSIT', amountUsdc: '1.2' },
    { kind: 'DEPOSIT', amountUsdc: '1', to: executor },
    { kind: 'APPROVE_PASS', amountUsdc: String(2n ** 256n / 10n ** 12n + 1n) },
  ])
    assert.throws(() => ownerAction(identity, bad), /OWNER_ACTION/);
});
test('grant and bounds require all explicit values; no paper settings become trading authority', () => {
  const grant = {
    kind: 'AUTHORIZE',
    executor,
    expiresAt: '1100',
    liquidationWindow: '60',
    maxOrderUsdc: '300000000',
    maxTotalBuyUsdc: '900000000',
    maxSlippageBps: '40',
  };
  const action = ownerAction(identity, grant),
    decoded = tradingInterface.decodeFunctionData('authorizeExecutor', action.data)[0];
  assert.equal(decoded.executor.toLowerCase(), executor);
  assert.equal(decoded.maxSlippageBps, 40n);
  for (const bad of [
    { ...grant, executor: owner },
    { ...grant, expiresAt: '1000' },
    { ...grant, maxSlippageBps: '10000' },
    { ...grant, liquidationWindow: '0' },
    { kind: 'AUTHORIZE', executor },
  ])
    assert.throws(() => ownerAction(identity, bad), /OWNER_ACTION/);
  const bounds = ownerAction(identity, {
    kind: 'BOUNDS',
    lowerUnitNav: '900000',
    upperUnitNav: '1200000',
    lowerPrices: ['0', '0', '0'],
    upperPrices: ['0', '0', '0'],
  });
  assert.equal(tradingInterface.decodeFunctionData('setBounds', bounds.data)[0], 900000n);
  assert.throws(
    () =>
      ownerAction(identity, {
        kind: 'BOUNDS',
        lowerUnitNav: '1200000',
        upperUnitNav: '900000',
        lowerPrices: ['0', '0', '0'],
        upperPrices: ['0', '0', '0'],
      }),
    /OWNER_ACTION/,
  );
});
