import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as batches from '../packages/market-data/src/batch.ts';
import * as journals from '../packages/market-data/src/batch-journal.ts';
import * as workers from '../packages/market-data/src/batch-continuous.ts';
import { MarketJournal } from '../packages/market-data/src/capture.ts';
import type { ReadTransport } from '../packages/market-data/src/capture.ts';
const time = Date.parse('2026-09-30T01:00:10Z');
const symbols = ['MSFT', 'NVDA', 'AAPL'];
const assets = symbols.map((symbol, i) => ({
  id: '0x' + String(i + 1).repeat(64),
  tokenSymbol: symbol,
  tokenDecimals: 18,
  status: 'ASSET_STATUS_ACTIVE',
  currentMultiplier: '1',
  pendingMultiplier: '',
  deployments: [{ chainId: 4663, contractAddress: '0x' + String(i + 1).repeat(40) }],
}));
const policy = () => ({
  selections: assets.map((a) => ({
    chainId: 4663,
    contractAddress: a.deployments[0]!.contractAddress,
    symbol: a.tokenSymbol,
  })),
  maxAgeMs: 30000,
  maxQuoteSkewMs: 1000,
  maxCaptureSpanMs: 1000,
});
const config = () => ({ ...policy(), intervalMs: 1, maxBatches: 2, maxConsecutiveRejections: 2 });
function transport(options: { skew?: boolean; halted?: boolean; denied?: boolean } = {}): ReadTransport {
  return async (url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.ok(
      url === 'https://api.robinhood.com/rhj/assets' ||
        symbols.some((s) => url === 'https://api.robinhood.com/rhj/prices/' + s),
    );
    if (options.denied) return new Response('', { status: 403 });
    if (url.endsWith('/assets')) return new Response(JSON.stringify({ assets }));
    const i = symbols.indexOf(url.split('/').at(-1)!);
    const a = assets[i]!;
    return new Response(
      JSON.stringify({
        quotes: [
          {
            tokenSymbol: a.tokenSymbol,
            deployments: a.deployments,
            bid: String((i + 1) * 100),
            ask: String((i + 1) * 100 + 1),
            currency: 'USD',
            isTradingHalt: options.halted === true && i === 1,
            generatedAt: new Date(time - (options.skew && i === 1 ? 2000 : 0)).toISOString(),
          },
        ],
      }),
    );
  };
}
function database() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-batch-')));
  const path = join(dir, 'batches.sqlite');
  return { dir, path, journal: new journals.BatchJournal(path) };
}
test('three canonical sources form one complete reference batch with independently checked prices', async () => {
  const b = await batches.captureReferenceBatch(policy(), transport(), () => time);
  assert.equal(b.status, 'ACCEPTED');
  assert.equal(b.reason, null);
  assert.deepEqual(
    b.observations?.map((o) => [o.symbol, o.tokenBidUsd18]),
    [
      ['MSFT', '100000000000000000000'],
      ['NVDA', '200000000000000000000'],
      ['AAPL', '300000000000000000000'],
    ],
  );
  assert.equal(b.captures.length, 3);
  assert.equal(batches.replayReferenceBatch(b)[2]!.identity, '4663:0x' + '3'.repeat(40));
});
test('a halted member rejects the entire batch without exposing partial prices', async () => {
  const b = await batches.captureReferenceBatch(policy(), transport({ halted: true }), () => time);
  assert.equal(b.status, 'REJECTED');
  assert.equal(b.reason, 'BATCH_MEMBER_REJECTED');
  assert.equal(b.observations, null);
  assert.equal(b.captures[0]!.status, 'ACCEPTED');
  assert.equal(b.captures[1]!.reason, 'QUOTE_UNAVAILABLE');
  assert.throws(() => batches.replayReferenceBatch(b), /BATCH_NOT_ACCEPTED/);
});
test('explicit quote skew blocks individually fresh but mutually inconsistent timestamps', async () => {
  const b = await batches.captureReferenceBatch(policy(), transport({ skew: true }), () => time);
  assert.equal(b.status, 'REJECTED');
  assert.equal(b.reason, 'BATCH_QUOTE_SKEW');
  assert.equal(b.observations, null);
  assert.ok(b.captures.every((c) => c.status === 'ACCEPTED'));
  const accepted = await batches.captureReferenceBatch(
    { ...policy(), maxQuoteSkewMs: 2000 },
    transport({ skew: true }),
    () => time,
  );
  assert.equal(accepted.status, 'ACCEPTED');
});
test('freshness is rechecked at batch completion rather than only at each asset capture', async () => {
  let n = 0;
  const b = await batches.captureReferenceBatch(
    { ...policy(), maxAgeMs: 100, maxCaptureSpanMs: 1000 },
    transport(),
    () => (++n <= 10 ? time : time + 101),
  );
  assert.equal(b.status, 'REJECTED');
  assert.equal(b.reason, 'BATCH_STALE_OR_FUTURE_QUOTE');
  assert.equal(b.observations, null);
});
test('batch elapsed-time and regressing clocks cannot produce usable observations', async () => {
  for (const [delta, reason] of [
    [1001, 'BATCH_CAPTURE_SPAN'],
    [-1, 'BATCH_CLOCK_REGRESSION'],
  ] as const) {
    let n = 0;
    const b = await batches.captureReferenceBatch(policy(), transport(), () =>
      ++n <= 10 ? time : time + delta,
    );
    assert.equal(b.status, 'REJECTED');
    assert.equal(b.reason, reason);
    assert.equal(b.observations, null);
  }
});
test('batch configuration rejects duplicate identities, ticker substitutions, extra fields and mixed source chains before GETs', async () => {
  for (const invalid of [
    {},
    { ...policy(), selections: [] },
    { ...policy(), maxAgeMs: 0 },
    { ...policy(), maxQuoteSkewMs: -1 },
    { ...policy(), maxCaptureSpanMs: 2147483648 },
    { ...policy(), selections: [policy().selections[0], policy().selections[0]] },
    { ...policy(), selections: [...policy().selections, policy().selections[0]] },
    { ...policy(), selections: [policy().selections[0], { ...policy().selections[1], symbol: 'MSFT' }] },
    { ...policy(), selections: [policy().selections[0], { ...policy().selections[1], chainId: 46630 }] },
    { ...policy(), extra: 'private' },
    { ...policy(), selections: [{ ...policy().selections[0], extra: 'private' }] },
  ]) {
    await assert.rejects(
      batches.captureReferenceBatch(
        invalid,
        async () => {
          throw new Error('unexpected GET');
        },
        () => time,
      ),
      /INVALID_|DUPLICATE_|MIXED_/,
    );
  }
});
test('input asset policy is snapshotted before asynchronous reads', async () => {
  const p = policy();
  const read = transport();
  const b = await batches.captureReferenceBatch(
    p,
    async (url, init) => {
      p.selections[0]!.symbol = 'NVDA';
      p.maxQuoteSkewMs = 0;
      return read(url, init);
    },
    () => time,
  );
  assert.equal(b.status, 'ACCEPTED');
  assert.equal(b.policy.selections[0]!.symbol, 'MSFT');
});
test('replay rejects projection, identity and policy tampering even if raw receipt digests remain intact', async () => {
  const b = await batches.captureReferenceBatch(policy(), transport(), () => time);
  const projected = structuredClone(b);
  projected.observations![0]!.tokenBidUsd18 = '999';
  assert.throws(() => batches.replayReferenceBatch(projected), /BATCH_OBSERVATION_MISMATCH/);
  const identity = structuredClone(b);
  identity.captures[0]!.selection.contractAddress = policy().selections[1]!.contractAddress;
  assert.throws(() => batches.replayReferenceBatch(identity), /BATCH_MEMBER_IDENTITY/);
  const stale = structuredClone(b);
  stale.completedAt += 30001;
  stale.policy.maxCaptureSpanMs = 40000;
  assert.throws(() => batches.replayReferenceBatch(stale), /BATCH_STALE_OR_FUTURE_QUOTE/);
});
test(
  'pre-cancellation performs no requests; in-flight cancellation closes all members without partial projection',
  { timeout: 2000 },
  async () => {
    const c = new AbortController();
    c.abort();
    const b = await batches.captureReferenceBatch(
      policy(),
      async () => {
        throw new Error('must not GET');
      },
      () => time,
      c.signal,
    );
    assert.equal(b.reason, 'BATCH_ABORTED');
    assert.equal(b.observations, null);
    const d = new AbortController();
    const timer = setTimeout(() => d.abort(), 10);
    try {
      const interrupted = await batches.captureReferenceBatch(
        policy(),
        () => new Promise(() => {}),
        () => time,
        d.signal,
      );
      assert.equal(interrupted.reason, 'BATCH_ABORTED');
      assert.equal(interrupted.captures.length, 3);
      assert.ok(interrupted.captures.every((member) => member.reason === 'CAPTURE_ABORTED'));
    } finally {
      clearTimeout(timer);
    }
  },
);
test(
  'explicit batch timeout ends uncooperative reads and access denial remains terminal',
  { timeout: 2000 },
  async () => {
    const c = await batches.captureReferenceBatch(
      { ...policy(), maxCaptureSpanMs: 15 },
      () => new Promise(() => {}),
      () => time,
    );
    assert.equal(c.reason, 'BATCH_TIMEOUT');
    assert.equal(c.observations, null);
    const denied = await batches.captureReferenceBatch(policy(), transport({ denied: true }), () => time);
    assert.equal(denied.reason, 'HTTP_ACCESS_DENIED');
  },
);
test('one SQLite row atomically preserves all sources and stable IDs across restart', async () => {
  const d = database();
  try {
    const b = await batches.captureReferenceBatch(policy(), transport(), () => time);
    assert.equal(d.journal.append(b), 1);
    d.journal.close();
    d.journal = new journals.BatchJournal(d.path);
    assert.equal(d.journal.read(1).observations?.length, 3);
    assert.equal(d.journal.append(b), 2);
    const denied = await batches.captureReferenceBatch(policy(), transport({ denied: true }), () => time);
    assert.equal(d.journal.append(denied), 3);
    assert.equal(d.journal.read(3).reason, 'HTTP_ACCESS_DENIED');
    const db = new DatabaseSync(d.path);
    try {
      assert.throws(() => db.exec('UPDATE reference_batches SET payload=payload WHERE id=1'), /immutable/);
      assert.throws(() => db.exec('DELETE FROM reference_batches WHERE id=1'), /immutable/);
    } finally {
      db.close();
    }
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('journal rejects tampered accepted projections before append and during replay with a refreshed payload digest', async () => {
  const d = database();
  try {
    const b = await batches.captureReferenceBatch(policy(), transport(), () => time);
    const changed = structuredClone(b);
    changed.observations![0]!.tokenBidUsd18 = '999';
    assert.throws(() => d.journal.append(changed), /BATCH_OBSERVATION_MISMATCH/);
    assert.throws(() => d.journal.read(1));
    d.journal.append(b);
    const db = new DatabaseSync(d.path);
    try {
      db.exec('DROP TRIGGER immutable_batch_update');
      const payload = JSON.stringify(changed);
      db.prepare('UPDATE reference_batches SET payload=?,sha256=? WHERE id=1').run(
        payload,
        createHash('sha256').update(payload).digest('hex'),
      );
    } finally {
      db.close();
    }
    assert.throws(() => d.journal.read(1), /BATCH_OBSERVATION_MISMATCH/);
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('batch and single-reference databases refuse one another and preserve prior evidence', async () => {
  const d = database();
  const singlePath = join(d.dir, 'single.sqlite');
  const single = new MarketJournal(singlePath);
  try {
    assert.throws(() => new MarketJournal(d.path), /JOURNAL_IDENTITY_MISMATCH/);
    assert.throws(() => new journals.BatchJournal(singlePath), /JOURNAL_IDENTITY_MISMATCH/);
    const b = await batches.captureReferenceBatch(policy(), transport(), () => time);
    assert.equal(d.journal.append(b), 1);
  } finally {
    single.close();
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('continuous batches persist complete rounds and resume IDs without replacing historical evidence', async () => {
  const d = database();
  try {
    const a = await workers.collectReferenceBatches(config(), d.journal, transport(), () => time);
    assert.deepEqual(a, {
      status: 'COMPLETED',
      reason: null,
      batches: 2,
      accepted: 2,
      rejected: 0,
      lastBatchId: 2,
    });
    d.journal.close();
    d.journal = new journals.BatchJournal(d.path);
    const b = await workers.collectReferenceBatches(
      { ...config(), maxBatches: 1 },
      d.journal,
      transport(),
      () => time,
    );
    assert.equal(b.lastBatchId, 3);
    assert.equal(d.journal.read(1).observations?.[0]?.symbol, 'MSFT');
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('worker retains bad rounds, enforces explicit rejection limits and stops immediately on denied access', async () => {
  const d = database();
  try {
    const bad = await workers.collectReferenceBatches(
      { ...config(), maxBatches: null },
      d.journal,
      transport({ halted: true }),
      () => time,
    );
    assert.equal(bad.reason, 'CONSECUTIVE_REJECTION_LIMIT');
    assert.equal(bad.batches, 2);
    assert.equal(d.journal.read(2).observations, null);
    const denied = await workers.collectReferenceBatches(
      { ...config(), maxConsecutiveRejections: 100 },
      d.journal,
      transport({ denied: true }),
      () => time,
    );
    assert.equal(denied.reason, 'HTTP_ACCESS_DENIED');
    assert.equal(denied.batches, 1);
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('worker cancellation and persistence failure cannot report uncommitted progress', async () => {
  const d = database();
  const c = new AbortController();
  c.abort();
  try {
    const stopped = await workers.collectReferenceBatches(
      config(),
      d.journal,
      transport(),
      () => time,
      c.signal,
    );
    assert.equal(stopped.batches, 0);
    assert.equal(stopped.status, 'STOPPED');
    const failed = await workers.collectReferenceBatches(
      config(),
      {
        append() {
          throw new Error('private');
        },
      },
      transport(),
      () => time,
    );
    assert.equal(failed.reason, 'JOURNAL_APPEND_FAILED');
    assert.equal(failed.batches, 0);
    assert.equal(failed.lastBatchId, null);
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('worker validates all policy before fetching or persisting', async () => {
  for (const invalid of [
    { ...config(), intervalMs: 0 },
    { ...config(), maxBatches: 0 },
    { ...config(), maxConsecutiveRejections: 0 },
    { ...config(), extra: 1 },
  ]) {
    await assert.rejects(
      workers.collectReferenceBatches(
        invalid,
        {
          append() {
            throw new Error('must not append');
          },
        },
        async () => {
          throw new Error('must not GET');
        },
      ),
      /INVALID_/,
    );
  }
});
test('batch CLI help and invalid or symlink inputs remain offline and create no database', () => {
  const cli = fileURLToPath(new URL('../tools/automata/collect-portfolio-market.ts', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /REFERENCE_ONLY/);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-batch-cli-')));
  try {
    const input = join(dir, 'input.json'),
      db = join(dir, 'must-not-create.sqlite');
    writeFileSync(input, JSON.stringify({ ...config(), maxQuoteSkewMs: -1 }));
    const bad = spawnSync(process.execPath, [cli, input, db], { encoding: 'utf8', timeout: 3000 });
    assert.equal(bad.status, 2);
    assert.equal(existsSync(db), false);
    if (process.platform !== 'win32') {
      const linked = join(dir, 'linked.json');
      symlinkSync(input, linked);
      const result = spawnSync(process.execPath, [cli, linked, db], { encoding: 'utf8', timeout: 3000 });
      assert.equal(result.status, 2);
      assert.equal(existsSync(db), false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('real batch CLI persists three-source rounds across process restarts using official GET fixtures', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-batch-cli-')));
  try {
    const input = join(dir, 'config.json'),
      path = join(dir, 'batches.sqlite');
    writeFileSync(input, JSON.stringify(config()));
    const cli = new URL('../tools/automata/collect-portfolio-market.ts', import.meta.url).href;
    const script =
      'const assets=' +
      JSON.stringify(assets) +
      ';' +
      'globalThis.fetch=async(url,init)=>{if(init.method!=="GET")throw Error("unexpected");if(url==="https://api.robinhood.com/rhj/assets")return new Response(JSON.stringify({assets}));const a=assets.find(a=>url==="https://api.robinhood.com/rhj/prices/"+a.tokenSymbol);if(!a)throw Error("unexpected");return new Response(JSON.stringify({quotes:[{tokenSymbol:a.tokenSymbol,deployments:a.deployments,bid:"100",ask:"101",currency:"USD",isTradingHalt:false,generatedAt:new Date().toISOString()}]}));};' +
      'process.argv=[process.execPath,' +
      JSON.stringify(cli) +
      ',' +
      JSON.stringify(input) +
      ',' +
      JSON.stringify(path) +
      '];await import(' +
      JSON.stringify(cli) +
      ');';
    for (const id of [2, 4]) {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(JSON.parse(child.stdout).lastBatchId, id);
    }
    const journal = new journals.BatchJournal(path);
    try {
      assert.equal(journal.read(4).observations?.length, 3);
    } finally {
      journal.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('batch CLI cancellation persists a rejected round and returns SIGTERM status', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-batch-cli-stop-')));
  try {
    const input = join(dir, 'config.json'),
      path = join(dir, 'batches.sqlite');
    writeFileSync(input, JSON.stringify({ ...config(), maxBatches: null }));
    const cli = new URL('../tools/automata/collect-portfolio-market.ts', import.meta.url).href;
    const script =
      'globalThis.fetch=async()=>{process.emit("SIGTERM");return new Promise(()=>{});};process.argv=[process.execPath,' +
      JSON.stringify(cli) +
      ',' +
      JSON.stringify(input) +
      ',' +
      JSON.stringify(path) +
      '];await import(' +
      JSON.stringify(cli) +
      ');';
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(child.status, 143, child.stderr);
    assert.equal(JSON.parse(child.stdout).status, 'STOPPED');
    const journal = new journals.BatchJournal(path);
    try {
      assert.equal(journal.read(1).observations, null);
    } finally {
      journal.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an accepted complete round resets the worker rejection streak', async () => {
  const d = database();
  let round = 0,
    requests = 0;
  const read = transport(),
    halted = transport({ halted: true });
  try {
    const result = await workers.collectReferenceBatches(
      { ...config(), maxBatches: 4 },
      d.journal,
      async (url, init) => {
        if (requests++ % 9 === 0) round++;
        return (round === 1 || round === 3 ? halted : read)(url, init);
      },
      () => time,
    );
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.accepted, 2);
    assert.equal(result.rejected, 2);
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('completion-relative wait cancellation prevents a second complete round', async () => {
  const d = database(),
    c = new AbortController();
  try {
    const result = await workers.collectReferenceBatches(
      { ...config(), maxBatches: null, intervalMs: 10000 },
      {
        append(b) {
          const id = d.journal.append(b);
          setTimeout(() => c.abort(), 5);
          return id;
        },
      },
      transport(),
      () => time,
      c.signal,
    );
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.accepted, 1);
    assert.throws(() => d.journal.read(2));
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('actual SQLite insert failure preserves no partial round and no progress', async () => {
  const d = database(),
    db = new DatabaseSync(d.path);
  try {
    db.exec(
      "CREATE TRIGGER reject_write BEFORE INSERT ON reference_batches BEGIN SELECT RAISE(ABORT,'injected write failure'); END;",
    );
    const result = await workers.collectReferenceBatches(config(), d.journal, transport(), () => time);
    assert.equal(result.reason, 'JOURNAL_APPEND_FAILED');
    assert.equal(result.batches, 0);
    assert.throws(() => d.journal.read(1));
    db.exec('DROP TRIGGER reject_write');
    const b = await batches.captureReferenceBatch(policy(), transport(), () => time);
    assert.equal(d.journal.append(b), 1);
    assert.equal(d.journal.read(1).observations?.length, 3);
  } finally {
    db.close();
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('batch database refuses symlink files and unrelated SQLite without modifying them', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-batch-path-')));
  try {
    const unrelated = join(dir, 'unrelated.sqlite');
    const db = new DatabaseSync(unrelated);
    db.exec("CREATE TABLE keep (value TEXT); INSERT INTO keep VALUES ('retained');");
    db.close();
    assert.throws(() => new journals.BatchJournal(unrelated), /JOURNAL_IDENTITY_MISMATCH/);
    const verify = new DatabaseSync(unrelated, { readOnly: true });
    try {
      assert.equal(verify.prepare('SELECT value FROM keep').get()?.value, 'retained');
    } finally {
      verify.close();
    }
    if (process.platform !== 'win32') {
      const alias = join(dir, 'alias.sqlite');
      symlinkSync(unrelated, alias);
      assert.throws(() => new journals.BatchJournal(alias), /JOURNAL_UNSAFE_FILE/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('a corrupted diagnostic receipt cannot be replayed merely by refreshing the outer checksum', async () => {
  const d = database();
  try {
    const b = await batches.captureReferenceBatch(policy(), transport({ halted: true }), () => time);
    d.journal.append(b);
    b.captures[1]!.sources[0]!.body = '{"assets":[]}';
    const db = new DatabaseSync(d.path);
    try {
      db.exec('DROP TRIGGER immutable_batch_update');
      const payload = JSON.stringify(b);
      db.prepare('UPDATE reference_batches SET payload=?,sha256=? WHERE id=1').run(
        payload,
        createHash('sha256').update(payload).digest('hex'),
      );
    } finally {
      db.close();
    }
    assert.throws(() => d.journal.read(1), /SOURCE_INTEGRITY_FAILED/);
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test(
  'batch CLI rejects named pipes before opening input or touching its journal',
  { skip: process.platform === 'win32' },
  () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-batch-fifo-')));
    try {
      const path = join(dir, 'input.fifo'),
        db = join(dir, 'must-not-create.sqlite');
      const made = spawnSync('mkfifo', [path], { encoding: 'utf8', timeout: 2000 });
      assert.equal(made.status, 0, made.stderr);
      const cli = fileURLToPath(new URL('../tools/automata/collect-portfolio-market.ts', import.meta.url));
      const child = spawnSync(process.execPath, [cli, path, db], { encoding: 'utf8', timeout: 2000 });
      assert.equal(child.status, 2);
      assert.equal(existsSync(db), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('invalid database application identities cannot create or mutate a journal', async () => {
  const { openJournalDatabase } = await import('../packages/market-data/src/journal-db.ts');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-batch-identity-')));
  try {
    const path = join(dir, 'must-not-create.sqlite');
    assert.throws(() => openJournalDatabase(path, 0), /INVALID_JOURNAL_APPLICATION_ID/);
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
