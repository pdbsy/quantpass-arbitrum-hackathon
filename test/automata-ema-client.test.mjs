import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { productHarness } from './helpers/product-api.ts';
import { StrategyClient } from '../tools/automata/strategy-client.mjs';
import { DecisionJournal } from '../tools/automata/decision-journal.mjs';

// Fastify routes, authentication, SQLite and engine are real; only a lost HTTP response is injected.
test('durable outbox retries an accepted decision after process restart without duplicate fills', async (t) => {
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
  await h.request(cookie, '/api/v1/automata', {
    id: 'ema',
    vaultId: vault.id,
    amount: '500000000',
    datasetId: 'trend',
    parameters: {
      strategyMode: 'external',
      weights: { 'rwa-a': 5000 },
      deviationBps: 1,
      intervalMs: 1000,
      feeBps: 0,
      maxSlippageBps: 100,
      limits: { mode: 'off' },
    },
  });
  await h.request(cookie, '/api/v1/automata/ema/actions', { id: 'step', expectedRevision: 0, type: 'step' });
  let lose = true;
  const fetcher = async (url, options) => {
    const r = await h.app.inject({
      method: options.method,
      url: new URL(url).pathname,
      headers: { ...options.headers, host: '127.0.0.1:4180' },
      ...(options.body ? { payload: options.body } : {}),
    });
    if (url.endsWith('/decisions') && lose) {
      lose = false;
      throw new Error('lost accepted response');
    }
    return new Response(r.body, { status: r.statusCode, headers: r.headers });
  };
  const file = join(h.directory, 'outbox.sqlite');
  let journal = new DecisionJournal(file);
  let client = new StrategyClient({
    owner: 'alice',
    runId: 'ema',
    targets: {},
    selectTargets: () => ({ 'rwa-a': 5000 }),
    journal,
    fetcher,
  });
  await client.connect();
  await assert.rejects(client.tick(), /lost accepted/);
  const pending = client.pending;
  assert.ok(pending);
  assert.equal((await h.request(cookie, '/api/v1/automata/ema')).json().state.trades.length, 1);
  journal.close();
  journal = new DecisionJournal(file);
  t.after(() => journal.close());
  client = new StrategyClient({
    owner: 'alice',
    runId: 'ema',
    targets: {},
    selectTargets: () => {
      throw new Error('must retry before computing');
    },
    journal,
    fetcher,
  });
  await client.connect();
  assert.equal(await client.tick(), 'accepted');
  assert.equal((await h.request(cookie, '/api/v1/automata/ema')).json().state.trades.length, 1);
  assert.equal(journal.load(client.journalKey), null);
});
test('journal separates owners/runs and clears only the acknowledged envelope', () => {
  const j = new DecisionJournal(':memory:');
  try {
    assert.equal(j.prepare('alice/run', 'one'), 'one');
    assert.equal(j.prepare('alice/run', 'two'), 'one');
    j.clear('alice/run', 'two');
    assert.equal(j.load('alice/run'), 'one');
    assert.equal(j.load('bob/run'), null);
    j.clear('alice/run', 'one');
    assert.equal(j.load('alice/run'), null);
  } finally {
    j.close();
  }
});
test('failed durable preparation cannot be bypassed by retrying the in-memory pending request', async () => {
  let decisionCalls = 0,
    preparations = 0;
  const context = {
    protocol: 'alphaforge-targets-v1',
    scope: 'TEST_ONLY',
    runId: 'run',
    ready: true,
    revision: 1,
    frameSeq: 1,
    eligibleAssets: ['rwa-a'],
    lastDecision: null,
    status: 'running',
  };
  const client = new StrategyClient({
    owner: 'alice',
    runId: 'run',
    targets: { 'rwa-a': 5000 },
    journal: {
      load: () => null,
      prepare: () => {
        preparations++;
        throw new Error('disk full');
      },
    },
    fetcher: async (url) => {
      if (url.endsWith('/session')) return new Response('{}', { headers: { 'set-cookie': 'demo=fixture' } });
      if (url.endsWith('/strategy-context')) return new Response(JSON.stringify(context));
      decisionCalls++;
      return new Response('{}');
    },
  });
  await client.connect();
  await assert.rejects(client.tick(), /disk full/);
  await assert.rejects(client.tick(), /disk full/);
  assert.equal(preparations, 2);
  assert.equal(decisionCalls, 0);
});

// Replacing bound parameters with interpolation must fail these isolation assertions.
test('journal treats SQL-shaped keys and envelopes as opaque data', () => {
  const journal = new DecisionJournal(':memory:');
  const key = "owner'); DROP TABLE pending_decisions; --";
  const body = '{"id":"\'); DELETE FROM pending_decisions; --"}';
  try {
    journal.prepare('other', 'retained');
    assert.equal(journal.prepare(key, body), body);
    assert.equal(journal.load(key), body);
    assert.equal(journal.load("' OR 1=1 --"), null);
    journal.clear(key, 'different envelope');
    assert.equal(journal.load(key), body);
    journal.clear(key, body);
    assert.equal(journal.load(key), null);
    assert.equal(journal.load('other'), 'retained');
    assert.equal(journal.prepare('after', 'still usable'), 'still usable');
  } finally {
    journal.close();
  }
});
