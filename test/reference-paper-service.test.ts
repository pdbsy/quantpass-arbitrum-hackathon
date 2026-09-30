import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BatchJournal } from '../packages/market-data/src/batch-journal.ts';
import { PaperJournal } from '../packages/automata/src/reference-paper-journal.ts';
import { collectReferenceBatches } from '../packages/market-data/src/batch-continuous.ts';
import { fixtureConfig, fixtureBatch, fixtureTransport } from './helpers/reference-paper.ts';
const at = Date.parse('2026-09-30T01:00:50Z');
const closers = new WeakMap<object, (() => void | Promise<void>)[]>();
function cleanup(t: object, fn: () => void | Promise<void>) {
  closers.get(t)!.push(fn);
}
function dir(t: { after: (fn: () => void) => void }) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'af-paper-service-')));
  closers.set(t, []);
  t.after(async () => {
    for (const close of closers.get(t)!.reverse()) await close();
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}
test('diagnostic collection persists rejected rounds then recovers; access denial remains terminal', async () => {
  let calls = 0;
  const config = { ...fixtureConfig().market, intervalMs: 1, maxBatches: 2, maxConsecutiveRejections: null };
  const result = await collectReferenceBatches(
    config,
    { append: () => ++calls },
    fixtureTransport(() => at, { halted: true }),
    () => at,
  );
  assert.equal(result.batches, 2);
  assert.equal(result.rejected, 2);
  assert.equal(result.status, 'COMPLETED');
  calls = 0;
  const denied = await collectReferenceBatches(
    config,
    { append: () => ++calls },
    fixtureTransport(() => at, { denied: true }),
    () => at,
  );
  assert.equal(denied.reason, 'HTTP_ACCESS_DENIED');
  assert.equal(calls, 1);
});
test('bound controls survive reopen and a retry cannot fund twice or change its body', async (t) => {
  const root = dir(t),
    source = new BatchJournal(join(root, 'source.sqlite'));
  cleanup(t, () => source.close());
  const id = source.append(await fixtureBatch(at));
  let journal = new PaperJournal(join(root, 'paper.sqlite'), fixtureConfig(), source, { owner: 'alice' });
  journal.consume(source.entry(id));
  const request = {
    id: 'fund-1',
    expectedRevision: 1,
    action: { type: 'fund' as const, direction: 'in' as const, amount6: '1000000' },
  };
  const receipt = journal.control(request, at);
  assert.equal(receipt.replayed, false);
  assert.equal(journal.snapshot().state.cash6, '1001000000');
  journal.close();
  assert.throws(
    () => new PaperJournal(join(root, 'paper.sqlite'), fixtureConfig(), source, { owner: 'bob' }),
    /PAPER_OWNER_MISMATCH/,
  );
  assert.throws(
    () => new PaperJournal(join(root, 'paper.sqlite'), fixtureConfig(), source),
    /PAPER_OWNER_MISMATCH/,
  );
  journal = new PaperJournal(join(root, 'paper.sqlite'), fixtureConfig(), source, { owner: 'alice' });
  cleanup(t, () => journal.close());
  assert.equal(journal.control(request, at + 1).replayed, true);
  assert.equal(journal.snapshot().revision, 2);
  assert.equal(journal.snapshot().state.cash6, '1001000000');
  assert.throws(
    () => journal.control({ ...request, action: { ...request.action, amount6: '2000000' } }, at + 1),
    /PAPER_CONTROL_CONFLICT/,
  );
  assert.throws(() => journal.control({ ...request, id: 'fund-2' }, at + 1), /PAPER_REVISION_CONFLICT/);
  assert.equal(journal.history(undefined, 1).items[0]!.revision, 2);
  assert.equal(journal.history(undefined, 1).nextBefore, 2);
  assert.equal(journal.history(2, 1).items[0]!.revision, 1);
});
test('paired SQLite snapshots reopen with identical verified state', async (t) => {
  const root = dir(t),
    source = new BatchJournal(join(root, 'source.sqlite'));
  const id = source.append(await fixtureBatch(at));
  const journal = new PaperJournal(join(root, 'paper.sqlite'), fixtureConfig(), source, { owner: 'alice' });
  journal.consume(source.entry(id));
  journal.stop(at);
  const expected = journal.snapshot();
  await source.backupTo(join(root, 'source-copy.sqlite'));
  await journal.backupTo(join(root, 'paper-copy.sqlite'));
  journal.close();
  source.close();
  const copy = new BatchJournal(join(root, 'source-copy.sqlite'));
  const restored = new PaperJournal(join(root, 'paper-copy.sqlite'), fixtureConfig(), copy, {
    owner: 'alice',
  });
  assert.deepEqual(restored.snapshot(), expected);
  assert.equal(restored.snapshot().state.status, 'stopped');
  restored.close();
  copy.close();
});

import { ReferencePaperService } from '../packages/automata/src/reference-paper-service.ts';
import { writeFileSync, existsSync, symlinkSync } from 'node:fs';
function serviceConfig() {
  return {
    version: 'alphaforge-reference-paper-service-1',
    sourceMode: 'OFFLINE_FIXTURE',
    owner: 'alice',
    paper: fixtureConfig(),
    intervalMs: 5000,
    maxBytes: 100 * 1024 * 1024,
    backupIntervalMs: null,
  };
}
test('runtime pauses on invalid data, resumes without invented minutes and retains stop after restart', async (t) => {
  const root = dir(t);
  let now = at,
    halted = true;
  const read: Parameters<typeof fixtureTransport>[0] = () => now;
  const transport: import('../packages/market-data/src/capture.ts').ReadTransport = (url, init) =>
    fixtureTransport(read, { halted })(url, init);
  let runtime = new ReferencePaperService(root, serviceConfig(), { transport, now: read });
  await runtime.cycle();
  assert.equal(runtime.view('alice').health.phase, 'data_paused');
  halted = false;
  now += 5000;
  await runtime.cycle();
  assert.equal(runtime.view('alice').health.phase, 'warming_up');
  assert.equal(runtime.view('alice').warmup.validMinutes, 0);
  assert.throws(() => runtime.view('bob'), /PAPER_NOT_FOUND/);
  const view = runtime.view('alice');
  await runtime.control('alice', { id: 'stop-1', expectedRevision: view.revision, action: { type: 'stop' } });
  await runtime.close();
  runtime = new ReferencePaperService(root, serviceConfig(), { transport, now: read });
  assert.equal(runtime.view('alice').account.status, 'stopped');
  now += 5000;
  await runtime.cycle();
  assert.equal(runtime.view('alice').account.status, 'stopped');
  await runtime.close();
});
test('runtime catches up a committed source row once after an interrupted consumer', async (t) => {
  const root = dir(t);
  let runtime = new ReferencePaperService(root, serviceConfig(), {
    transport: fixtureTransport(() => at),
    now: () => at,
  });
  await runtime.cycle();
  await runtime.close();
  const source = new BatchJournal(join(root, 'source.sqlite'));
  source.append(await fixtureBatch(at + 5000));
  source.close();
  runtime = new ReferencePaperService(root, serviceConfig(), {
    transport: fixtureTransport(() => at + 5000),
    now: () => at + 5000,
  });
  assert.equal(runtime.view('alice').cursor, 2);
  assert.equal(runtime.view('alice').revision, 2);
  await runtime.close();
});
test('lease excludes a concurrent runtime; storage cap keeps history; paired backup is verified and deduplicated', async (t) => {
  const root = dir(t),
    config = serviceConfig();
  const runtime = new ReferencePaperService(root, config, {
    transport: fixtureTransport(() => at),
    now: () => at,
  });
  assert.throws(
    () => new ReferencePaperService(root, config, { transport: fixtureTransport(() => at) }),
    /PAPER_SERVICE_BUSY/,
  );
  await runtime.cycle();
  const b = await runtime.backup('alice', 'backup-1');
  assert.equal(b.verified, true);
  assert.equal((await runtime.backup('alice', 'backup-1')).replayed, true);
  const snapshot = runtime.view('alice');
  assert.equal(snapshot.backups.length, 1);
  assert.ok(snapshot.storage.usedBytes > 0);
  await runtime.close();
  assert.throws(
    () =>
      new ReferencePaperService(root, { ...config, owner: 'bob' }, { transport: fixtureTransport(() => at) }),
    /PAPER_SERVICE_CONFIG_MISMATCH/,
  );
  const bounded = new ReferencePaperService(
    root,
    { ...config, maxBytes: 1024 * 1024 },
    { transport: fixtureTransport(() => at + 5000), now: () => at + 5000 },
  );
  await bounded.cycle();
  assert.equal(bounded.view('alice').health.phase, 'blocked');
  assert.equal(bounded.view('alice').health.reason, 'PAPER_STORAGE_LIMIT');
  assert.equal(bounded.view('alice').cursor, snapshot.cursor);
  await bounded.close();
});
test('denied access stops future capture and lease refuses linked data trees', async (t) => {
  const root = dir(t);
  let calls = 0;
  const runtime = new ReferencePaperService(root, serviceConfig(), {
    transport: async () => {
      calls++;
      return new Response('', { status: 403 });
    },
    now: () => at,
  });
  await runtime.cycle();
  const count = calls;
  await runtime.cycle();
  assert.equal(calls, count);
  assert.equal(runtime.view('alice').health.reason, 'HTTP_ACCESS_DENIED');
  await runtime.close();
  const other = dir(t);
  symlinkSync(other, join(root, 'unsafe'));
  assert.throws(
    () => new ReferencePaperService(root, serviceConfig(), { transport: fixtureTransport(() => at) }),
    /PAPER_STORAGE_UNSAFE/,
  );
});

import { buildApp } from '../apps/server/src/app.ts';
test('paper API keeps owner, session and mutation boundaries and returns durable receipts', async (t) => {
  const root = dir(t),
    runtime = new ReferencePaperService(root, serviceConfig(), {
      transport: fixtureTransport(() => at),
      now: () => at,
    });
  await runtime.cycle();
  const { app } = await buildApp({
    dbPath: join(root, 'demo.sqlite'),
    env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
    origin: 'http://127.0.0.1:4182',
    referencePaper: runtime,
    referencePaperOnly: true,
  });
  cleanup(t, async () => {
    await app.close();
    await runtime.close();
  });
  const request = (
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
    cookie?: string,
    extra: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      headers: {
        host: '127.0.0.1:4182',
        'x-quantpass-demo': '1',
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...extra,
      },
    });
  assert.equal((await request('GET', '/api/v1/reference-paper')).statusCode, 401);
  const login = async (user: string) => {
    const r = await request('POST', '/api/demo/session', { user });
    assert.equal(r.statusCode, 200, r.body);
    return String(r.headers['set-cookie']).split(';')[0]!;
  };
  const bob = await login('bob');
  assert.equal((await request('GET', '/api/v1/reference-paper', undefined, bob)).statusCode, 404);
  const alice = await login('alice');
  assert.match(alice, /^af_reference_paper_4182=/);
  assert.equal((await request('GET', '/api/strategies', undefined, alice)).statusCode, 404);
  const view = (await request('GET', '/api/v1/reference-paper', undefined, alice)).json();
  const command = {
    id: 'api-fund-1',
    expectedRevision: view.revision,
    action: { type: 'fund', direction: 'in', amount6: '1000000' },
  };
  assert.equal(
    (await request('POST', '/api/v1/reference-paper/controls', { ...command, bypass: true }, alice))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await request('POST', '/api/v1/reference-paper/controls', command, alice, {
        origin: 'https://elsewhere.invalid',
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await request('POST', '/api/v1/reference-paper/controls', command, alice, { 'x-quantpass-demo': '0' }))
      .statusCode,
    403,
  );
  const receipt = await request('POST', '/api/v1/reference-paper/controls', command, alice);
  assert.equal(receipt.statusCode, 200);
  assert.equal(receipt.json().replayed, false);
  assert.equal(
    (await request('POST', '/api/v1/reference-paper/controls', command, alice)).json().replayed,
    true,
  );
  assert.equal(
    (
      await request(
        'POST',
        '/api/v1/reference-paper/controls',
        { ...command, action: { ...command.action, amount6: '2000000' } },
        alice,
      )
    ).statusCode,
    409,
  );
  const tooMuch = {
    id: 'api-out-1',
    expectedRevision: runtime.view('alice').revision,
    action: { type: 'fund', direction: 'out', amount6: '1002000000' },
  };
  const failed = await request('POST', '/api/v1/reference-paper/controls', tooMuch, alice);
  assert.equal(failed.statusCode, 409);
  assert.equal(failed.json().maxWithdraw6, '1001000000');
  const stop = {
    id: 'api-stop-1',
    expectedRevision: runtime.view('alice').revision,
    action: { type: 'stop' },
  };
  assert.equal((await request('POST', '/api/v1/reference-paper/controls', stop, alice)).statusCode, 200);
  assert.equal(
    (await request('GET', '/api/v1/reference-paper', undefined, alice)).json().account.status,
    'stopped',
  );
  const backup = await request('POST', '/api/v1/reference-paper/backups', { id: 'api-backup-1' }, alice);
  assert.equal(backup.statusCode, 200);
  assert.equal(backup.json().verified, true);
  assert.equal(
    (await request('GET', '/api/v1/reference-paper/history?limit=0', undefined, alice)).statusCode,
    400,
  );
  assert.equal(
    (await request('GET', '/api/v1/reference-paper/history?limit=1', undefined, alice)).json().items.length,
    1,
  );
});

import {
  fundingAmount6,
  formatPaperAmount,
  returnPercent,
  paperChartPoints,
  PaperOutbox,
} from '../apps/web/src/reference-paper-client.ts';
test('paper client preserves decimal precision, breaks charts on unavailable input and retries one durable command', async () => {
  assert.equal(fundingAmount6('0.000001'), '1');
  assert.equal(fundingAmount6('1000.123456'), '1000123456');
  assert.throws(() => fundingAmount6('1.0000001'));
  assert.equal(formatPaperAmount('1000123456', 6), '1,000.123456');
  assert.equal(returnPercent({ numerator: '1001', denominator: '1000' }), '0.10%');
  const points = paperChartPoints([
    { revision: 2, events: [{ kind: 'REFERENCE_REJECTED', at: 20, reason: 'STALE' }] },
    { revision: 1, events: [{ kind: 'NAV', at: 10, unitValue: { numerator: '1', denominator: '1' } }] },
  ]);
  assert.equal(points[0]!.value, 0);
  assert.equal(points[1]!.value, null);
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const requests: unknown[] = [];
  let failed = true;
  const transport: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    if (failed) {
      failed = false;
      throw new Error('offline');
    }
    return new Response(JSON.stringify({ revision: 2, replayed: true }));
  };
  const box = new PaperOutbox(storage, 'account-alice', transport, () => 'command-1');
  await assert.rejects(() => box.send({ type: 'fund', direction: 'in', amount6: '1000000' }, 1));
  assert.ok(box.pending());
  const restarted = new PaperOutbox(storage, 'account-alice', transport, () => 'command-2');
  await restarted.retry();
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(restarted.pending(), null);
  assert.equal(new PaperOutbox(storage, 'another-account', transport).pending(), null);
});

test('stale view can request monotonic stop, but cannot silently rebase funding', async (t) => {
  const root = dir(t),
    source = new BatchJournal(join(root, 'source.sqlite'));
  source.append(await fixtureBatch(at));
  const journal = new PaperJournal(join(root, 'paper.sqlite'), fixtureConfig(), source, { owner: 'alice' });
  cleanup(t, () => {
    journal.close();
    source.close();
  });
  journal.consume(source.entry(1));
  assert.throws(
    () =>
      journal.control(
        { id: 'stale-fund', expectedRevision: 0, action: { type: 'fund', direction: 'in', amount6: '1' } },
        at,
      ),
    /PAPER_REVISION_CONFLICT/,
  );
  journal.control({ id: 'monotonic-stop', expectedRevision: 0, action: { type: 'stop' } }, at);
  assert.equal(journal.snapshot().state.status, 'stopped');
});
test('owner stop cancels an in-flight uncooperative quote request and stays latched', async (t) => {
  const root = dir(t);
  let block = false,
    calls = 0,
    wake: () => void = () => {};
  const started = new Promise<void>((r) => {
    wake = r;
  });
  const runtime = new ReferencePaperService(root, serviceConfig(), {
    now: () => at,
    transport: (url, init) => {
      calls++;
      if (block) {
        wake();
        return new Promise(() => {});
      }
      return fixtureTransport(() => at)(url, init);
    },
  });
  cleanup(t, () => runtime.close());
  await runtime.cycle();
  block = true;
  const collecting = runtime.cycle();
  await started;
  const stop = runtime.control('alice', {
    id: 'interrupt-stop',
    expectedRevision: 1,
    action: { type: 'stop' },
  });
  await Promise.race([
    Promise.all([collecting, stop]),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('STOP_DID_NOT_INTERRUPT_CAPTURE')), 1500);
      timer.unref();
    }),
  ]);
  assert.ok(calls > 0);
  assert.equal(runtime.view('alice').account.status, 'stopped');
});
test('daily backup schedule is exercised with a clock jump; restore and residual liquidation keep original strategy state', async (t) => {
  const root = dir(t);
  let now = at,
    price = '100';
  let runtime = new ReferencePaperService(
    root,
    { ...serviceConfig(), backupIntervalMs: 86400000 },
    { now: () => now, transport: (url, init) => fixtureTransport(() => now, { price })(url, init) },
  );
  for (let i = 0; i <= 35; i++) {
    now = at + i * 60000;
    price = String(100 + i);
    await runtime.cycle();
  }
  const bought = runtime.view('alice');
  assert.equal(bought.warmup.validMinutes, 30);
  assert.equal(bought.account.fills, 3);
  now += 86400000;
  await runtime.cycle();
  for (let attempt = 0; attempt < 300 && runtime.view('alice').backups.length === 0; attempt++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(runtime.view('alice').backups.length, 1);
  now += 31000;
  assert.equal(runtime.view('alice').nav6, null);
  await runtime.control('alice', { id: 'stale-liquidate', expectedRevision: 0, action: { type: 'stop' } });
  assert.equal(runtime.view('alice').account.status, 'liquidating');
  const closed = bought.account.closedMinutes;
  await runtime.close();
  runtime = new ReferencePaperService(
    root,
    { ...serviceConfig(), backupIntervalMs: 86400000 },
    { now: () => now, transport: (url, init) => fixtureTransport(() => now, { price })(url, init) },
  );
  await runtime.cycle();
  assert.equal(runtime.view('alice').account.status, 'stopped');
  assert.equal(runtime.view('alice').account.fills, 6);
  assert.ok(runtime.view('alice').account.closedMinutes >= closed);
  await runtime.close();
});

import { spawnSync } from 'node:child_process';
test('a dead process lease is recovered, while an invalid CLI stays offline and creates no data', async (t) => {
  const root = dir(t);
  const child = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.ok(child.pid);
  writeFileSync(join(root, 'service.lock'), JSON.stringify({ pid: child.pid, token: 'dead-process' }));
  const runtime = new ReferencePaperService(root, serviceConfig(), {
    transport: fixtureTransport(() => at),
    now: () => at,
  });
  await runtime.cycle();
  await runtime.close();
  const help = spawnSync(process.execPath, ['tools/automata/reference-paper-service.ts', '--help'], {
    encoding: 'utf8',
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /no signing/);
  const file = join(root, 'invalid-config.json');
  writeFileSync(file, JSON.stringify(serviceConfig()));
  const destination = join(root, 'must-not-create');
  const invalid = spawnSync(
    process.execPath,
    [
      '--env-file=.env.example',
      'tools/automata/reference-paper-service.ts',
      'serve',
      file,
      destination,
      '4183',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /PAPER_FIXTURE_CLI_CLOSED/);
  assert.equal(existsSync(destination), false);
});
test('definitive rejection clears outbox; uncertain server failure keeps the original request', async () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    };
  let status = 500;
  const transport: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: { code: status === 500 ? 'PAPER_SERVICE_FAILED' : 'PAPER_REVISION_CONFLICT' },
      }),
      { status },
    );
  const box = new PaperOutbox(storage, 'retry-account', transport, () => 'retry-id');
  await assert.rejects(() => box.send({ type: 'fund', direction: 'in', amount6: '1' }, 1));
  assert.ok(box.pending());
  status = 409;
  await assert.rejects(() => box.retry());
  assert.equal(box.pending(), null);
});

import { validateReferenceBatch } from '../packages/market-data/src/batch.ts';
test('batch validation returns recomputed observations and refuses fabricated projections', async () => {
  const batch = await fixtureBatch(at);
  const verified = validateReferenceBatch(batch);
  assert.deepEqual(verified, batch.observations);
  assert.notEqual(verified, batch.observations);
  const changed = structuredClone(batch);
  changed.observations![0]!.tokenBidUsd18 = '1';
  assert.throws(() => validateReferenceBatch(changed), /BATCH_OBSERVATION_MISMATCH/);
  assert.equal(validateReferenceBatch(await fixtureBatch(at, { halted: true })), null);
});

import { paperRequest } from '../apps/web/src/reference-paper-client.ts';
test('an uncooperative page request times out and aborts instead of showing an indefinitely fresh page', async () => {
  let signal: AbortSignal | undefined;
  const transport: typeof fetch = async (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Promise(() => {});
  };
  await assert.rejects(
    () => paperRequest('/api/v1/reference-paper', undefined, transport, 10),
    /页面请求超时/,
  );
  assert.equal(signal?.aborted, true);
});

test('owner stop latches during a pending backup and cancels its obsolete snapshot', async (t) => {
  const root = dir(t),
    runtime = new ReferencePaperService(root, serviceConfig(), {
      transport: fixtureTransport(() => at),
      now: () => at,
    });
  await runtime.cycle();
  const original = BatchJournal.prototype.backupTo;
  let release: () => void = () => {},
    started: () => void = () => {};
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    entered = new Promise<void>((r) => {
      started = r;
    });
  BatchJournal.prototype.backupTo = async function (path: string) {
    started();
    await gate;
    return original.call(this, path);
  };
  let backup: Promise<unknown> | undefined, stop: Promise<unknown> | undefined;
  try {
    backup = runtime.backup('alice', 'priority-backup');
    void backup.catch(() => {});
    await entered;
    let completed = false;
    stop = runtime
      .control('alice', { id: 'priority-stop', expectedRevision: 0, action: { type: 'stop' } })
      .then(() => {
        completed = true;
      });
    await new Promise<void>((r) => setImmediate(r));
    assert.equal(completed, true, 'stop must not queue behind backup I/O');
    assert.equal(runtime.view('alice').account.status, 'stopped');
  } finally {
    release();
    await Promise.allSettled([backup, stop]);
    BatchJournal.prototype.backupTo = original;
    await runtime.close();
  }
  const restored = new ReferencePaperService(root, serviceConfig(), {
    transport: fixtureTransport(() => at),
    now: () => at,
  });
  assert.equal(restored.view('alice').account.status, 'stopped');
  assert.equal(restored.view('alice').backups.length, 0);
  await restored.close();
});

test('sparse fills stay visible after more than a hundred price-only rounds', async (t) => {
  const root = dir(t),
    source = new BatchJournal(join(root, 'source.sqlite'));
  source.append(await fixtureBatch(at));
  const journal = new PaperJournal(join(root, 'paper.sqlite'), fixtureConfig(), source, { owner: 'alice' });
  cleanup(t, () => {
    journal.close();
    source.close();
  });
  journal.consume(source.entry(1));
  for (let i = 1; i <= 140; i++) {
    const id = source.append(await fixtureBatch(at + i * 60000, { price: String(100 + Math.min(i, 35)) }));
    journal.consume(source.entry(id));
  }
  assert.equal(journal.snapshot().state.fills, 3);
  assert.equal(
    journal.history().items.some((row) => row.events.some((e) => e.kind === 'FILL')),
    false,
  );
  assert.equal(journal.fills().flatMap((row) => row.events).length, 3);
});

import { cpSync } from 'node:fs';
test('new backup bundles preserve account binding when restored into a separate directory', async (t) => {
  const root = dir(t),
    config = serviceConfig(),
    runtime = new ReferencePaperService(root, config, {
      transport: fixtureTransport(() => at),
      now: () => at,
    });
  await runtime.cycle();
  const expected = runtime.view('alice');
  await runtime.backup('alice', 'binding-bundle');
  const target = dir(t);
  cpSync(join(root, 'backups', 'binding-bundle'), target, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  const restored = new ReferencePaperService(target, config, {
    transport: fixtureTransport(() => at),
    now: () => at,
  });
  assert.equal(restored.view('alice').accountId, expected.accountId);
  assert.deepEqual(restored.view('alice').account, expected.account);
  await restored.close();
  await runtime.close();
});
test('deferred replay exposes no unverified balance and yields between verified steps', async (t) => {
  const root = dir(t),
    source = new BatchJournal(join(root, 'source.sqlite'));
  source.append(await fixtureBatch(at));
  let journal = new PaperJournal(join(root, 'paper.sqlite'), fixtureConfig(), source, { owner: 'alice' });
  for (let i = 0; i < 4; i++) {
    if (i) source.append(await fixtureBatch(at + i * 5000));
    journal.consume(source.entry(i + 1));
  }
  const expected = journal.snapshot();
  journal.close();
  journal = new PaperJournal(join(root, 'paper.sqlite'), fixtureConfig(), source, {
    owner: 'alice',
    deferReplay: true,
  });
  assert.throws(() => journal.snapshot(), /PAPER_REPLAY_REQUIRED/);
  const cancel = new AbortController();
  setImmediate(() => cancel.abort());
  await assert.rejects(() => journal.replayAsync(cancel.signal), /PAPER_REPLAY_CANCELLED/);
  assert.throws(() => journal.snapshot(), /PAPER_REPLAY_REQUIRED/);
  await journal.replayAsync(new AbortController().signal);
  assert.deepEqual(journal.snapshot(), expected);
  journal.close();
  source.close();
});
test('consistent backup verification runs without blocking subsequent collection or owner stop', async (t) => {
  const root = dir(t);
  let now = at;
  const runtime = new ReferencePaperService(root, serviceConfig(), {
    transport: fixtureTransport(() => now),
    now: () => now,
  });
  await runtime.cycle();
  const original = PaperJournal.prototype.replayAsync;
  let release: () => void = () => {},
    start: () => void = () => {};
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    entered = new Promise<void>((r) => {
      start = r;
    });
  PaperJournal.prototype.replayAsync = async function (signal: AbortSignal) {
    start();
    await gate;
    return original.call(this, signal);
  };
  let job: Promise<unknown> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    job = runtime.backup('alice', 'async-bundle');
    void job.catch(() => {});
    await Promise.race([
      entered,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('ASYNC_VERIFICATION_MISSING')), 1500);
      }),
    ]);
    clearTimeout(deadline);
    now += 5000;
    await runtime.cycle();
    assert.equal(runtime.view('alice').cursor, 2);
    await runtime.control('alice', {
      id: 'stop-during-verification',
      expectedRevision: 0,
      action: { type: 'stop' },
    });
    assert.equal(runtime.view('alice').account.status, 'stopped');
    release();
    await job;
    assert.equal(runtime.view('alice').backups.length, 1);
  } finally {
    clearTimeout(deadline);
    release();
    await Promise.allSettled([job]);
    PaperJournal.prototype.replayAsync = original;
    await runtime.close();
  }
});
