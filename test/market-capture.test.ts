import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureReference, MarketJournal, replayReference } from '../packages/market-data/src/capture.ts';
const addr = '0x' + '12'.repeat(20);
const selection = { chainId: 4663 as const, contractAddress: addr, symbol: 'AAPL' };
const at = Date.parse('2026-09-30T01:00:00Z');
const asset = {
  id: '0x' + 'ab'.repeat(32),
  tokenSymbol: 'AAPL',
  tokenDecimals: 18,
  status: 'ASSET_STATUS_ACTIVE',
  currentMultiplier: '1',
  pendingMultiplier: '',
  deployments: [{ chainId: 4663, contractAddress: addr }],
};
const price = {
  quotes: [
    {
      tokenSymbol: 'AAPL',
      deployments: asset.deployments,
      bid: '100',
      ask: '101',
      currency: 'USD',
      isTradingHalt: false,
      generatedAt: '2026-09-30T01:00:00Z',
    },
  ],
};
const fetcher = async (url: string, init: RequestInit) => {
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'error');
  assert.ok(
    url === 'https://api.robinhood.com/rhj/assets' || url === 'https://api.robinhood.com/rhj/prices/AAPL',
  );
  return new Response(JSON.stringify(url.endsWith('/assets') ? { assets: [asset] } : price));
};
test('official capture retains exact bodies, identities, timestamps and survives database restart', async () => {
  const result = await captureReference(selection, 30000, fetcher, () => at);
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.observation?.tokenBidUsd18, '100000000000000000000');
  assert.equal(result.sources.length, 3);
  assert.equal(result.sources[1]?.body, JSON.stringify(price));
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-market-')));
  try {
    const path = join(dir, 'observations.sqlite');
    const journal = new MarketJournal(path);
    const id = journal.append(result);
    journal.close();
    const reopened = new MarketJournal(path);
    try {
      assert.deepEqual(reopened.read(id), result);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('provider failures and malformed or oversized bodies are recorded as rejected observations', async () => {
  for (const transport of [
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response('not json'),
    async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)),
    async () => {
      throw new Error('private transport detail');
    },
  ]) {
    const result = await captureReference(selection, 30000, transport, () => at);
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.observation, null);
    assert.ok(!JSON.stringify(result).includes('private transport detail'));
  }
});
test('corporate action change between registry reads rejects mixed-snapshot prices', async () => {
  let registries = 0;
  const result = await captureReference(
    selection,
    30000,
    async (url, init) => {
      if (url.endsWith('/assets'))
        return new Response(
          JSON.stringify({ assets: [{ ...asset, currentMultiplier: ++registries === 1 ? '1' : '2' }] }),
        );
      return fetcher(url, init);
    },
    () => at,
  );
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.reason, 'REGISTRY_CHANGED_DURING_CAPTURE');
});
test('invalid requested chain or address is rejected before any HTTP request', async () => {
  let called = false;
  const result = await captureReference(
    { ...selection, contractAddress: 'wrong' },
    30000,
    async () => {
      called = true;
      return new Response('');
    },
    () => at,
  );
  assert.equal(result.status, 'REJECTED');
  assert.equal(called, false);
});

test('redirected replies and backward local clocks cannot become accepted captures', async () => {
  const response = new Response('{}');
  Object.defineProperty(response, 'redirected', { value: true });
  assert.equal(
    (
      await captureReference(
        selection,
        30000,
        async () => response,
        () => at,
      )
    ).reason,
    'HTTP_RESPONSE_REJECTED',
  );
  let tick = 0;
  assert.equal(
    (await captureReference(selection, 30000, fetcher, () => at - tick++)).reason,
    'CLOCK_REGRESSION',
  );
});

test('capture CLI requires explicit identity, time policy and database and has a network-free help path', () => {
  const cli = fileURLToPath(new URL('../tools/automata/capture-market.ts', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /REFERENCE_ONLY/);
  const invalid = spawnSync(process.execPath, [cli, 'AAPL', '4663', 'wrong'], {
    encoding: 'utf8',
    timeout: 3000,
  });
  assert.equal(invalid.status, 2);
});

test('collector refuses unrelated SQLite databases and leaves their data intact', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-market-')));
  try {
    const path = join(dir, 'vault.sqlite');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE sentinel (amount INTEGER); INSERT INTO sentinel VALUES (100)');
    db.close();
    assert.throws(() => new MarketJournal(path), /JOURNAL_IDENTITY/);
    const checked = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(checked.prepare('SELECT amount FROM sentinel').get()?.amount, 100);
    } finally {
      checked.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replay derives token prices from original receipts and rejects fabricated normalized results', async () => {
  const captured = await captureReference(selection, 30000, fetcher, () => at);
  assert.deepEqual(replayReference(captured), captured.observation);
  const changed = structuredClone(captured);
  changed.observation!.tokenBidUsd18 = '999999999999999999999';
  assert.throws(() => replayReference(changed), /OBSERVATION_MISMATCH/);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-replay-')));
  const journal = new MarketJournal(join(dir, 'capture.sqlite'));
  try {
    assert.throws(() => journal.append(changed), /OBSERVATION_MISMATCH/);
  } finally {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('replay rejects wrong source identities, changed bodies and inconsistent receipt times', async () => {
  const captured = await captureReference(selection, 30000, fetcher, () => at);
  for (const change of [
    (c: typeof captured) => {
      c.sources[0]!.url = 'https://untrusted.example/registry';
    },
    (c: typeof captured) => {
      c.sources[1]!.body = '{}';
    },
    (c: typeof captured) => {
      c.sources[0]!.receivedAt = at + 1;
    },
    (c: typeof captured) => {
      c.sources.pop();
    },
    (c: typeof captured) => {
      c.status = 'REJECTED';
    },
  ]) {
    const copy = structuredClone(captured);
    change(copy);
    assert.throws(() => replayReference(copy));
  }
});

test('an in-flight request snapshots its asset selection before callers mutate their object', async () => {
  const mutable = { ...selection };
  const pending = captureReference(
    mutable,
    30000,
    async (url, init) => {
      mutable.symbol = 'MSFT';
      return fetcher(url, init);
    },
    () => at,
  );
  const result = await pending;
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.selection.symbol, 'AAPL');
  assert.deepEqual(replayReference(result), result.observation);
});
test('journal replay rejects a rewritten projection even when its payload checksum was refreshed', async () => {
  const capture = await captureReference(selection, 30000, fetcher, () => at);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-replay-corrupt-')));
  try {
    const path = join(dir, 'capture.sqlite');
    const journal = new MarketJournal(path);
    const id = journal.append(capture);
    journal.close();
    capture.observation!.tokenAskUsd18 = '999';
    const payload = JSON.stringify(capture);
    // Deliberately corrupt only this synthetic test database, as a faulty external exporter might.
    const db = new DatabaseSync(path);
    try {
      db.exec('DROP TRIGGER immutable_capture_update');
      db.prepare('UPDATE reference_captures SET payload=?,sha256=? WHERE id=?').run(
        payload,
        createHash('sha256').update(payload).digest('hex'),
        id,
      );
    } finally {
      db.close();
    }
    const restored = new MarketJournal(path);
    try {
      assert.throws(() => restored.read(id), /OBSERVATION_MISMATCH/);
    } finally {
      restored.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('external cancellation terminates an uncooperative HTTP body reader', { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    const result = await captureReference(
      selection,
      30000,
      async () =>
        new Response(
          new ReadableStream({
            pull() {
              return new Promise(() => {});
            },
            cancel() {
              return new Promise(() => {});
            },
          }),
        ),
      () => at,
      controller.signal,
    );
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reason, 'CAPTURE_ABORTED');
    assert.equal(result.observation, null);
  } finally {
    clearTimeout(timer);
  }
});
test('cancellation before the queued HTTP request prevents transport from starting', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = captureReference(
    selection,
    30000,
    async () => {
      calls++;
      return new Response('{}');
    },
    () => at,
    controller.signal,
  );
  controller.abort();
  assert.equal((await pending).reason, 'CAPTURE_ABORTED');
  assert.equal(calls, 0);
});
