import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productHarness } from './helpers/product-api.ts';

const parameters = {
  strategyMode: 'external',
  weights: { 'rwa-a': 5000, 'rwa-b': 0 },
  deviationBps: 1,
  intervalMs: 5000,
  feeBps: 0,
  maxSlippageBps: 100,
  limits: { mode: 'off' },
};
async function setup() {
  const h = await productHarness(),
    cookie = await h.login(),
    vault = await h.claim(cookie);
  await h.request(cookie, `/api/vaults/${vault.id}/commands`, {
    id: 'deposit',
    expectedRevision: 0,
    type: 'deposit',
    amount: '1000000000',
  });
  const created = await h.request(cookie, '/api/v1/automata', {
    id: 'external',
    vaultId: vault.id,
    amount: '500000000',
    datasetId: 'trend',
    parameters,
  });
  assert.equal(created.statusCode, 200, created.body);
  return { ...h, cookie, vault };
}
const envelope = (revision = 1) => ({
  protocol: 'alphaforge-targets-v1',
  runId: 'external',
  id: 'decision1',
  expectedRevision: revision,
  frameSeq: 1,
  targets: { 'rwa-a': 5000, 'rwa-b': 5000 },
});

test('owner-scoped strategy context and decisions expose only observed frames and preserve idempotency', async (t) => {
  const h = await setup();
  t.after(() => h.app.close());
  const initial = await h.request(h.cookie, '/api/v1/automata/external/strategy-context');
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().ready, false);
  assert.deepEqual(initial.json().quotes, {});
  const bob = await h.login('bob');
  assert.equal((await h.request(bob, '/api/v1/automata/external/strategy-context')).statusCode, 404);
  assert.equal((await h.request(bob, '/api/v1/automata/external/decisions', envelope())).statusCode, 404);
  await h.request(h.cookie, '/api/v1/automata/external/actions', {
    id: 'step',
    expectedRevision: 0,
    type: 'step',
  });
  const context = (await h.request(h.cookie, '/api/v1/automata/external/strategy-context')).json();
  assert.equal(context.protocol, 'alphaforge-targets-v1');
  assert.equal(context.scope, 'TEST_ONLY');
  assert.equal(context.frameSeq, 1);
  assert.equal(context.revision, 1);
  assert.equal(context.ready, true);
  assert.equal(context.clock, 1000);
  assert.equal(context.cash, '500000000');
  assert.equal(context.futureFrames, undefined);
  const request = envelope();
  const result = await h.request(h.cookie, '/api/v1/automata/external/decisions', request);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().state.trades.length, 2);
  assert.equal(result.json().state.positions['rwa-a'].quantity, '2500000');
  assert.equal(result.json().state.positions['rwa-b'].quantity, '2500000');
  assert.deepEqual(
    (await h.request(h.cookie, '/api/v1/automata/external/decisions', request)).json(),
    result.json(),
  );
  assert.equal(
    (await h.request(h.cookie, '/api/v1/automata/external/decisions', { ...request, targets: {} })).json()
      .error,
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(
    (await h.request(h.cookie, '/api/v1/automata/external/strategy-context')).json().lastDecision.id,
    'decision1',
  );
});

test('funding, new frames, protocol mismatches and stop invalidate unsafe strategy decisions', async (t) => {
  const h = await setup();
  t.after(() => h.app.close());
  await h.request(h.cookie, '/api/v1/automata/external/actions', {
    id: 'step',
    expectedRevision: 0,
    type: 'step',
  });
  for (const bad of [
    { ...envelope(), protocol: 'v999' },
    { ...envelope(), runId: 'different' },
    { ...envelope(), targets: { 'rwa-a': 6000, 'rwa-b': 6000 } },
    { ...envelope(), signer: 'forbidden' },
  ]) {
    assert.equal((await h.request(h.cookie, '/api/v1/automata/external/decisions', bad)).statusCode, 400);
  }
  await h.request(h.cookie, '/api/v1/automata/external/actions', {
    id: 'fund',
    expectedRevision: 1,
    type: 'fund',
    direction: 'in',
    amount: '100000000',
  });
  assert.equal(
    (await h.request(h.cookie, '/api/v1/automata/external/decisions', envelope())).json().error,
    'REVISION_CONFLICT',
  );
  await h.request(h.cookie, '/api/v1/automata/external/actions', {
    id: 'step2',
    expectedRevision: 2,
    type: 'step',
  });
  assert.equal(
    (await h.request(h.cookie, '/api/v1/automata/external/decisions', envelope(3))).json().error,
    'STRATEGY_FRAME',
  );
  await h.request(h.cookie, '/api/v1/automata/external/actions', {
    id: 'stop',
    expectedRevision: 0,
    type: 'stop',
  });
  assert.equal(
    (await h.request(h.cookie, '/api/v1/automata/external/decisions', { ...envelope(4), frameSeq: 2 })).json()
      .error,
    'INVALID_STATUS',
  );
  assert.equal((await h.request(h.cookie, '/api/v1/automata/external')).json().state.trades.length, 0);
});

test('decision checkpoint rolls back atomically and exact retries survive server restart', async (t) => {
  const h = await setup();
  t.after(() => h.app.close());
  await h.request(h.cookie, '/api/v1/automata/external/actions', {
    id: 'step',
    expectedRevision: 0,
    type: 'step',
  });
  const before = h.store.get(h.vault.id, 'alice');
  h.store.db.exec(
    "CREATE TEMP TRIGGER fail_decision BEFORE UPDATE ON automata_runs BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;",
  );
  const failed = await h.request(h.cookie, '/api/v1/automata/external/decisions', envelope());
  assert.equal(failed.statusCode, 500);
  assert.deepEqual(h.store.get(h.vault.id, 'alice'), before);
  assert.equal((await h.request(h.cookie, '/api/v1/automata/external')).json().revision, 1);
  h.store.db.exec('DROP TRIGGER fail_decision');
  const accepted = await h.request(h.cookie, '/api/v1/automata/external/decisions', envelope());
  assert.equal(accepted.statusCode, 200, accepted.body);
  await h.app.close();
  const restored = await productHarness(h.path);
  t.after(() => restored.app.close());
  const cookie = await restored.login();
  const replay = await restored.request(cookie, '/api/v1/automata/external/decisions', envelope());
  assert.deepEqual(replay.json(), accepted.json());
  assert.equal(
    (await restored.request(cookie, '/api/v1/automata/external/strategy-context')).json().lastDecision.id,
    'decision1',
  );
});
