import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productHarness } from './helpers/product-api.ts';
import { StrategyClient } from '../tools/automata/strategy-client.mjs';
import { emaTargets } from '../packages/automata/src/ema-strategy.ts';
import { provisionEma, advanceEma } from '../tools/automata/ema-demo-runtime.mjs';
async function setup(t) {
  const h = await productHarness();
  t.after(() => h.app.close());
  const fetcher = async (url, o) => {
    const r = await h.app.inject({
      method: o.method,
      url: new URL(url).pathname,
      headers: { ...o.headers, host: '127.0.0.1:4180' },
      ...(o.body ? { payload: o.body } : {}),
    });
    return new Response(r.body, { status: r.statusCode, headers: r.headers });
  };
  const client = new StrategyClient({
    owner: 'alice',
    runId: 'qinfra-ema-demo',
    targets: {},
    selectTargets: emaTargets,
    fetcher,
  });
  await client.connect();
  return { h, client, fetcher };
}
test('one-command EMA provisioning is idempotent and its two-asset lifecycle survives controller restart', async (t) => {
  const { h, client, fetcher } = await setup(t);
  const first = await provisionEma(client);
  await provisionEma(client);
  assert.equal(h.store.get(first.vaultId, 'alice').idle, '500000000');
  for (let i = 0; i < 45; i++) await advanceEma(client);
  const midway = await (await client.request('/api/v1/automata/qinfra-ema-demo')).json();
  assert.equal(midway.state.trades.filter((t) => t.side === 'buy').length, 2);
  const resumed = new StrategyClient({
    owner: 'alice',
    runId: 'qinfra-ema-demo',
    targets: {},
    selectTargets: emaTargets,
    fetcher,
  });
  await resumed.connect();
  await provisionEma(resumed);
  let status = '';
  for (let i = 0; i < 125 && status !== 'finished'; i++) status = await advanceEma(resumed);
  assert.equal(status, 'finished');
  const result = await (await resumed.request('/api/v1/automata/qinfra-ema-demo')).json();
  assert.equal(result.state.status, 'stopped');
  assert.equal(result.state.trades.length, 4);
  assert.equal(result.state.positions['rwa-a'].quantity, '0');
  assert.equal(result.state.positions['rwa-b'].quantity, '0');
  assert.equal(result.state.trades[0].at, 31000);
  assert.equal(result.state.trades.filter((t) => t.side === 'sell').length, 2);
});
test('paused demo still observes risk frames without buying and manual stop ends the controller', async (t) => {
  const { client } = await setup(t);
  await provisionEma(client);
  await client.request(
    '/api/v1/automata/qinfra-ema-demo/actions',
    JSON.stringify({ id: 'pause', expectedRevision: 0, type: 'pause' }),
  );
  for (let i = 0; i < 40; i++) await advanceEma(client);
  let result = await (await client.request('/api/v1/automata/qinfra-ema-demo')).json();
  assert.equal(result.state.status, 'paused');
  assert.equal(result.state.cursor, 40);
  assert.equal(result.state.trades.length, 0);
  await client.request(
    '/api/v1/automata/qinfra-ema-demo/actions',
    JSON.stringify({ id: 'stop', expectedRevision: 0, type: 'stop' }),
  );
  assert.equal(await advanceEma(client), 'finished');
  result = await (await client.request('/api/v1/automata/qinfra-ema-demo')).json();
  assert.equal(result.state.trades.length, 0);
});
