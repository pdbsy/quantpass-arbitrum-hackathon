import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collectReferences } from '../packages/market-data/src/continuous.ts';
import { MarketJournal } from '../packages/market-data/src/capture.ts';
import type { ReadTransport } from '../packages/market-data/src/capture.ts';
const address = '0x' + '12'.repeat(20);
const now = Date.parse('2026-09-30T01:00:00Z');
const asset = {
  id: '0x' + 'ab'.repeat(32),
  tokenSymbol: 'AAPL',
  tokenDecimals: 18,
  status: 'ASSET_STATUS_ACTIVE',
  currentMultiplier: '1',
  pendingMultiplier: '',
  deployments: [{ chainId: 4663, contractAddress: address }],
};
const quote = {
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
const config = () => ({
  selection: { chainId: 4663, contractAddress: address, symbol: 'AAPL' },
  maxAgeMs: 30000,
  intervalMs: 1,
  maxCaptures: 2,
  maxConsecutiveRejections: 2,
});
const transport: ReadTransport = async (url, init) => {
  assert.equal(init.method, 'GET');
  return new Response(JSON.stringify(url.endsWith('/assets') ? { assets: [asset] } : quote));
};
function database() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-collector-')));
  const path = join(dir, 'observations.sqlite');
  return { dir, path, journal: new MarketJournal(path) };
}
test('sequential captures remain replayable with stable IDs after a worker restart', async () => {
  const d = database();
  try {
    const first = await collectReferences(config(), d.journal, transport, () => now);
    assert.deepEqual(first, {
      status: 'COMPLETED',
      reason: null,
      captures: 2,
      accepted: 2,
      rejected: 0,
      lastCaptureId: 2,
    });
    assert.equal(d.journal.read(2).observation?.tokenBidUsd18, '100000000000000000000');
    d.journal.close();
    d.journal = new MarketJournal(d.path);
    const second = await collectReferences({ ...config(), maxCaptures: 1 }, d.journal, transport, () => now);
    assert.equal(second.lastCaptureId, 3);
    assert.equal(d.journal.read(1).observation?.identity, '4663:' + address);
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('rejected observations are durable and the explicit consecutive rejection limit stops collection', async () => {
  const d = database();
  try {
    const result = await collectReferences(
      { ...config(), maxCaptures: null },
      d.journal,
      async () => new Response('', { status: 503 }),
      () => now,
    );
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.captures, 2);
    assert.equal(result.accepted, 0);
    assert.equal(result.rejected, 2);
    assert.equal(d.journal.read(2).status, 'REJECTED');
    assert.throws(() => d.journal.read(3));
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('an accepted sample resets the consecutive rejection counter', async () => {
  const d = database();
  let step = 0;
  try {
    const reply: ReadTransport = async (url, init) => {
      step++;
      if (step === 1 || step === 5) return new Response('', { status: 503 });
      return transport(url, init);
    };
    const result = await collectReferences({ ...config(), maxCaptures: 4 }, d.journal, reply, () => now);
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.captures, 4);
    assert.equal(result.accepted, 2);
    assert.equal(result.rejected, 2);
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('access denial stops immediately even when the operator allows many ordinary rejections', async () => {
  const d = database();
  try {
    const result = await collectReferences(
      { ...config(), maxCaptures: null, maxConsecutiveRejections: 10 },
      d.journal,
      async () => new Response('', { status: 403 }),
      () => now,
    );
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reason, 'HTTP_ACCESS_DENIED');
    assert.equal(result.captures, 1);
    assert.throws(() => d.journal.read(2));
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('an already cancelled worker does not fetch or append', async () => {
  const d = database();
  const c = new AbortController();
  c.abort();
  try {
    const result = await collectReferences(
      config(),
      d.journal,
      async () => {
        throw new Error('must not fetch');
      },
      () => now,
      c.signal,
    );
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.captures, 0);
    assert.throws(() => d.journal.read(1));
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test(
  'cancelling an uncooperative request returns with a durable rejected diagnostic',
  { timeout: 1000 },
  async () => {
    const d = database();
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 10);
    try {
      const result = await collectReferences(
        config(),
        d.journal,
        () => new Promise(() => {}),
        () => now,
        c.signal,
      );
      assert.equal(result.status, 'STOPPED');
      assert.equal(result.captures, 1);
      assert.equal(d.journal.read(1).reason, 'CAPTURE_ABORTED');
    } finally {
      clearTimeout(timer);
      d.journal.close();
      rmSync(d.dir, { recursive: true, force: true });
    }
  },
);
test('cancellation during the configured interval prevents the next capture', async () => {
  const d = database();
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 30);
  try {
    const result = await collectReferences(
      { ...config(), maxCaptures: null, intervalMs: 10000 },
      d.journal,
      transport,
      () => now,
      c.signal,
    );
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.captures, 1);
    assert.equal(result.accepted, 1);
  } finally {
    clearTimeout(timer);
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('operator input is snapshotted before asynchronous network work', async () => {
  const d = database();
  const c = config();
  try {
    const result = await collectReferences(
      c,
      d.journal,
      async (url, init) => {
        c.selection.symbol = 'MSFT';
        c.maxCaptures = 1;
        return transport(url, init);
      },
      () => now,
    );
    assert.equal(result.captures, 2);
    assert.equal(d.journal.read(2).selection.symbol, 'AAPL');
  } finally {
    d.journal.close();
    rmSync(d.dir, { recursive: true, force: true });
  }
});
test('journal failure terminates without reporting an uncommitted capture as progress', async () => {
  const result = await collectReferences(
    config(),
    {
      append() {
        throw new Error('private database detail');
      },
    },
    transport,
    () => now,
  );
  assert.equal(result.status, 'FAILED');
  assert.equal(result.reason, 'JOURNAL_APPEND_FAILED');
  assert.equal(result.captures, 0);
  assert.equal(result.lastCaptureId, null);
  assert.ok(!JSON.stringify(result).includes('private database detail'));
});
test('invalid or incomplete configuration fails before database and network work', async () => {
  for (const invalid of [
    null,
    {},
    { ...config(), intervalMs: 0 },
    { ...config(), intervalMs: 2147483648 },
    { ...config(), maxCaptures: 0 },
    { ...config(), maxAgeMs: 0 },
    { ...config(), maxConsecutiveRejections: 0 },
    { ...config(), extra: 'secret' },
    { ...config(), selection: { ...config().selection, extra: 'secret' } },
  ]) {
    await assert.rejects(
      collectReferences(
        invalid,
        {
          append() {
            throw new Error('unexpected append');
          },
        },
        async () => {
          throw new Error('unexpected fetch');
        },
        () => now,
      ),
      /INVALID_/,
    );
  }
});
test('collection CLI help and invalid policy run offline without creating a journal', () => {
  const cli = fileURLToPath(new URL('../tools/automata/collect-market.ts', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /REFERENCE_ONLY/);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-collector-cli-')));
  try {
    const p = join(dir, 'invalid.json');
    writeFileSync(p, JSON.stringify({ ...config(), intervalMs: 0 }));
    const bad = spawnSync(process.execPath, [cli, p, join(dir, 'must-not-create.sqlite')], {
      encoding: 'utf8',
      timeout: 3000,
    });
    assert.equal(bad.status, 2);
    assert.equal(existsSync(join(dir, 'must-not-create.sqlite')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI collects and reopens its actual journal using only official reference GETs', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-collector-cli-')));
  try {
    const input = join(dir, 'config.json'),
      path = join(dir, 'observations.sqlite');
    writeFileSync(input, JSON.stringify(config()));
    const cli = new URL('../tools/automata/collect-market.ts', import.meta.url).href;
    const script = `const asset=${JSON.stringify(asset)};const quote=${JSON.stringify(quote)};quote.quotes[0].generatedAt=new Date().toISOString();
    globalThis.fetch=async(url,init)=>{if(init.method!=='GET'||!['https://api.robinhood.com/rhj/assets','https://api.robinhood.com/rhj/prices/AAPL'].includes(url))throw new Error('unexpected request');return new Response(JSON.stringify(url.endsWith('/assets')?{assets:[asset]}:quote));};
    process.argv=[process.execPath,${JSON.stringify(cli)},${JSON.stringify(input)},${JSON.stringify(path)}];await import(${JSON.stringify(cli)});`;
    const first = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).lastCaptureId, 2);
    const second = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).lastCaptureId, 4);
    const journal = new MarketJournal(path);
    try {
      assert.equal(journal.read(4).observation?.tokenAskUsd18, '101000000000000000000');
    } finally {
      journal.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('CLI SIGTERM handling preserves the cancelled attempt and closes the journal', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-collector-cli-stop-')));
  try {
    const input = join(dir, 'config.json'),
      path = join(dir, 'observations.sqlite');
    writeFileSync(input, JSON.stringify({ ...config(), maxCaptures: null }));
    const cli = new URL('../tools/automata/collect-market.ts', import.meta.url).href;
    const script = `globalThis.fetch=async()=>{process.emit('SIGTERM');return new Promise(()=>{});};process.argv=[process.execPath,${JSON.stringify(cli)},${JSON.stringify(input)},${JSON.stringify(path)}];await import(${JSON.stringify(cli)});`;
    const stopped = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(stopped.status, 143, stopped.stderr);
    assert.equal(JSON.parse(stopped.stdout).status, 'STOPPED');
    const journal = new MarketJournal(path);
    try {
      assert.equal(journal.read(1).reason, 'CAPTURE_ABORTED');
    } finally {
      journal.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'CLI rejects a named pipe before opening it or creating a journal',
  { skip: process.platform === 'win32' },
  () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-collector-fifo-')));
    try {
      const fifo = join(dir, 'input.fifo'),
        db = join(dir, 'must-not-create.sqlite');
      const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 2000 });
      assert.equal(made.status, 0, made.stderr);
      const cli = fileURLToPath(new URL('../tools/automata/collect-market.ts', import.meta.url));
      const result = spawnSync(process.execPath, [cli, fifo, db], { encoding: 'utf8', timeout: 2000 });
      assert.equal(result.status, 2);
      assert.equal(existsSync(db), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
