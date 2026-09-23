import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asAddress } from '../packages/chain-adapter/src/types.ts';
import * as productRuntime from '../apps/web/src/m3-product-runtime.ts';
import {
  depositAllowanceCheck,
  parseM3RescueAction,
  parseM3ProductAction,
  requiredDepositAllowances,
  sameM3ProductAction,
} from '../apps/web/src/m3-product-runtime.ts';

test('Pass transfer input preserves the full eighteen-decimal amount and fixed recipient', () => {
  const parseM3PassTransfer = (
    productRuntime as typeof productRuntime & {
      readonly parseM3PassTransfer?: (recipient: string, amount: string) => unknown;
    }
  ).parseM3PassTransfer;
  assert.equal(typeof parseM3PassTransfer, 'function');
  if (!parseM3PassTransfer) return;
  assert.deepEqual(
    parseM3PassTransfer('0x5555555555555555555555555555555555555555', '0.000000000000000001'),
    {
      recipient: '0x5555555555555555555555555555555555555555',
      passBaseUnits: '1',
    },
  );
  for (const amount of ['0', '0.0000000000000000001', '01', '1e18', '-1'])
    assert.throws(() => parseM3PassTransfer('0x5555555555555555555555555555555555555555', amount));
  assert.throws(() => parseM3PassTransfer('0x0000000000000000000000000000000000000000', '1'));
});

test('deposit and withdraw requests preserve exact AF-USDC six-decimal base units', () => {
  assert.deepEqual(parseM3ProductAction('deposit', '1.000001'), {
    kind: 'deposit',
    usdcBaseUnits: '1000001',
  });
  assert.deepEqual(parseM3ProductAction('withdraw', '0.000001'), {
    kind: 'withdraw',
    usdcBaseUnits: '1',
  });
});

test('chain action input rejects zero, excess precision and noncanonical decimals', () => {
  for (const amount of ['0', '0.0000001', '01', '1e6', '-1', '1.']) {
    assert.throws(() => parseM3ProductAction('deposit', amount));
  }
});

test('close carries no amount or configurable recipient', () => {
  assert.deepEqual(parseM3ProductAction('close'), { kind: 'close' });
  assert.throws(() => parseM3ProductAction('close', '1'), /CLOSE_AMOUNT_FORBIDDEN/);
});

test('post-close rescue input accepts only an explicit nonzero token for token rescue', () => {
  assert.deepEqual(parseM3RescueAction('rescue-native'), { kind: 'rescue-native' });
  assert.deepEqual(parseM3RescueAction('rescue-token', '0x5555555555555555555555555555555555555555'), {
    kind: 'rescue-token',
    token: '0x5555555555555555555555555555555555555555',
  });
  assert.throws(() => parseM3RescueAction('rescue-native', '0x5555555555555555555555555555555555555555'));
  assert.throws(() => parseM3RescueAction('rescue-token'));
  assert.throws(() => parseM3RescueAction('rescue-token', '0x0000000000000000000000000000000000000000'));
});

test('review binding compares action kind and exact base units', () => {
  assert.equal(
    sameM3ProductAction(
      { kind: 'deposit', usdcBaseUnits: '1000000' },
      { kind: 'deposit', usdcBaseUnits: '1000000' },
    ),
    true,
  );
  assert.equal(
    sameM3ProductAction(
      { kind: 'deposit', usdcBaseUnits: '1000000' },
      { kind: 'withdraw', usdcBaseUnits: '1000000' },
    ),
    false,
  );
  assert.equal(
    sameM3ProductAction({ kind: 'withdraw', usdcBaseUnits: '1' }, { kind: 'withdraw', usdcBaseUnits: '2' }),
    false,
  );
  assert.equal(sameM3ProductAction({ kind: 'close' }, { kind: 'close' }), true);
  assert.equal(sameM3ProductAction({ kind: 'rescue-native' }, { kind: 'rescue-native' }), true);
  assert.equal(
    sameM3ProductAction(
      { kind: 'rescue-token', token: asAddress('0x5555555555555555555555555555555555555555') },
      { kind: 'rescue-token', token: asAddress('0x5555555555555555555555555555555555555555') },
    ),
    true,
  );
});

test('deposit requires exact AF-USDC and Pass allowances using the frozen 1e12 conversion', () => {
  const request = parseM3ProductAction('deposit', '1.000001');
  if (request.kind !== 'deposit') assert.fail('expected deposit request');
  assert.deepEqual(requiredDepositAllowances(request), {
    afUsdcBaseUnits: '1000001',
    passBaseUnits: '1000001000000000000',
  });
  assert.equal(
    depositAllowanceCheck(request, {
      vaultAddress: '0x2222222222222222222222222222222222222222',
      spender: '0x2222222222222222222222222222222222222222',
      afUsdcAllowanceBaseUnits: '1000001',
      passAllowanceBaseUnits: '1000001000000000000',
      approvalCapability: 'UNAVAILABLE',
    }).status,
    'READY',
  );
});

test('deposit allowance checks fail closed on either insufficient token, malformed values or another spender', () => {
  const request = parseM3ProductAction('deposit', '1.000001');
  if (request.kind !== 'deposit') assert.fail('expected deposit request');
  const base = {
    vaultAddress: '0x2222222222222222222222222222222222222222',
    spender: '0x2222222222222222222222222222222222222222',
    afUsdcAllowanceBaseUnits: '1000001',
    passAllowanceBaseUnits: '1000001000000000000',
    approvalCapability: 'UNAVAILABLE' as const,
  };
  for (const authorization of [
    { ...base, afUsdcAllowanceBaseUnits: '1000000' },
    { ...base, passAllowanceBaseUnits: '1000000999999999999' },
    { ...base, afUsdcAllowanceBaseUnits: '01' },
    { ...base, spender: '0x3333333333333333333333333333333333333333' },
  ]) {
    assert.notEqual(depositAllowanceCheck(request, authorization).status, 'READY');
  }
});

test('amount-bearing wallet actions cannot be reviewed with an omitted amount', () => {
  for (const action of ['deposit', 'withdraw'] as const)
    assert.throws(() => parseM3ProductAction(action), /AMOUNT_REQUIRED/);
});
