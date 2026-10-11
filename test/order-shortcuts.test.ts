import assert from 'node:assert/strict';
import test from 'node:test';
import {
  maxShortcutAmount,
  shortcutInput,
  shortcutPresets,
} from '../apps/web/src/launch-market/order-shortcuts.ts';
import { inputRaw } from '../apps/web/src/launch-market/presentation.ts';
import { LaunchMarketClient, type LaunchApi } from '../apps/web/src/launch-market/client.ts';
import { estimatePassPayment } from '../apps/web/src/launch-market/payment-estimate.ts';
import type { LaunchClientState } from '../apps/web/src/launch-market/model.ts';
import type { OrderForm } from '../apps/web/src/launch-market/shell.ts';
import {
  fixture,
  account,
  config,
  snapshot,
  wallet,
  NOW,
  OWNER,
  OTHER,
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

test('native presets fill PASS quantities for either payment asset', () => {
  for (const operation of ['MINT', 'BUY', 'SELL'] as const)
    for (const asset of ['ETH', 'AF_USDC'] as const) {
      const presets = shortcutPresets(form(operation, asset), true);
      assert.deepEqual(
        presets.map((p) => p.label),
        ['10 PASS', '50 PASS', '100 PASS'],
      );
      assert.equal(inputRaw('SELL', 'ETH', presets[0]!.value), '10000000000000000000');
    }
  // The separate legacy payment-input shell keeps its own payment units.
  assert.equal(shortcutPresets(form('BUY', 'ETH'))[0]!.label, '0.0001 ETH');
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
  const buyMax = maxShortcutAmount(current, 'AMZN', form('BUY', 'AF_USDC'), undefined, true);
  assert.equal(buyMax, '1986.079514894600333868');
  const payment = estimatePassPayment(current, 'AMZN', { ...form('BUY', 'AF_USDC'), amount: buyMax });
  assert.ok(BigInt(payment.usdcRaw) <= BigInt(current.wallet!.usdcBalanceRaw));
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

test('native ETH Max fills affordable PASS after gas and fees and caps conversion liquidity', () => {
  const current = state();
  const native = { gasReserveRaw: '1000000000000000', ethUsdPriceRaw: '2000000000' };
  assert.equal(maxShortcutAmount(current, 'AMZN', form('BUY', 'ETH'), native), '9.999');
  const buyMax = maxShortcutAmount(current, 'AMZN', form('BUY', 'ETH'), native, true);
  assert.equal(buyMax, '36828.081283658908842496');
  const payment = estimatePassPayment(
    current,
    'AMZN',
    { ...form('BUY', 'ETH'), amount: buyMax },
    { ethUsdPriceRaw: native.ethUsdPriceRaw, observedAt: NOW, validUntil: NOW + 30 },
    NOW,
  );
  assert.ok(BigInt(payment.ethRaw!) <= BigInt(current.wallet!.ethBalanceRaw) - BigInt(native.gasReserveRaw));
  const limited = {
    ...current,
    snapshot: {
      ...current.snapshot!,
      conversion: { ...current.snapshot!.conversion, usdcReserveRaw: '10000000' },
    },
  };
  assert.equal(maxShortcutAmount(limited, 'AMZN', form('BUY', 'ETH'), native, true), '19.939204824511598477');
  assert.throws(
    () =>
      maxShortcutAmount(
        { ...current, wallet: { ...current.wallet!, owner: OTHER } },
        'AMZN',
        form('BUY', 'ETH'),
        native,
        true,
      ),
    /Connect your wallet/,
  );
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
  const reference = {
    value: { ethUsdPriceRaw: '2000000000', observedAt: NOW, validUntil: NOW + 30 } as unknown,
    read: null as (() => Promise<unknown>) | null,
  };
  const api: LaunchApi = async <T>(path: string, body?: unknown): Promise<T> => {
    if (path.endsWith('/eth-reference')) {
      assert.equal(body, undefined, 'Public reference is a GET without an order body');
      f.state.requests.push({ path });
      return structuredClone(reference.read ? await reference.read() : reference.value) as T;
    }
    return f.api<T>(path, body);
  };
  const original = f.provider.request.bind(f.provider);
  f.provider.request = async (input) => {
    if (input.method === 'eth_gasPrice') {
      f.provider.calls.push(input);
      return gas;
    }
    return original(input);
  };
  const client = new LaunchMarketClient({ provider: f.provider, api, now });
  await client.initialize();
  await client.connect();
  return { ...f, client, reference };
}

test('native Buy Max reads gas and a public reference without signed quotes or broadcasts', async () => {
  const f = await clientFixture();
  const result = await f.client.previewNativeMax('AMZN', 'BUY', 100);
  assert.equal(result.gasReserveRaw, '2000000000000000');
  assert.equal(result.ethUsdPriceRaw, '2000000000');
  assert.equal(f.client.state.quote, null);
  assert.equal(f.state.requests.filter((r) => r.path.endsWith('/quote')).length, 0);
  assert.equal(f.state.requests.filter((r) => r.path.endsWith('/eth-reference')).length, 1);
  assert.equal(f.provider.calls.filter((r) => /sign|sendTransaction/i.test(r.method)).length, 0);
  assert.equal(f.client.state.busy, false);
});

test('native Mint Max validates the public reference again after the final wallet read', async () => {
  let currentTime = NOW;
  const f = await clientFixture('0x3b9aca00', () => currentTime);
  const preview = await f.client.previewNativeMax('TSLA', 'MINT', 100);
  assert.equal(preview.ethUsdPriceRaw, '2000000000');
  assert.equal(preview.gasReserveRaw, '6000000000000000');
  assert.equal(f.client.state.quote, null);
  assert.equal(f.client.state.quoteRequest, null);
  await assert.rejects(f.client.confirm(), /QUOTE_REVIEW_REQUIRED/);
  for (const value of [
    { ethUsdPriceRaw: '2000000000', observedAt: NOW - 31, validUntil: NOW - 1 },
    { ethUsdPriceRaw: '2000000000', observedAt: NOW + 1, validUntil: NOW + 31 },
    { ethUsdPriceRaw: '2000000000', observedAt: NOW, validUntil: NOW + 60 },
    { ethUsdPriceRaw: '0', observedAt: NOW, validUntil: NOW + 30 },
  ]) {
    f.reference.value = value;
    await assert.rejects(f.client.previewNativeMax('TSLA', 'MINT', 100), /fresh ETH/i);
    assert.equal(f.client.state.quote, null);
    assert.equal(f.client.state.busy, false);
  }
  // A wallet read can stall after the public reference is fetched. Check validity at return time.
  f.reference.value = { ethUsdPriceRaw: '2000000000', observedAt: NOW, validUntil: NOW + 30 };
  const before = f.state.requests.filter((r) => r.path.endsWith('/eth-reference')).length;
  const original = f.provider.request.bind(f.provider);
  f.provider.request = async (input) => {
    if (
      input.method === 'eth_accounts' &&
      f.state.requests.filter((r) => r.path.endsWith('/eth-reference')).length > before
    )
      currentTime = NOW + 31;
    return original(input);
  };
  await assert.rejects(f.client.previewNativeMax('TSLA', 'MINT', 100), /fresh ETH/i);
  assert.equal(f.client.state.quote, null);
  assert.equal(f.client.state.busy, false);
  assert.equal(f.state.requests.filter((r) => r.path.endsWith('/quote')).length, 0);
  assert.equal(f.provider.calls.filter((r) => /sign|sendTransaction/i.test(r.method)).length, 0);
});

test('public ETH reference does not require a wallet or account', async () => {
  const f = await clientFixture();
  f.client.invalidateWallet();
  assert.deepEqual(await f.client.readEthReference(), {
    ethUsdPriceRaw: '2000000000',
    observedAt: NOW,
    validUntil: NOW + 30,
  });
  assert.equal(f.client.state.owner, null);
  assert.equal(f.client.state.account, null);
  assert.equal(f.state.requests.filter((r) => r.path.endsWith('/quote')).length, 0);
  assert.equal(f.provider.calls.filter((r) => /sign|sendTransaction/i.test(r.method)).length, 0);
});

test('native Max discards a public reference if its wallet owner or account linkage changes', async () => {
  const owner = await clientFixture();
  owner.reference.read = async () => {
    owner.provider.owner = OTHER;
    return owner.reference.value;
  };
  await assert.rejects(owner.client.previewNativeMax('AMZN', 'BUY', 100), /WALLET_IDENTITY_CHANGED/);
  assert.equal(owner.client.state.busy, false);
  const linked = await clientFixture();
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  linked.reference.read = () => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const preview = linked.client.previewNativeMax('TSLA', 'MINT', 100);
  const rejected = assert.rejects(preview, /ACCOUNT_LINKAGE_CHANGED/);
  await waiting;
  linked.state.account = { ...account(), id: 'new-account' };
  linked.state.wallet = { ...linked.state.wallet, accountId: 'new-account' };
  await linked.client.refresh();
  finish(linked.reference.value);
  await rejected;
  assert.equal(linked.client.state.busy, false);
  for (const f of [owner, linked]) {
    assert.equal(f.client.state.quote, null);
    assert.equal(f.state.requests.filter((r) => r.path.endsWith('/quote')).length, 0);
    assert.equal(f.provider.calls.filter((r) => /sign|sendTransaction/i.test(r.method)).length, 0);
  }
});

test('gas read failure leaves no confirmable quote and releases only its preview busy state', async () => {
  const f = await clientFixture('0x0');
  await f.client.review({
    strategyId: 'AMZN',
    operation: 'BUY',
    asset: 'AF_USDC',
    amountRaw: '10000000',
    slippageBps: 100,
  });
  assert.ok(f.client.state.quote);
  await assert.rejects(f.client.previewNativeMax('AMZN', 'BUY', 100), /Gas price is unavailable/);
  assert.equal(f.client.state.busy, false);
  assert.equal(f.client.state.quote, null);
  assert.equal(f.state.requests.filter((r) => r.path.endsWith('/eth-reference')).length, 0);
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
