import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePinnedState } from '../packages/market-data/src/pinned-rpc.ts';
import type { RpcTransport, RpcRequest } from '../packages/chain-adapter/src/rpc.ts';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const hash = '0x' + 'ab'.repeat(32);
const parentHash = '0x' + 'cd'.repeat(32);
const address = '0x' + '12'.repeat(20);
const now = 1800000000000;
const request = () => ({
  chainId: 4663,
  block: { number: '100', hash },
  contracts: [{ address, calls: [{ id: 'decimals', data: '0x313ce567' }] }],
});
function provider(change: (request: RpcRequest, value: unknown) => unknown = (_r, v) => v) {
  const seen: RpcRequest[] = [];
  const transport: RpcTransport = async (_endpoint, r) => {
    seen.push(structuredClone(r));
    const values: Record<string, unknown> = {
      eth_chainId: '0x1237',
      eth_getBlockByNumber: { number: '0x64', hash, parentHash, timestamp: '0x6b49d1ff' },
      eth_getCode: '0x616263',
      eth_call: '0x' + '00'.repeat(31) + '12',
    };
    assert.ok(Object.hasOwn(values, r.method), 'no arbitrary/write RPC');
    return {
      status: 200,
      body: JSON.stringify({ jsonrpc: '2.0', id: r.id, result: change(r, values[r.method]) }),
    };
  };
  return { seen, transport };
}
test('captures code and contract reads at one canonical hash and rechecks chain and block', async () => {
  const p = provider();
  const result = await capturePinnedState(
    request(),
    'https://rpc.example/private-key',
    p.transport,
    () => now,
  );
  assert.equal(result.status, 'CAPTURED');
  assert.equal(result.block?.number, '100');
  assert.equal(result.block?.hash, hash);
  assert.equal(result.contracts[0]?.code, '0x616263');
  assert.equal(
    result.contracts[0]!.codeHash,
    '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  );
  assert.equal(result.contracts[0]?.calls[0]?.result, '0x' + '00'.repeat(31) + '12');
  for (const r of p.seen.filter((r) => ['eth_getCode', 'eth_call'].includes(r.method)))
    assert.deepEqual(r.params[1], { blockHash: hash, requireCanonical: true });
  assert.deepEqual(
    p.seen.map((r) => r.method),
    ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getBlockByNumber', 'eth_chainId'],
  );
  assert.equal(result.receipts.length, 6);
  assert.ok(!JSON.stringify(result).includes('private-key'));
});
test('latest discovery is explicit and every subsequent state read uses its resolved hash', async () => {
  const r = { ...request(), block: { number: 'latest', hash: null } };
  const p = provider();
  assert.equal(
    (await capturePinnedState(r, 'https://rpc.example', p.transport, () => now)).status,
    'CAPTURED',
  );
  assert.deepEqual(p.seen[1]!.params, ['latest', false]);
  assert.deepEqual(p.seen[4]!.params, ['0x64', false]);
});
test('wrong chain, missing block and wrong requested block prevent any contract reads', async () => {
  for (const change of [
    (r: RpcRequest, v: unknown) => (r.method === 'eth_chainId' ? '0x1' : v),
    (r: RpcRequest, v: unknown) => (r.method === 'eth_getBlockByNumber' ? null : v),
    (r: RpcRequest, v: unknown) =>
      r.method === 'eth_getBlockByNumber' ? { ...(v as object), number: '0x65' } : v,
    (r: RpcRequest, v: unknown) =>
      r.method === 'eth_getBlockByNumber' ? { ...(v as object), hash: parentHash } : v,
  ]) {
    const p = provider(change);
    const result = await capturePinnedState(request(), 'https://rpc.example', p.transport, () => now);
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.contracts.length, 0);
    assert.ok(!p.seen.some((r) => r.method === 'eth_getCode'));
  }
});
test('chain drift or a reorg after reads discards all provisional observations', async () => {
  for (const mode of ['chain', 'block']) {
    let n = 0;
    const p = provider((r, v) => {
      if (r.method === (mode === 'chain' ? 'eth_chainId' : 'eth_getBlockByNumber') && ++n === 2)
        return mode === 'chain' ? '0x1' : { ...(v as object), hash: parentHash };
      return v;
    });
    const result = await capturePinnedState(request(), 'https://rpc.example', p.transport, () => now);
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.contracts.length, 0);
    assert.equal(result.block, null);
    assert.ok(result.receipts.length >= 5);
  }
});
test('missing bytecode and malformed or oversized state responses cannot qualify', async () => {
  for (const bad of ['0x', '0xz', '0x' + 'ff'.repeat(65537)]) {
    const p = provider((r, v) => (r.method === 'eth_getCode' ? bad : v));
    const result = await capturePinnedState(request(), 'https://rpc.example', p.transport, () => now);
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.contracts.length, 0);
  }
});
test('invalid and unbounded requests fail before transport', async () => {
  const malformed = [
    null,
    {},
    { ...request(), chainId: 1 },
    { ...request(), method: 'eth_sendTransaction' },
    { ...request(), block: { number: 'latest', hash } },
    { ...request(), block: { number: '100', hash: null } },
    { ...request(), contracts: [request().contracts[0], request().contracts[0]] },
    { ...request(), contracts: [{ address, calls: [{ id: 'decimals', data: '0xz' }] }] },
    { ...request(), contracts: Array(17).fill(request().contracts[0]) },
  ];
  for (const r of malformed) {
    const p = provider();
    const result = await capturePinnedState(r, 'https://rpc.example', p.transport, () => now);
    assert.equal(result.status, 'REJECTED');
    assert.equal(p.seen.length, 0);
  }
});
test('access denial is terminal with status evidence and no endpoint or upstream text exposure', async () => {
  let calls = 0;
  const result = await capturePinnedState(
    request(),
    'https://rpc.example/secret',
    async () => {
      calls++;
      return { status: 403, body: 'secret upstream response' };
    },
    () => now,
  );
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.reason, 'RPC_ACCESS_DENIED');
  assert.equal(calls, 1);
  assert.equal(result.receipts[0]?.httpStatus, 403);
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('unsupported canonical hash queries do not silently fall back to latest', async () => {
  const p = provider();
  const transport: RpcTransport = async (e, r, s, b) =>
    r.method === 'eth_getCode'
      ? {
          status: 200,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: r.id,
            error: { code: -32602, message: 'private error' },
          }),
        }
      : p.transport(e, r, s, b);
  const result = await capturePinnedState(request(), 'https://rpc.example', transport, () => now);
  assert.equal(result.reason, 'RPC_REMOTE_ERROR');
  assert.equal(result.contracts.length, 0);
  assert.ok(!JSON.stringify(result).includes('private error'));
});
test('cancellation terminates even an uncooperative transport and preserves bounded failure', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10);
  try {
    const result = await capturePinnedState(
      request(),
      'https://rpc.example',
      () => new Promise(() => {}),
      () => now,
      controller.signal,
    );
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reason, 'SNAPSHOT_ABORTED');
  } finally {
    clearTimeout(timer);
  }
});
test('clock regression and invalid clocks are not accepted as diagnostic timestamps', async () => {
  let tick = 0;
  const p = provider();
  assert.equal(
    (await capturePinnedState(request(), 'https://rpc.example', p.transport, () => now - tick++)).status,
    'REJECTED',
  );
  const q = provider();
  assert.equal(
    (await capturePinnedState(request(), 'https://rpc.example', q.transport, () => NaN)).status,
    'REJECTED',
  );
  assert.equal(q.seen.length, 0);
});
test('RPC probe CLI help and invalid input stay offline and do not expose endpoint configuration', () => {
  const cli = fileURLToPath(new URL('../tools/automata/probe-rpc.ts', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /READ_ONLY/);
  const bad = spawnSync(process.execPath, [cli], {
    encoding: 'utf8',
    timeout: 3000,
    env: { ...process.env, AF_READONLY_RPC_URL: 'https://secret.example/secret' },
  });
  assert.equal(bad.status, 2);
  assert.ok(!bad.stderr.includes('secret'));
});

test('abort before the queued transport starts makes no network request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const running = capturePinnedState(
    request(),
    'https://rpc.example',
    async () => {
      calls++;
      return { status: 403, body: '' };
    },
    () => now,
    controller.signal,
  );
  controller.abort();
  assert.equal((await running).reason, 'SNAPSHOT_ABORTED');
  assert.equal(calls, 0);
});
test('local clock faults remain distinguishable from remote network failures', async () => {
  let tick = 0;
  const p = provider();
  const result = await capturePinnedState(request(), 'https://rpc.example', p.transport, () => now - tick++);
  assert.equal(result.reason, 'INVALID_SNAPSHOT_CLOCK');
});
test('CLI atomically publishes a complete report and never overwrites existing output', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-rpc-cli-')));
  try {
    const input = join(dir, 'request.json'),
      output = join(dir, 'capture.json');
    writeFileSync(input, JSON.stringify(request()));
    const cli = new URL('../tools/automata/probe-rpc.ts', import.meta.url).href;
    const script = `let count=0; globalThis.fetch=async(_url,init)=>{count++;const r=JSON.parse(init.body);
      const values={eth_chainId:'0x1237',eth_getBlockByNumber:{number:'0x64',hash:'${hash}',parentHash:'${parentHash}',timestamp:'0x1'},eth_getCode:'0x6000',eth_call:'0x12'};
      if(!(r.method in values))throw new Error('unexpected method');
      return new Response(JSON.stringify({jsonrpc:'2.0',id:r.id,result:values[r.method]}));};
      process.argv=[process.execPath,${JSON.stringify(cli)},${JSON.stringify(input)},${JSON.stringify(output)}];
      await import(${JSON.stringify(cli)}); console.error('RPC_CALLS='+count);`;
    const options = {
      encoding: 'utf8' as const,
      timeout: 5000,
      env: { ...process.env, AF_READONLY_RPC_URL: 'https://rpc.example/private' },
    };
    const first = spawnSync(process.execPath, ['--input-type=module', '-e', script], options);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stderr, /RPC_CALLS=6/);
    const bytes = readFileSync(output);
    assert.equal(JSON.parse(bytes.toString()).status, 'CAPTURED');
    assert.ok(!bytes.toString().includes('private'));
    const second = spawnSync(process.execPath, ['--input-type=module', '-e', script], options);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /RPC_CALLS=0/);
    assert.deepEqual(readFileSync(output), bytes);
    assert.deepEqual(readdirSync(dir).sort(), ['capture.json', 'request.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
