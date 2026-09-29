import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parametersFromForm, requestSimulation } from '../apps/web/src/automata-client.ts';

const form = {
  weight: '50',
  deviation: '1',
  seconds: '5',
  fee: '0.1',
  slippage: '1',
  mode: 'percent',
  upper: '10',
  lower: '-5',
};
test('form preserves inclusive signed percentage bounds and exact price units', () => {
  assert.deepEqual(parametersFromForm(form), {
    weights: { 'rwa-a': 5000 },
    deviationBps: 100,
    intervalMs: 5000,
    feeBps: 10,
    maxSlippageBps: 100,
    limits: { mode: 'percent', upperBps: 1000, lowerBps: -500 },
  });
  assert.deepEqual(parametersFromForm({ ...form, mode: 'price', upper: '120.123456', lower: '' }).limits, {
    mode: 'price',
    assetId: 'rwa-a',
    upper: '120123456',
  });
  assert.throws(() => parametersFromForm({ ...form, upper: 'NaN' }));
  assert.throws(() => parametersFromForm({ ...form, upper: '', lower: '' }));
  assert.throws(() => parametersFromForm({ ...form, lower: '5' }));
});
test('simulation client sends same-origin credentials and exposes a structured rejection', async () => {
  let request: RequestInit | undefined;
  const result = await requestSimulation('/api/v1/automata', undefined, async (_url, options) => {
    request = options;
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });
  assert.deepEqual(result, { items: [] });
  assert.equal(request?.credentials, 'same-origin');
  await assert.rejects(
    () =>
      requestSimulation(
        '/api/v1/automata',
        {},
        async () => new Response(JSON.stringify({ error: 'INSUFFICIENT_BOT_CASH' }), { status: 409 }),
      ),
    /可用现金不足/,
  );
});
