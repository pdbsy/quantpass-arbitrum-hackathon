import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrategyClient, runStrategy } from '../tools/automata/strategy-client.mjs';
const context = (revision = 1, frameSeq = 1) => ({
  protocol: 'alphaforge-targets-v1',
  scope: 'TEST_ONLY',
  runId: 'run',
  ready: true,
  revision,
  frameSeq,
  eligibleAssets: ['rwa-a'],
  lastDecision: null,
  replayComplete: false,
  status: 'running',
});
const response = (body, status = 200, cookie) =>
  new Response(JSON.stringify(body), { status, headers: cookie ? { 'set-cookie': cookie } : {} });
function harness(sequence) {
  const calls = [];
  const client = new StrategyClient({
    baseUrl: 'http://127.0.0.1:4180',
    owner: 'alice',
    runId: 'run',
    targets: { 'rwa-a': 5000 },
    fetcher: async (url, options) => {
      calls.push({ url, ...options });
      const item = sequence.shift();
      if (item instanceof Error) throw item;
      assert.ok(item, 'unexpected request');
      return item;
    },
  });
  return { client, calls };
}
test('reference client admits only loopback HTTP and rejects malformed strategy configuration', () => {
  for (const baseUrl of [
    'https://example.com',
    'http://127.0.0.1.evil.test',
    'http://user:pass@localhost',
    'http://localhost/path',
    'http://localhost?secret=x',
  ]) {
    assert.throws(() => new StrategyClient({ baseUrl, owner: 'alice', runId: 'run', targets: {} }));
  }
  assert.throws(() => new StrategyClient({ owner: 'eve', runId: 'run', targets: {} }));
  assert.throws(() => new StrategyClient({ owner: 'alice', runId: '../bad', targets: {} }));
  assert.throws(() => new StrategyClient({ owner: 'alice', runId: 'run', targets: { 'rwa-a': 10001 } }));
});
test('unknown outcome retries identical immutable envelope before reading another context', async () => {
  const { client, calls } = harness([
    response({}, 200, 'demo=session; HttpOnly'),
    response(context()),
    new Error('lost response'),
    response({ revision: 2 }),
    response({ ...context(2), lastDecision: { frameSeq: 1 } }),
  ]);
  await client.connect();
  await assert.rejects(client.tick(), /lost response/);
  assert.equal(await client.tick(), 'accepted');
  assert.equal(calls[2].body, calls[3].body);
  assert.equal(calls[3].redirect, 'error');
  assert.equal(calls[3].headers.cookie, 'demo=session');
  assert.equal(await client.tick(), 'waiting');
  assert.equal(calls.length, 5);
});
test('stale rejection rereads context and changes ID; stopped contexts never submit', async () => {
  const { client, calls } = harness([
    response({}, 200, 'demo=session'),
    response(context()),
    response({ error: 'REVISION_CONFLICT' }, 409),
    response(context(3, 2)),
    response({ revision: 4 }),
    response({ ...context(4, 3), ready: false, status: 'stopped' }),
  ]);
  await client.connect();
  assert.equal(await client.tick(), 'stale');
  assert.equal(await client.tick(), 'accepted');
  const old = JSON.parse(calls[2].body),
    next = JSON.parse(calls[4].body);
  assert.notEqual(old.id, next.id);
  assert.equal(next.expectedRevision, 3);
  assert.equal(next.frameSeq, 2);
  assert.equal(await client.tick(), 'finished');
  assert.equal(calls.length, 6);
});
test('reference controller respects cancellation and bounded polling', async () => {
  let ticks = 0;
  const client = {
    tick: async () => {
      ticks++;
      return 'waiting';
    },
  };
  await runStrategy(client, { maxPolls: 2, intervalMs: 1 });
  assert.equal(ticks, 2);
  const controller = new AbortController();
  controller.abort();
  await runStrategy(client, { maxPolls: 2, intervalMs: 1, signal: controller.signal });
  assert.equal(ticks, 2);
});
