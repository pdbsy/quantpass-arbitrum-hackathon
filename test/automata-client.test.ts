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
test('multi-asset strategy form preserves weights, external mode and the price trigger asset', () => {
  const p = parametersFromForm({
    ...form,
    weight: '30',
    weightB: '40',
    strategyMode: 'external',
    priceAsset: 'rwa-b',
    mode: 'price',
    upper: '120',
    lower: '90',
  });
  assert.deepEqual(p.weights, { 'rwa-a': 3000, 'rwa-b': 4000 });
  assert.equal(p.strategyMode, 'external');
  assert.deepEqual(p.limits, { mode: 'price', assetId: 'rwa-b', upper: '120000000', lower: '90000000' });
  assert.throws(() => parametersFromForm({ ...form, weight: '80', weightB: '30' }));
  assert.throws(() => parametersFromForm({ ...form, strategyMode: 'unknown' }));
});

test('external JSON targets bind the current run frame and cannot spend beyond eligible weights', async () => {
  const ui = await import('../apps/web/src/automata-client.ts');
  assert.ok(ui.externalDecisionFromJson, 'an explicit external JSON submission parser is required');
  const context = {
    protocol: 'alphaforge-targets-v1',
    scope: 'TEST_ONLY',
    runId: 'run-1',
    revision: 4,
    frameSeq: 2,
    mode: 'external',
    status: 'running',
    ready: true,
    eligibleAssets: ['rwa-a', 'rwa-b'],
    lastDecision: null,
  };
  assert.deepEqual(ui.externalDecisionFromJson('{"rwa-a":3000,"rwa-b":2000}', context, 'signal-1'), {
    protocol: 'alphaforge-targets-v1',
    runId: 'run-1',
    id: 'signal-1',
    expectedRevision: 4,
    frameSeq: 2,
    targets: { 'rwa-a': 3000, 'rwa-b': 2000 },
  });
  for (const raw of [
    '{',
    '[]',
    'null',
    '{"other":100}',
    '{"rwa-a":10001}',
    '{"rwa-a":5000,"rwa-b":6000}',
    '{"rwa-a":1.5}',
    '{"rwa-a":-1}',
  ])
    assert.throws(() => ui.externalDecisionFromJson(raw, context, 'signal-1'));
  for (const changed of [
    { ready: false },
    { mode: 'rebalance' },
    { scope: 'PRODUCTION' },
    { lastDecision: { frameSeq: 2 } },
    { status: 'stopped' },
  ])
    assert.throws(() => ui.externalDecisionFromJson('{}', { ...context, ...changed }, 'signal-1'));
});
