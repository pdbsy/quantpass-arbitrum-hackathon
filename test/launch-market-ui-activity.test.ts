import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MarketActivityClient,
  renderActivity,
  type MarketEvent,
  type MarketCandle,
} from '../apps/web/src/launch-market/activity.ts';
import type { LaunchApi } from '../apps/web/src/launch-market/client.ts';
import { config, location, OWNER, HASH, NOW } from './helpers/launch-market-ui-fixture.ts';

function activityFixture() {
  const requests: string[] = [];
  const pass = config().manifest!.strategies.AMZN.pass;
  const event: MarketEvent = {
    name: 'Swap',
    emitter: config().manifest!.strategies.AMZN.pool!,
    strategyId: 'AMZN',
    timestamp: NOW,
    fields: { buy: true, amountIn: '10000000', amountOut: '20000000000000000000', fee: '30000' },
    location: { ...location(), transactionHash: HASH, logIndex: 2, confirmations: 1 },
  };
  const candle: MarketCandle = {
    timestamp: NOW,
    openRaw: '500000',
    highRaw: '600000',
    lowRaw: '400000',
    closeRaw: '550000',
    volumeUsdcRaw: '10000000',
  };
  const values = {
    history: [event],
    candles: [candle],
    holders: [{ owner: OWNER, balanceRaw: '20000000000000000000' }],
  };
  const fail = new Set<string>();
  const head = { location: location() };
  const api: LaunchApi = async <T>(path: string): Promise<T> => {
    requests.push(path);
    const name = path.split('?')[0]!.split('/').at(-1)! as keyof typeof values;
    if (fail.has(name)) throw new Error('MARKET_HISTORY_SYNCING');
    const strategy = new URL(path, 'https://example.test').searchParams.get('strategyId');
    return structuredClone({
      [name]:
        name === 'history'
          ? values.history.map((event) => ({ ...event, strategyId: strategy }))
          : values[name],
      location: head.location,
      indexer: { state: 'HEALTHY' },
    }) as T;
  };
  return { requests, api, values, fail, pass, head };
}

test('activity reads only an active trade route and reuses projections across renders for five seconds', async () => {
  const f = activityFixture();
  let now = 100000;
  const activity = new MarketActivityClient({ api: f.api, now: () => now });
  await activity.refresh();
  assert.equal(f.requests.length, 0);
  await activity.setActive('AMZN');
  assert.equal(f.requests.length, 3);
  for (let n = 0; n < 100; ++n) renderActivity(activity.state.AMZN);
  assert.equal(f.requests.length, 3);
  now += 4999;
  await activity.refresh();
  assert.equal(f.requests.length, 3);
  now += 1;
  await activity.refresh();
  assert.equal(f.requests.length, 6);
  assert.match(
    f.requests.find((path) => path.includes('candles'))!,
    /bucketSeconds=300/,
  );
  await activity.setActive(null);
  now += 5000;
  await activity.refresh();
  assert.equal(f.requests.length, 6);
  activity.dispose();
});

test('a hundred SSE notifications coalesce into one bounded refresh', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = activityFixture();
  let now = 100000;
  const activity = new MarketActivityClient({ api: f.api, now: () => now });
  await activity.setActive('AMZN');
  for (let n = 0; n < 100; ++n) activity.requestRefresh();
  context.mock.timers.tick(4999);
  assert.equal(f.requests.length, 3);
  now += 5000;
  context.mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.requests.length, 6);
  activity.dispose();
});

test('actual indexed OHLCV, holder quantities and event evidence render without fabricated candles', async () => {
  const f = activityFixture();
  const activity = new MarketActivityClient({ api: f.api });
  await activity.setActive('AMZN');
  const html = renderActivity(activity.state.AMZN, true, f.pass);
  assert.match(html, /actual five-minute PASS AMM OHLCV candles/);
  assert.match(html, /O 0.5 · H 0.6 · L 0.4 · C 0.55/);
  assert.match(html, /Volume 10 AF-USDC/);
  assert.match(html, /Buy · 20 PASS · 10 AF-USDC/);
  assert.match(html, /Included · 1 blocks/);
  assert.match(html, /20 PASS/);
  assert.match(html, /Includes contract custody and pool reserves/);
  assert.doesNotMatch(html, /localStorage|AF\.exchange|Math\.random|tradingview/i);
  activity.dispose();
  const empty = activityFixture();
  empty.values.history = [];
  empty.values.candles = [];
  empty.values.holders = [];
  const emptyActivity = new MarketActivityClient({ api: empty.api });
  await emptyActivity.setActive('AMZN');
  const emptyHtml = renderActivity(emptyActivity.state.AMZN);
  assert.match(emptyHtml, /No indexed AMM swaps yet/);
  assert.match(emptyHtml, /No indexed holder balances yet/);
  assert.doesNotMatch(emptyHtml, /<svg/);
  emptyActivity.dispose();
});

test('indexer failures and invalid candle ranges show unavailable data while independent sections remain readable', async () => {
  const f = activityFixture();
  f.values.candles[0] = { ...f.values.candles[0]!, lowRaw: '999999' };
  const activity = new MarketActivityClient({ api: f.api });
  await activity.setActive('AMZN');
  assert.deepEqual(activity.state.AMZN.unavailable, ['candles']);
  assert.match(renderActivity(activity.state.AMZN), /indexer is syncing or unavailable/);
  assert.match(renderActivity(activity.state.AMZN), /Buy · 20 PASS/);
  assert.doesNotMatch(renderActivity(activity.state.AMZN), /<svg/);
  activity.dispose();
});

test('a reorg clears cached candles and holders even while off the trade page', async () => {
  const f = activityFixture();
  const activity = new MarketActivityClient({ api: f.api });
  await activity.setActive('AMZN');
  await activity.setActive(null);
  activity.requestRefresh(true);
  assert.equal(activity.state.AMZN.candles.length, 0);
  assert.equal(activity.state.AMZN.holders.length, 0);
  assert.equal(activity.state.AMZN.phase, 'LOADING');
  assert.equal(f.requests.length, 3);
  activity.dispose();
});

test('LP-token transfer logs are never described as PASS ownership transfers', async () => {
  const f = activityFixture();
  f.values.history = [
    { ...f.values.history[0]!, name: 'Transfer', fields: { value: '1000000000000000000' } },
  ];
  const activity = new MarketActivityClient({ api: f.api });
  await activity.setActive('AMZN');
  assert.match(
    renderActivity(activity.state.AMZN, true, f.pass),
    /ERC-20 transfer · 1000000000000000000 raw units/,
  );
  activity.dispose();
});

test('an older API projection cannot replace the accepted market history without reorg recovery', async () => {
  const f = activityFixture();
  let now = 100000;
  const activity = new MarketActivityClient({ api: f.api, now: () => now });
  await activity.setActive('AMZN');
  f.head.location = location(99, 99);
  now += 5000;
  await activity.refresh();
  assert.equal(activity.state.AMZN.location!.blockNumber, '100');
  assert.equal(activity.state.AMZN.phase, 'UNAVAILABLE');
  assert.doesNotMatch(renderActivity(activity.state.AMZN), /<svg/);
  activity.requestRefresh(true);
  now += 5000;
  await activity.refresh();
  assert.equal(activity.state.AMZN.location!.blockNumber, '99');
  assert.equal(activity.state.AMZN.phase, 'READY');
  activity.dispose();
});
