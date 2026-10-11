import assert from 'node:assert/strict';
import test from 'node:test';
import {
  maxShortcutAmount,
  shortcutInput,
  shortcutPresets,
} from '../apps/web/src/launch-market/order-shortcuts.ts';
import { inputRaw } from '../apps/web/src/launch-market/presentation.ts';
import { LaunchMarketClient } from '../apps/web/src/launch-market/client.ts';
import type { LaunchClientState } from '../apps/web/src/launch-market/model.ts';
import type { OrderForm } from '../apps/web/src/launch-market/shell.ts';
import { marketInterfaces } from '../packages/launch-market/src/abi.ts';
import {
  fixture,
  account,
  config,
  snapshot,
  wallet,
  NOW,
  OWNER,
  HASH,
  quote,
} from './helpers/launch-market-ui-fixture.ts';

const form = (operation: 'MINT' | 'BUY' | 'SELL', asset: 'ETH' | 'AF_USDC'): OrderForm => ({
  operation,
  asset,
  amount: '',
  slippageBps: 100,
});
const state = (): LaunchClientState => ({
  enabled: true,
  config: config(),
  snapshot: snapshot(),
  wallet: wallet(),
  account: account(),
  owner: OWNER,
  connecting: false,
  busy: false,
  quote: null,
  quoteRequest: null,
  transaction: { state: 'IDLE', hash: null, id: null, confirmations: 0, approval: false, owner: null },
  error: null,
  notice: null,
});

test('presets respect exact order input units and never interpret 10 PASS as 10 ETH', () => {
  assert.deepEqual(
    shortcutPresets(form('MINT', 'ETH')).map((p) => p.label),
    ['10 PASS', '50 PASS', '100 PASS'],
  );
  assert.equal(
    inputRaw('MINT', 'ETH', shortcutPresets(form('MINT', 'ETH'))[0]!.value),
    '10000000000000000000',
  );
  assert.equal(shortcutPresets(form('SELL', 'ETH'))[0]!.label, '10 PASS');
  assert.deepEqual(
    shortcutPresets(form('BUY', 'ETH')).map((p) => p.label),
    ['0.0001 ETH', '0.0005 ETH', '0.001 ETH'],
  );
  assert.equal(inputRaw('BUY', 'ETH', shortcutPresets(form('BUY', 'ETH'))[0]!.value), '100000000000000');
  assert.equal(shortcutPresets(form('BUY', 'AF_USDC'))[0]!.label, '10 AF-USDC');
});

test('Sell Max excludes locked PASS and preserves all 18 fractional digits', () => {
  const current = state();
  const available = '1234567890123456789';
  const updated = {
    ...current,
    wallet: {
      ...current.wallet!,
      passes: {
        ...current.wallet!.passes,
        AMZN: {
          balanceRaw: '10000000000000000000',
          lockedRaw: '8765432109876543211',
          availableRaw: available,
        },
      },
    },
  };
  const amount = maxShortcutAmount(updated, 'AMZN', form('SELL', 'ETH'));
  assert.equal(amount, '1.234567890123456789');
  assert.equal(inputRaw('SELL', 'ETH', amount), available);
  assert.equal(shortcutInput(1n, 18), '0.000000000000000001');
});

test('AF-USDC Max uses balance, Mint inventory and exact micro-USDC quantum', () => {
  const current = state();
  assert.equal(maxShortcutAmount(current, 'AMZN', form('BUY', 'AF_USDC')), '1000');
  assert.equal(maxShortcutAmount(current, 'TSLA', form('MINT', 'AF_USDC')), '1');
  const updated = { ...current, wallet: { ...current.wallet!, usdcBalanceRaw: '1' } };
  assert.equal(maxShortcutAmount(updated, 'TSLA', form('MINT', 'AF_USDC')), '0.000002');
  assert.equal(
    maxShortcutAmount(
      { ...updated, wallet: { ...updated.wallet, usdcBalanceRaw: '0' } },
      'AMZN',
      form('SELL', 'AF_USDC'),
    ),
    '1000',
  );
  assert.throws(
    () =>
      maxShortcutAmount(
        { ...updated, wallet: { ...updated.wallet, usdcBalanceRaw: '0' } },
        'TSLA',
        form('MINT', 'AF_USDC'),
      ),
    /No affordable/,
  );
});

test('ETH Max subtracts gas, uses fresh Mint reference without conversion fee and caps inventory', () => {
  const current = state();
  const native = { gasReserveRaw: '1000000000000000', ethUsdPriceRaw: '2000000000' };
  assert.equal(maxShortcutAmount(current, 'AMZN', form('BUY', 'ETH'), native), '9.999');
  const small = {
    ...current,
    wallet: { ...current.wallet!, ethBalanceRaw: '1000001000000000' },
    snapshot: {
      ...current.snapshot!,
      markets: {
        ...current.snapshot!.markets,
        TSLA: { ...current.snapshot!.markets.TSLA, remainingRaw: '1000000000000000000000' },
      },
    },
  };
  assert.equal(maxShortcutAmount(small, 'TSLA', form('MINT', 'ETH'), native), '0.000004');
  assert.throws(
    () =>
      maxShortcutAmount(
        { ...small, wallet: { ...small.wallet, ethBalanceRaw: native.gasReserveRaw } },
        'TSLA',
        form('MINT', 'ETH'),
        native,
      ),
    /gas buffer/,
  );
  assert.throws(
    () => maxShortcutAmount(current, 'TSLA', form('MINT', 'ETH'), { gasReserveRaw: native.gasReserveRaw }),
    /fresh ETH/,
  );
});

async function clientFixture(gas = '0x3b9aca00', now = () => NOW) {
  const f = fixture();
  const original = f.provider.request.bind(f.provider);
  f.provider.request = async (input) => {
    if (input.method === 'eth_gasPrice') {
      f.provider.calls.push(input);
      return gas;
    }
    return original(input);
  };
  const client = new LaunchMarketClient({ provider: f.provider, api: f.api, now });
  await client.initialize();
  await client.connect();
  return { ...f, client };
}

test('native Buy Max reads gas only and never signs, broadcasts or exposes a probe order', async () => {
  const f = await clientFixture();
  const result = await f.client.previewNativeMax('AMZN', 'BUY', 100);
  assert.equal(result.gasReserveRaw, '2000000000000000');
  assert.equal(f.client.state.quote, null);
  assert.equal(f.state.requests.filter((r) => r.path.endsWith('/quote')).length, 0);
  assert.equal(f.provider.calls.filter((r) => /sign|sendTransaction/i.test(r.method)).length, 0);
  assert.equal(f.client.state.busy, false);
});

test('native Mint Max validates fresh quote but cannot confirm its probe', async () => {
  let currentTime = NOW;
  const f = await clientFixture('0x3b9aca00', () => currentTime);
  const amount = '2000000000000',
    eth = '500000000';
  const request = {
    owner: OWNER,
    strategyId: 'TSLA' as const,
    operation: 'MINT' as const,
    asset: 'ETH' as const,
    amountRaw: amount,
    slippageBps: 100,
  };
  const launch = f.state.config.manifest!.strategies.TSLA.launch!;
  const native = {
    router: launch,
    payer: OWNER,
    accountId: HASH,
    operation: 0,
    pass: f.state.config.manifest!.strategies.TSLA.pass,
    amountIn: eth,
    usdcAmount: '1',
    minOut: amount,
    ethAmount: eth,
    ethUsdPrice: '2000000000',
    nonce: 1,
    issuedAt: NOW,
    deadline: NOW + 60,
    epoch: 1,
  };
  f.state.quote = {
    ...quote(request),
    amountInRaw: amount,
    estimatedOutRaw: amount,
    minOutRaw: amount,
    feeUsdcRaw: '0',
    conversionFeeUsdcRaw: '0',
    transaction: {
      to: launch,
      value: eth,
      data: marketInterfaces.launch.encodeFunctionData('subscribeEth', [amount, native, '0x']),
    },
  };
  const preview = await f.client.previewNativeMax('TSLA', 'MINT', 100);
  assert.equal(preview.ethUsdPriceRaw, '2000000000');
  assert.equal(preview.gasReserveRaw, '6000000000000000');
  assert.equal(f.client.state.quote, null);
  assert.equal(f.client.state.quoteRequest, null);
  await assert.rejects(f.client.confirm(), /QUOTE_REVIEW_REQUIRED/);
  f.state.quote = { ...f.state.quote, reference: { ethUsdPriceRaw: '2000000000', observedAt: NOW - 31 } };
  await assert.rejects(f.client.previewNativeMax('TSLA', 'MINT', 100), /fresh ETH/);
  assert.equal(f.client.state.quote, null);
  // A wallet read can stall after quote generation. Check validity at return time.
  f.state.quote = { ...f.state.quote, reference: { ethUsdPriceRaw: '2000000000', observedAt: NOW } };
  const before = f.state.requests.filter((r) => r.path.endsWith('/quote')).length;
  const original = f.provider.request.bind(f.provider);
  f.provider.request = async (input) => {
    if (
      input.method === 'eth_accounts' &&
      f.state.requests.filter((r) => r.path.endsWith('/quote')).length > before
    )
      currentTime = NOW + 61;
    return original(input);
  };
  await assert.rejects(f.client.previewNativeMax('TSLA', 'MINT', 100), /QUOTE_REQUEST_MISMATCH/);
  assert.equal(f.client.state.quote, null);
  assert.equal(f.client.state.busy, false);
  assert.equal(f.provider.calls.filter((r) => /sign|sendTransaction/i.test(r.method)).length, 0);
});

test('gas read failure leaves no confirmable quote and releases only its preview busy state', async () => {
  const f = await clientFixture('0x0');
  await assert.rejects(f.client.previewNativeMax('AMZN', 'BUY', 100), /Gas price is unavailable/);
  assert.equal(f.client.state.busy, false);
  assert.equal(f.client.state.quote, null);
  assert.equal(f.provider.calls.filter((r) => /sign|sendTransaction/i.test(r.method)).length, 0);
});

test('wallet invalidation retains the Max lock until its read settles', async () => {
  const f = await clientFixture();
  let finish!: (gas: string) => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gas = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const original = f.provider.request.bind(f.provider);
  f.provider.request = async (input) => {
    if (input.method === 'eth_gasPrice') {
      started();
      return gas;
    }
    return original(input);
  };
  const preview = f.client.previewNativeMax('AMZN', 'BUY', 100);
  const rejected = assert.rejects(preview, /WALLET_IDENTITY_CHANGED/);
  await waiting;
  f.client.invalidateWallet();
  assert.equal(f.client.state.busy, true);
  await assert.rejects(f.client.connect(), /TRANSACTION_ALREADY_PENDING/);
  finish('0x3b9aca00');
  await rejected;
  assert.equal(f.client.state.busy, false);
  assert.equal(f.client.state.quote, null);
  assert.equal(f.provider.calls.filter((r) => /sign|sendTransaction/i.test(r.method)).length, 0);
});
