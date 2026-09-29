import test from 'node:test';
import assert from 'node:assert/strict';
import { productHarness } from './helpers/product-api.ts';
const parameters = {
  strategyMode: 'external',
  weights: { 'rwa-a': 5000 },
  deviationBps: 1,
  intervalMs: 1000,
  feeBps: 0,
  maxSlippageBps: 100,
  limits: { mode: 'off' },
};
test('opt-in Vault locks deposits, isolates owners and settles a withdrawal exactly once across reopen', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login();
  const created = await h.request(cookie, '/api/v1/vaults', {
    strategyId: 'core-flow-demo',
    passPolicy: 'principal-v1',
  });
  assert.equal(created.statusCode, 200, created.body);
  let v = created.json();
  const command = async (fields: Record<string, unknown>) => {
    const r = await h.request(cookie, `/api/v1/vaults/${v.id}/commands`, {
      id: `c${v.revision}`,
      expectedRevision: v.revision,
      ...fields,
    });
    assert.equal(r.statusCode, 200, r.body);
    v = r.json().vault ?? r.json();
    return r;
  };
  await command({ type: 'deposit', amount: '500000000' });
  assert.equal(v.passAccounting.lockedPassRaw, '500000000000000000000');
  assert.equal(v.passAccounting.freePassRaw, '500000000000000000000');
  const id = `c${v.revision}`;
  await command({ type: 'requestWithdrawal', amount: '100000000' });
  assert.equal(v.passAccounting.lockedPassRaw, '500000000000000000000');
  const bob = await h.login('bob');
  assert.equal((await h.request(bob, `/api/v1/vaults/${v.id}`)).statusCode, 404);
  const body = { id: 'confirm', expectedRevision: v.revision, type: 'confirmWithdrawal', withdrawalId: id };
  const r = await h.request(cookie, `/api/v1/vaults/${v.id}/commands`, body);
  assert.equal(r.statusCode, 200, r.body);
  v = (await h.request(cookie, `/api/v1/vaults/${v.id}`)).json();
  assert.equal(v.passAccounting.lockedPassRaw, '400000000000000000000');
  await h.app.close();
  const h2 = await productHarness(h.path);
  t.after(() => h2.app.close());
  const cookie2 = await h2.login();
  const retry = await h2.request(cookie2, `/api/v1/vaults/${v.id}/commands`, body);
  assert.equal(retry.statusCode, 200, retry.body);
  const read = (await h2.request(cookie2, `/api/v1/vaults/${v.id}`)).json();
  assert.equal(read.withdrawalsPaid, '100000000');
  assert.equal(read.passAccounting.lockedPassRaw, '400000000000000000000');
});
test('Bot cash withdrawal preserves Pass lock; principal payout is denied while positions remain', async (t) => {
  const h = await productHarness();
  t.after(() => h.app.close());
  const cookie = await h.login();
  const created = await h.request(cookie, '/api/v1/vaults', {
    strategyId: 'core-flow-demo',
    passPolicy: 'principal-v1',
  });
  assert.equal(created.statusCode, 200, created.body);
  const v = created.json();
  await h.request(cookie, `/api/v1/vaults/${v.id}/commands`, {
    id: 'd',
    expectedRevision: 0,
    type: 'deposit',
    amount: '1000000000',
  });
  const run = await h.request(cookie, '/api/v1/automata', {
    id: 'pass-bot',
    vaultId: v.id,
    amount: '500000000',
    datasetId: 'trend',
    parameters,
  });
  assert.equal(run.statusCode, 200, run.body);
  const act = async (body: unknown) => h.request(cookie, '/api/v1/automata/pass-bot/actions', body);
  await act({ id: 'f', expectedRevision: 0, type: 'fund', direction: 'out', amount: '100000000' });
  let read = (await h.request(cookie, `/api/v1/vaults/${v.id}`)).json();
  assert.equal(read.idle, '600000000');
  assert.equal(read.passAccounting.lockedPassRaw, '1000000000000000000000');
  await act({ id: 's', expectedRevision: 1, type: 'step' });
  const d = await h.request(cookie, '/api/v1/automata/pass-bot/decisions', {
    protocol: 'alphaforge-targets-v1',
    runId: 'pass-bot',
    id: 'buy',
    expectedRevision: 2,
    frameSeq: 1,
    targets: { 'rwa-a': 5000 },
  });
  assert.equal(d.statusCode, 200, d.body);
  read = (await h.request(cookie, `/api/v1/vaults/${v.id}`)).json();
  assert.equal(read.passAccounting.withdrawable, '0');
  const denied = await h.request(cookie, `/api/v1/vaults/${v.id}/commands`, {
    id: 'withdraw',
    expectedRevision: read.revision,
    type: 'requestWithdrawal',
    amount: '1',
  });
  assert.equal(denied.statusCode, 409, denied.body);
  assert.equal(denied.json().error, 'OPEN_PASS_POSITIONS');
});
