import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buyPayment,
  estimatePassPayment,
  validPaymentReference,
} from '../apps/web/src/launch-market/payment-estimate.ts';
import { ammQuote, usdcForEth } from '../packages/launch-market/src/math.ts';
import type { LaunchClientState } from '../apps/web/src/launch-market/model.ts';
import type { OrderForm } from '../apps/web/src/launch-market/shell.ts';
import { config, snapshot, NOW } from './helpers/launch-market-ui-fixture.ts';

const P = 10n ** 18n;
const reference = { ethUsdPriceRaw: '2000000000', observedAt: NOW, validUntil: NOW + 30 };
const state = (): LaunchClientState => {
  const current = snapshot();
  return {
    enabled: true,
    config: config(),
    snapshot: {
      ...current,
      markets: { ...current.markets, TSLA: { ...current.markets.TSLA, remainingRaw: String(500000n * P) } },
    },
    owner: null,
    wallet: null,
    account: null,
    busy: false,
    connecting: false,
    quote: null,
    quoteRequest: null,
    error: null,
    notice: null,
    transaction: { state: 'IDLE', hash: null, id: null, confirmations: 0, approval: false, owner: null },
  };
};
const form = (operation: OrderForm['operation'], asset: OrderForm['asset'], amount: string): OrderForm => ({
  operation,
  asset,
  amount,
  slippageBps: 100,
});

test('anonymous Mint estimates fixed AF-USDC payment immediately and native ETH separately', () => {
  assert.deepEqual(estimatePassPayment(state(), 'TSLA', form('MINT', 'ETH', '50'), reference, NOW), {
    passRaw: String(50n * P),
    usdcRaw: '25000000',
    ethRaw: '12500000000000000',
    assetInputRaw: String(50n * P),
  });
  assert.equal(
    estimatePassPayment(state(), 'TSLA', form('MINT', 'ETH', '50'), undefined, NOW).usdcRaw,
    '25000000',
  );
  assert.equal(estimatePassPayment(state(), 'TSLA', form('MINT', 'AF_USDC', '0.000002')).usdcRaw, '1');
  assert.throws(() => estimatePassPayment(state(), 'TSLA', form('MINT', 'AF_USDC', '0.000001')), /precision/);
  assert.throws(() => estimatePassPayment(state(), 'TSLA', form('MINT', 'AF_USDC', '500001')), /inventory/);
});

test('requested PASS uses minimal rounded AMM input including fees and price impact', () => {
  const passReserve = 500000n * P,
    usdcReserve = 250000000000n;
  assert.equal(buyPayment(50n * P, passReserve, usdcReserve, 30), 25077735n);
  for (const fee of [0, 30, 1000]) {
    for (const pass of [1n, 50n * P, 499999n * P]) {
      const input = buyPayment(pass, passReserve, usdcReserve, fee);
      assert.ok(ammQuote(input, usdcReserve, passReserve, fee).output >= pass);
      if (input > 1n) {
        let previous = 0n;
        try {
          previous = ammQuote(input - 1n, usdcReserve, passReserve, fee).output;
        } catch {
          /* Rounded zero is below any positive target. */
        }
        assert.ok(previous < pass);
      }
    }
  }
  assert.equal(estimatePassPayment(state(), 'AMZN', form('BUY', 'AF_USDC', '50')).assetInputRaw, '25077735');
  assert.throws(() => buyPayment(passReserve, passReserve, usdcReserve, 30), /liquidity/);
});

test('ETH Buy input reaches requested PASS after both conversion and AMM fee rounding', () => {
  const current = state();
  const estimate = estimatePassPayment(current, 'AMZN', form('BUY', 'ETH', '50'), reference, NOW);
  const eth = BigInt(estimate.assetInputRaw);
  const usdc = usdcForEth(eth, BigInt(reference.ethUsdPriceRaw), current.snapshot!.conversion.feeBps);
  assert.ok(ammQuote(usdc, 250000000000n, 500000n * P, 30).output >= 50n * P);
  assert.equal(estimate.ethRaw, String(eth));
  assert.equal(estimate.usdcRaw, String((eth * BigInt(reference.ethUsdPriceRaw)) / P));
  assert.equal(
    estimatePassPayment(current, 'AMZN', form('BUY', 'ETH', '50'), undefined, NOW).usdcRaw,
    estimate.usdcRaw,
  );
});

test('Sell estimates actual net AF-USDC proceeds, never initial spot times quantity', () => {
  const usdc = estimatePassPayment(state(), 'AMZN', form('SELL', 'AF_USDC', '50'));
  assert.equal(usdc.usdcRaw, String(ammQuote(50n * P, 500000n * P, 250000000000n, 30).output));
  assert.ok(BigInt(usdc.usdcRaw) < 25000000n);
  const eth = estimatePassPayment(state(), 'AMZN', form('SELL', 'ETH', '50'), reference, NOW);
  assert.ok(BigInt(eth.usdcRaw) < BigInt(usdc.usdcRaw));
  assert.equal(eth.assetInputRaw, String(50n * P));
});

test('display ETH reference rejects future, expired, malformed or widened validity', () => {
  assert.equal(validPaymentReference(reference, NOW), reference);
  for (const value of [
    { ...reference, observedAt: NOW + 1 },
    { ...reference, observedAt: -1 },
    { ...reference, validUntil: NOW + 60 },
    { ...reference, ethUsdPriceRaw: '0' },
    { ...reference, ethUsdPriceRaw: '1.5' },
  ])
    assert.throws(() => validPaymentReference(value, NOW));
  assert.throws(() => estimatePassPayment(state(), 'AMZN', form('BUY', 'ETH', '50'), reference, NOW + 30));
});

test('non-live, zero, negative and excessive precision drafts do not fabricate estimates', () => {
  for (const amount of ['0', '-1', '1.0000000000000000001'])
    assert.throws(() => estimatePassPayment(state(), 'AMZN', form('BUY', 'AF_USDC', amount)));
  assert.throws(() => estimatePassPayment(state(), 'TSLA', form('BUY', 'AF_USDC', '1')), /not live/);
});
