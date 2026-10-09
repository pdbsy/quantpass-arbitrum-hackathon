import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildLaunchMarketServer } from '../apps/server/src/launch-market/server.ts';
import { StockReferenceHistory } from '../apps/server/src/stock-reference/history.ts';
import { StockReferenceQuotes } from '../apps/server/src/stock-reference/quotes.ts';
import { LaunchMarketService } from '../packages/launch-market/src/service.ts';
import { LaunchMarketStore } from '../packages/launch-market/src/store.ts';

test('stock UI references are read-only, fixed-symbol, host-checked and independent of asset deployment', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'af-stock-api-'));
  const store = new LaunchMarketStore(join(folder, 'market.sqlite'), 'https://www.ikol.top');
  const service = new LaunchMarketService({
    manifest: null,
    store,
    chain: null,
    ethReference: null,
    quoteSigner: null,
    claimSigner: null,
  });
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    requests.push(String(input));
    throw new Error('isolated provider outage');
  };
  const server = await buildLaunchMarketServer({
    service,
    origin: 'https://www.ikol.top',
    trustedIdentity: () => null,
    stockHistory: new StockReferenceHistory({ fetcher }),
    stockQuotes: new StockReferenceQuotes({ fetcher }),
  });
  const headers = { host: 'www.ikol.top' };
  try {
    const config = await server.app.inject({ url: '/api/launch-market/config', headers });
    assert.equal(config.json().deployment, 'NOT_DEPLOYED');
    for (const route of ['quote', 'candles']) {
      const response = await server.app.inject({ url: `/api/stock-reference/${route}?symbol=AMZN`, headers });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().status, 'UNAVAILABLE');
      assert.equal(response.json().referenceOnly, true);
      assert.equal(response.json().lastDataAt, null);
      for (const suffix of [
        'symbol=NVDA',
        'symbol=TSLA&url=https://attacker.example',
        'symbol=TSLA&symbol=AMZN',
        '',
      ]) {
        const invalid = await server.app.inject({ url: `/api/stock-reference/${route}?${suffix}`, headers });
        assert.equal(invalid.statusCode, 400);
      }
      const wrongHost = await server.app.inject({
        url: `/api/stock-reference/${route}?symbol=TSLA`,
        headers: { host: 'attacker.example' },
      });
      assert.equal(wrongHost.statusCode, 403);
      const mutation = await server.app.inject({
        method: 'POST',
        url: `/api/stock-reference/${route}?symbol=TSLA`,
        headers: { ...headers, origin: 'https://attacker.example' },
      });
      assert.equal(mutation.statusCode, 403);
    }
    assert.equal(requests.length, 2);
    assert.ok(requests.every((url) => url.startsWith('https://api.nasdaq.com/api/quote/AMZN/')));
    const quote = await server.app.inject({
      method: 'POST',
      url: '/api/launch-market/quote',
      headers: { ...headers, origin: 'https://www.ikol.top' },
      payload: {
        strategyId: 'AMZN',
        operation: 'BUY',
        asset: 'ETH',
        amountRaw: '10000000000000000',
        slippageBps: 100,
        owner: '0x86767116cd40bf6b4f8cf88e08d11e38b04364cf',
      },
    });
    assert.equal(quote.statusCode, 401);
    assert.equal(quote.json().error.code, 'VERIFIED_EMAIL_REQUIRED');
    const snapshot = await server.app.inject({ url: '/api/launch-market/snapshot', headers });
    assert.equal(snapshot.statusCode, 503);
    assert.equal(snapshot.json().error.code, 'NOT_DEPLOYED');
  } finally {
    await server.stop();
    rmSync(folder, { recursive: true, force: true });
  }
});
