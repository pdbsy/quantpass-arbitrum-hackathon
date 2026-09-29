import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productHarness } from './helpers/product-api.ts';
const parameters = {
  weights: { 'rwa-a': 5000 },
  deviationBps: 100,
  intervalMs: 1000,
  feeBps: 10,
  maxSlippageBps: 100,
  limits: { mode: 'percent', upperBps: 1000, lowerBps: -500 },
};
test('authenticated API funds, runs and liquidates a simulation with owner isolation', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    bob = await h.login('bob'),
    vault = await h.claim(cookie);
  await h.request(cookie, `/api/vaults/${vault.id}/commands`, {
    id: 'deposit',
    expectedRevision: 0,
    type: 'deposit',
    amount: '1500000000',
  });
  const created = await h.request(cookie, '/api/v1/automata', {
    id: 'run1',
    vaultId: vault.id,
    amount: '1000000000',
    datasetId: 'trend',
    parameters,
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.equal((await h.request(bob, '/api/v1/automata/run1')).statusCode, 404);
  assert.equal((await h.request('', '/api/v1/automata')).statusCode, 401);
  assert.equal(
    (
      await h.request(cookie, '/api/v1/automata/run1/actions', {
        id: 'invalid',
        expectedRevision: 0,
        type: 'frame',
        frame: {},
      })
    ).statusCode,
    400,
  );
  const step = await h.request(cookie, '/api/v1/automata/run1/actions', {
    id: 'step',
    expectedRevision: 0,
    type: 'step',
  });
  assert.equal(step.statusCode, 200, step.body);
  assert.equal(step.json().state.trades.length, 1);
  const over = await h.request(cookie, '/api/v1/automata/run1/actions', {
    id: 'out',
    expectedRevision: 1,
    type: 'fund',
    direction: 'out',
    amount: '900000000',
  });
  assert.equal(over.statusCode, 409);
  assert.equal(over.json().error, 'INSUFFICIENT_BOT_CASH');
  const stop = await h.request(cookie, '/api/v1/automata/run1/actions', {
    id: 'stop',
    expectedRevision: 1,
    type: 'stop',
  });
  assert.equal(stop.statusCode, 200, stop.body);
  assert.equal(stop.json().state.status, 'stopped');
  assert.equal(stop.json().state.trigger.reason, 'manual');
  assert.equal((await h.request(cookie, '/api/v1/automata')).json().items.length, 1);
});
test('automata rejects unknown fields, invalid assets and missing demo headers', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    vault = await h.claim(cookie);
  const body = { id: 'run1', vaultId: vault.id, amount: '1', datasetId: 'trend', parameters };
  assert.equal(
    (await h.request(cookie, '/api/v1/automata', { ...body, signer: 'forbidden' })).statusCode,
    400,
  );
  assert.equal(
    (
      await h.request(cookie, '/api/v1/automata', {
        ...body,
        parameters: { ...parameters, weights: { unknown: 5000 } },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/automata',
        headers: { host: '127.0.0.1:4180', cookie },
        payload: body,
      })
    ).statusCode,
    403,
  );
  const catalog = (await h.request(cookie, '/api/v1/automata/catalog')).json();
  assert.equal(catalog.scope, 'TEST_ONLY');
  assert.equal(catalog.assets[0].contract, null);
});
test('cross-field configuration errors are definitive 400 responses without funding', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login(),
    vault = await h.claim(cookie);
  await h.request(cookie, `/api/vaults/${vault.id}/commands`, {
    id: 'deposit',
    expectedRevision: 0,
    type: 'deposit',
    amount: '1000000000',
  });
  for (const params of [
    { ...parameters, weights: { 'rwa-a': 6000, 'rwa-b': 6000 } },
    { ...parameters, limits: { mode: 'price', assetId: 'rwa-a', upper: '90', lower: '100' } },
  ]) {
    const response = await h.request(cookie, '/api/v1/automata', {
      id: 'invalid-run',
      vaultId: vault.id,
      amount: '100000000',
      datasetId: 'trend',
      parameters: params,
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error, 'INVALID_REQUEST');
  }
  assert.equal((await h.request(cookie, '/api/v1/automata')).json().items.length, 0);
});
