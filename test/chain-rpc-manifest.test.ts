import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  deploymentManifestDigest,
  validateDeploymentManifest,
  type DeploymentManifestDocument,
  type DeploymentManifestExpectation,
} from '../packages/chain-adapter/src/manifest.ts';
import {
  createFetchTransport,
  JsonRpcClient,
  RpcFailure,
  type RpcTransport,
} from '../packages/chain-adapter/src/rpc.ts';
import { asAddress, asBlockHash, asHexData, asTransactionHash } from '../packages/chain-adapter/src/types.ts';

const CONTRACT = asAddress('0x2222222222222222222222222222222222222222');
const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const TX_HASH = asTransactionHash(`0x${'33'.repeat(32)}`);
const BLOCK_HASH = asBlockHash(`0x${'44'.repeat(32)}`);
const PARENT_HASH = asBlockHash(`0x${'55'.repeat(32)}`);
const RUNTIME_HASH = asBlockHash(`0x${'77'.repeat(32)}`);
const ABI_HASH = asBlockHash('0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977');
const PASS = asAddress('0x6666666666666666666666666666666666666666');
const PASS_ABI_HASH = asBlockHash('0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f');
const PASS_RUNTIME_HASH = asBlockHash(`0x${'88'.repeat(32)}`);
const ENDPOINT = 'https://rpc.testnet.chain.robinhood.com';

const manifestBody = {
  schemaVersion: 1,
  environment: 'robinhood-chain-testnet',
  chainId: 46_630,
  contractName: 'AlphaForgeVault',
  contractType: 'vault',
  contractAddress: CONTRACT,
  deploymentBlock: '100',
  abiVersion: 'm3-owner-v1',
  abiHash: ABI_HASH,
  runtimeBytecodeHash: RUNTIME_HASH,
  strategyPassAddress: PASS,
  strategyPassDeploymentBlock: '90',
  strategyPassAbiHash: PASS_ABI_HASH,
  strategyPassRuntimeBytecodeHash: PASS_RUNTIME_HASH,
};
const DIGEST = asBlockHash(`0x${createHash('sha256').update(JSON.stringify(manifestBody)).digest('hex')}`);
const manifestInput = { ...manifestBody, manifestDigest: DIGEST };
const expected: DeploymentManifestExpectation = {
  environment: 'robinhood-chain-testnet',
  chainId: 46_630,
  manifestDigest: DIGEST,
};

test('deployment manifest is accepted only when exact trusted identity matches', () => {
  const manifest = validateDeploymentManifest(manifestInput, expected);
  assert.equal(manifest.contractAddress, CONTRACT);
  assert.equal(manifest.deploymentBlock, 100n);
  assert.equal(manifest.abiHash, ABI_HASH);
  assert.equal(manifest.runtimeBytecodeHash, RUNTIME_HASH);
  assert.equal(manifest.strategyPassAddress, PASS);
  assert.equal(manifest.strategyPassDeploymentBlock, 90n);
  assert.equal(manifest.strategyPassAbiHash, PASS_ABI_HASH);
  assert.equal(manifest.strategyPassRuntimeBytecodeHash, PASS_RUNTIME_HASH);
  assert.ok(Object.isFrozen(manifest));
  for (const changed of [
    { ...manifestInput, chainId: 1 },
    { ...manifestInput, manifestDigest: BLOCK_HASH },
    { ...manifestInput, deploymentBlock: '-1' },
    { ...manifestInput, contractAddress: OWNER },
    { ...manifestInput, contractName: 'OtherVault' },
    { ...manifestInput, deploymentBlock: '101' },
    { ...manifestInput, abiHash: BLOCK_HASH },
    { ...manifestInput, runtimeBytecodeHash: BLOCK_HASH },
    { ...manifestInput, strategyPassAddress: CONTRACT },
    { ...manifestInput, strategyPassDeploymentBlock: '-1' },
    { ...manifestInput, strategyPassAbiHash: BLOCK_HASH },
    { ...manifestInput, strategyPassRuntimeBytecodeHash: BLOCK_HASH },
    { ...manifestInput, unexpected: true },
  ]) {
    const expectation =
      'contractAddress' in changed && changed.contractAddress === OWNER
        ? { ...expected, contractAddress: CONTRACT }
        : expected;
    assert.throws(() => validateDeploymentManifest(changed, expectation));
  }
});

test('deployment manifest rejects missing runtime identity and unsafe identifiers', () => {
  const withoutAbiHash = { ...manifestInput } as Partial<typeof manifestInput>;
  delete withoutAbiHash.abiHash;
  assert.throws(() => validateDeploymentManifest(withoutAbiHash, expected), /INVALID_DEPLOYMENT_MANIFEST/);
  const withoutRuntimeHash = { ...manifestInput } as Partial<typeof manifestInput>;
  delete withoutRuntimeHash.runtimeBytecodeHash;
  assert.throws(
    () => validateDeploymentManifest(withoutRuntimeHash, expected),
    /INVALID_DEPLOYMENT_MANIFEST/,
  );
  assert.throws(
    () => validateDeploymentManifest({ ...manifestInput, abiVersion: '../untrusted' }, expected),
    /INVALID_DEPLOYMENT_MANIFEST/,
  );
  assert.throws(
    () =>
      validateDeploymentManifest(
        { ...manifestInput, contractAddress: asAddress(`0x${'00'.repeat(20)}`) },
        expected,
      ),
    /INVALID_DEPLOYMENT_MANIFEST/,
  );
});

test('deployment manifest independently rejects non-documents and trusted expectation mismatches', () => {
  for (const input of [null, [], 'manifest', 1])
    assert.throws(() => validateDeploymentManifest(input, expected), /INVALID_DEPLOYMENT_MANIFEST/);

  assert.throws(
    () => validateDeploymentManifest(manifestInput, { ...expected, manifestDigest: BLOCK_HASH }),
    /INVALID_DEPLOYMENT_MANIFEST/,
  );
  assert.throws(
    () => validateDeploymentManifest(manifestInput, { ...expected, contractAddress: OWNER }),
    /INVALID_DEPLOYMENT_MANIFEST/,
  );

  const changedBody: DeploymentManifestDocument = {
    ...manifestBody,
    schemaVersion: 1,
    environment: 'robinhood-chain-testnet',
    chainId: 46_630,
    deploymentBlock: '101',
  };
  const changedDigest = deploymentManifestDigest(changedBody);
  assert.throws(
    () => validateDeploymentManifest({ ...changedBody, manifestDigest: DIGEST }, expected),
    /INVALID_DEPLOYMENT_MANIFEST/,
  );
  assert.notEqual(changedDigest, DIGEST);
});

test('Ethereum Keccak-256 hashes bytecode with the legacy padding used by EVM identities', async () => {
  const adapter = (await import('../packages/chain-adapter/src/index.ts')) as Record<string, unknown>;
  assert.equal(typeof adapter.keccak256, 'function');
  const keccak256 = adapter.keccak256 as (data: ReturnType<typeof asHexData>) => string;
  assert.equal(
    keccak256(asHexData('0x')),
    '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  );
  assert.equal(
    keccak256(asHexData('0x616263')),
    '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  );
});

test('Ethereum Keccak-256 preserves the rate-boundary regression vectors', async () => {
  const { keccak256 } = await import('../packages/chain-adapter/src/keccak.ts');
  const vector = (length: number) =>
    asHexData(
      `0x${Buffer.from(Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256)).toString('hex')}`,
    );
  for (const [length, expected] of [
    [135, '0x9b6deb2387c86783862216d0205051ba7d41fa4fa70a30e2abfe18ca94d22b22'],
    [136, '0xb8717c6e7605ca3b5a0a94a147127679778a23a4324e53b910263673d0bfb55c'],
    [137, '0xe2d9f409a6d575e1457f9d3f7436081485d5794bf84db179566eea07a8266e8d'],
    [272, '0x79cacfd52db427ce7b9a771984a13387a6e31075bcc4716a5deddff6875c4e69'],
  ] as const)
    assert.equal(keccak256(vector(length)), expected, `${length}-byte vector`);
});

function transportFor(results: Readonly<Record<string, unknown>>): RpcTransport {
  return async (_endpoint, request) => ({
    status: 200,
    body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result: results[request.method] }),
  });
}

test('read-only RPC verifies chain identity and normalizes receipt, block, logs and calls', async () => {
  const rawLog = {
    address: CONTRACT,
    blockNumber: '0x78',
    blockHash: BLOCK_HASH,
    transactionHash: TX_HASH,
    transactionIndex: '0x2',
    logIndex: '0x1',
    data: '0x1234',
    topics: [`0x${'88'.repeat(32)}`],
    removed: false,
  };
  const rpc = new JsonRpcClient([ENDPOINT], {
    transport: transportFor({
      eth_chainId: '0xb626',
      eth_getBlockByNumber: {
        number: '0x78',
        hash: BLOCK_HASH,
        parentHash: PARENT_HASH,
        timestamp: '0x68c69f40',
      },
      eth_getTransactionReceipt: {
        transactionHash: TX_HASH,
        blockNumber: '0x78',
        blockHash: BLOCK_HASH,
        transactionIndex: '0x2',
        from: OWNER,
        to: CONTRACT,
        status: '0x1',
        logs: [rawLog],
      },
      eth_getLogs: [rawLog],
      eth_getCode: '0x6000',
      eth_call: '0x1234',
    }),
  });

  assert.equal(await rpc.chainId(), 46_630);
  assert.deepEqual(await rpc.block(120n), {
    number: 120n,
    hash: BLOCK_HASH,
    parentHash: PARENT_HASH,
    timestamp: 1_757_847_360n,
  });
  const receipt = await rpc.receipt(TX_HASH);
  assert.equal(receipt?.status, 'SUCCESS');
  assert.equal(receipt?.to, CONTRACT);
  assert.equal(receipt?.logs[0]?.logIndex, 1);
  assert.deepEqual(await rpc.logs({ address: CONTRACT, fromBlock: 120n, toBlock: 120n }), receipt?.logs);
  assert.equal(
    await (rpc as JsonRpcClient & { code(address: typeof CONTRACT, block: bigint): Promise<string> }).code(
      CONTRACT,
      120n,
    ),
    '0x6000',
  );
  assert.equal(await rpc.call({ to: CONTRACT, data: asHexData('0x1234') }, 120n), '0x1234');
});

test('RPC preserves null lookup results and exact reverted contract-creation receipts', async () => {
  const nullRpc = new JsonRpcClient([ENDPOINT], {
    transport: transportFor({ eth_getBlockByNumber: null, eth_getTransactionReceipt: null }),
  });
  assert.equal(await nullRpc.block(120n), null);
  assert.equal(await nullRpc.receipt(TX_HASH), null);

  const reverted = new JsonRpcClient([ENDPOINT], {
    transport: transportFor({
      eth_getTransactionReceipt: {
        transactionHash: TX_HASH,
        blockNumber: '0x78',
        blockHash: BLOCK_HASH,
        transactionIndex: '0x0',
        from: OWNER,
        to: null,
        status: '0x0',
        logs: [],
      },
    }),
  });
  assert.deepEqual(await reverted.receipt(TX_HASH), {
    transactionHash: TX_HASH,
    blockNumber: 120n,
    blockHash: BLOCK_HASH,
    transactionIndex: 0,
    from: OWNER,
    to: null,
    status: 'REVERTED',
    logs: [],
  });
});

test('RPC rejects malformed receipt authority, finality and index fields', async () => {
  const base = {
    transactionHash: TX_HASH,
    blockNumber: '0x78',
    blockHash: BLOCK_HASH,
    transactionIndex: '0x0',
    from: OWNER,
    to: CONTRACT,
    status: '0x1',
    logs: [],
  };
  for (const malformed of [
    { ...base, status: '0x2' },
    { ...base, to: 1 },
    { ...base, logs: {} },
    { ...base, transactionIndex: `0x${Number.MAX_SAFE_INTEGER + 1}` },
    { ...base, from: '0x00' },
  ]) {
    const rpc = new JsonRpcClient([ENDPOINT], {
      transport: transportFor({ eth_getTransactionReceipt: malformed }),
    });
    await assert.rejects(
      () => rpc.receipt(TX_HASH),
      (error: unknown) => error instanceof RpcFailure && error.code === 'RPC_INVALID_RESPONSE',
    );
  }
});

test('RPC rejects malformed block, log, topic and quantity evidence before it reaches accounting', async () => {
  const rpcFor = (method: string, result: unknown) =>
    new JsonRpcClient([ENDPOINT], { transport: transportFor({ [method]: result }) });
  const rawLog = {
    address: CONTRACT,
    blockNumber: '0x78',
    blockHash: BLOCK_HASH,
    transactionHash: TX_HASH,
    transactionIndex: '0x0',
    logIndex: '0x0',
    data: '0x',
    topics: [`0x${'88'.repeat(32)}`],
    removed: false,
  };
  const rawBlock = {
    number: '0x78',
    hash: BLOCK_HASH,
    parentHash: PARENT_HASH,
    timestamp: '0x1',
  };

  await assert.rejects(() => rpcFor('eth_getBlockByNumber', []).block(120n), {
    code: 'RPC_INVALID_RESPONSE',
  });
  await assert.rejects(() => rpcFor('eth_chainId', 46_630).chainId(), {
    code: 'RPC_INVALID_RESPONSE',
  });
  for (const malformed of [
    { ...rawLog, topics: {} },
    { ...rawLog, removed: 'false' },
    { ...rawLog, topics: ['0x01'] },
    { ...rawLog, address: '0x00' },
  ])
    await assert.rejects(
      () => rpcFor('eth_getLogs', [malformed]).logs({ address: CONTRACT, fromBlock: 120n, toBlock: 120n }),
      { code: 'RPC_INVALID_RESPONSE' },
    );
  await assert.rejects(() => rpcFor('eth_getBlockByNumber', { ...rawBlock, hash: '0x00' }).block(120n), {
    code: 'RPC_INVALID_RESPONSE',
  });
  await assert.rejects(() => rpcFor('eth_getBlockByNumber', { ...rawBlock, number: '0x00' }).block(120n), {
    code: 'RPC_INVALID_RESPONSE',
  });
  assert.deepEqual(await rpcFor('eth_getBlockByNumber', rawBlock).block('latest'), {
    number: 120n,
    hash: BLOCK_HASH,
    parentHash: PARENT_HASH,
    timestamp: 1n,
  });
});

test('RPC stops after the final retryable transport failure', async () => {
  let attempts = 0;
  const rpc = new JsonRpcClient([ENDPOINT], {
    maxAttempts: 2,
    transport: async () => {
      attempts++;
      throw new Error('fixture transport unavailable');
    },
  });
  await assert.rejects(() => rpc.chainId(), { code: 'RPC_UNAVAILABLE', retryable: true });
  assert.equal(attempts, 2);
});

test('read-only RPC uses only allowlisted methods and canonical quantity encoding', async () => {
  const requests: { method: string; params: readonly unknown[] }[] = [];
  const transport: RpcTransport = async (_endpoint, request) => {
    requests.push({ method: request.method, params: request.params });
    return {
      status: 200,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: request.method === 'eth_call' || request.method === 'eth_getCode' ? '0x' : [],
      }),
    };
  };
  const rpc = new JsonRpcClient([ENDPOINT], { transport });
  await rpc.logs({ address: CONTRACT, fromBlock: 0n, toBlock: 16n, topics: [null] });
  await (rpc as JsonRpcClient & { code(address: typeof CONTRACT, block: 'latest'): Promise<string> }).code(
    CONTRACT,
    'latest',
  );
  await rpc.call(
    { to: CONTRACT, data: asHexData('0x1234') },
    { blockHash: BLOCK_HASH, requireCanonical: true },
  );
  assert.deepEqual(requests, [
    {
      method: 'eth_getLogs',
      params: [{ address: CONTRACT, fromBlock: '0x0', toBlock: '0x10', topics: [null] }],
    },
    {
      method: 'eth_getCode',
      params: [CONTRACT, 'latest'],
    },
    {
      method: 'eth_call',
      params: [
        { to: CONTRACT, data: '0x1234' },
        { blockHash: BLOCK_HASH, requireCanonical: true },
      ],
    },
  ]);
  assert.equal(Object.hasOwn(rpc, 'request'), false, 'raw arbitrary RPC must not be public');
});

test('RPC rotates endpoints for bounded retryable failures', async () => {
  const endpoints: string[] = [];
  let attempts = 0;
  const rpc = new JsonRpcClient(['https://rpc-one.example', 'https://rpc-two.example'], {
    maxAttempts: 2,
    transport: async (endpoint, request) => {
      endpoints.push(endpoint);
      attempts++;
      if (attempts === 1) return { status: 429, body: '' };
      return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '0xb626' }) };
    },
  });
  assert.equal(await rpc.chainId(), 46_630);
  assert.deepEqual(endpoints, ['https://rpc-one.example/', 'https://rpc-two.example/']);
});

test('RPC rejects unsafe endpoints, policies, request ranges and malformed method results', async () => {
  for (const endpoints of [
    [],
    Array.from({ length: 9 }, () => ENDPOINT),
    ['http://rpc.example'],
    ['not a url'],
  ])
    assert.throws(() => new JsonRpcClient(endpoints), RpcFailure);
  for (const options of [
    { timeoutMs: 99 },
    { timeoutMs: 30_001 },
    { maxAttempts: 0 },
    { maxAttempts: 9 },
    { maxResponseBytes: 63 },
    { maxResponseBytes: 10_000_001 },
  ])
    assert.throws(() => new JsonRpcClient([ENDPOINT], options), /RPC_INVALID_POLICY/);

  const resultRpc = (method: string, result: unknown) =>
    new JsonRpcClient([ENDPOINT], { transport: transportFor({ [method]: result }) });
  await assert.rejects(() => resultRpc('eth_chainId', `0x${'f'.repeat(32)}`).chainId(), {
    code: 'RPC_INVALID_RESPONSE',
  });
  await assert.rejects(
    () => resultRpc('eth_getLogs', {}).logs({ address: CONTRACT, fromBlock: 0n, toBlock: 1n }),
    { code: 'RPC_INVALID_RESPONSE' },
  );
  await assert.rejects(
    () => resultRpc('eth_getLogs', []).logs({ address: CONTRACT, fromBlock: 2n, toBlock: 1n }),
    { code: 'RPC_INVALID_REQUEST' },
  );
  await assert.rejects(() => resultRpc('eth_getCode', 'invalid').code(CONTRACT, 'latest'), {
    code: 'RPC_INVALID_RESPONSE',
  });
  await assert.rejects(() => resultRpc('eth_call', '0x').call({ to: CONTRACT, data: asHexData('0x') }, -1n), {
    code: 'RPC_INVALID_REQUEST',
  });
  for (const reference of [
    null,
    { blockHash: BLOCK_HASH, requireCanonical: false },
    { blockHash: BLOCK_HASH, requireCanonical: true, extra: true },
    { blockHash: 'invalid', requireCanonical: true },
  ])
    await assert.rejects(
      () => resultRpc('eth_call', '0x').call({ to: CONTRACT, data: asHexData('0x') }, reference as never),
      { code: 'RPC_INVALID_REQUEST' },
    );
  await assert.rejects(
    () => resultRpc('eth_call', 'invalid').call({ to: CONTRACT, data: asHexData('0x') }, 'latest'),
    { code: 'RPC_INVALID_RESPONSE' },
  );
});

test('RPC transport retry and envelope failures remain bounded and public-safe', async () => {
  for (const response of [
    { status: 400, body: '' },
    { status: 500, body: '' },
    { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1 }) },
    { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: 1, error: {} }) },
  ]) {
    const rpc = new JsonRpcClient([ENDPOINT], { maxAttempts: 1, transport: async () => response });
    await assert.rejects(() => rpc.chainId(), RpcFailure);
  }
  const rpc = new JsonRpcClient([ENDPOINT], {
    maxAttempts: 2,
    transport: async () => {
      throw new RpcFailure('RPC_INVALID_RESPONSE');
    },
  });
  await assert.rejects(() => rpc.chainId(), { code: 'RPC_INVALID_RESPONSE' });
});

test('RPC fails closed on JSON-RPC errors, malformed data and oversized responses', async () => {
  const cases: { body: string; code: string }[] = [
    {
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32_000, message: 'bad' } }),
      code: 'RPC_REMOTE_ERROR',
    },
    { body: JSON.stringify({ jsonrpc: '2.0', id: 2, result: '0xb626' }), code: 'RPC_INVALID_ENVELOPE' },
    { body: '{', code: 'RPC_INVALID_RESPONSE' },
    { body: 'x'.repeat(129), code: 'RPC_RESPONSE_TOO_LARGE' },
  ];
  for (const value of cases) {
    const rpc = new JsonRpcClient([ENDPOINT], {
      maxResponseBytes: 128,
      transport: async () => ({ status: 200, body: value.body }),
    });
    await assert.rejects(
      () => rpc.chainId(),
      (error: unknown) => {
        assert.ok(error instanceof RpcFailure);
        assert.equal(error.code, value.code);
        return true;
      },
    );
  }
});

test('RPC errors never expose endpoint paths, query credentials or transport details', async () => {
  const endpoint = 'https://rpc.example/private-provider-key?token=secret-value';
  const rpc = new JsonRpcClient([endpoint], {
    maxAttempts: 1,
    transport: async () => {
      throw new Error(`network failure at ${endpoint}`);
    },
  });
  await assert.rejects(
    () => rpc.chainId(),
    (error: unknown) => {
      assert.ok(error instanceof RpcFailure);
      assert.equal(error.code, 'RPC_UNAVAILABLE');
      assert.equal(error.message, 'RPC_UNAVAILABLE');
      assert.doesNotMatch(String(error), /secret-value|private-provider-key|rpc\.example/);
      return true;
    },
  );
});

test('default fetch transport stops reading once the response byte budget is exceeded', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(80));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetcher: typeof fetch = async () => new Response(body, { status: 200 });
  const transport = createFetchTransport(fetcher);
  await assert.rejects(
    () =>
      transport(
        ENDPOINT,
        { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
        AbortSignal.timeout(1_000),
        128,
      ),
    (error: unknown) => error instanceof RpcFailure && error.code === 'RPC_RESPONSE_TOO_LARGE',
  );
  assert.equal(cancelled, true);
});

test('fetch transport enforces status, declared size, empty body and UTF-8 boundaries', async () => {
  const request = { jsonrpc: '2.0' as const, id: 1, method: 'eth_chainId', params: [] };
  const signal = AbortSignal.timeout(1_000);
  const nonSuccess = createFetchTransport(async () => new Response('private', { status: 403 }));
  assert.deepEqual(await nonSuccess(ENDPOINT, request, signal, 128), { status: 403, body: '' });
  const declared = createFetchTransport(
    async () => new Response('x', { status: 200, headers: { 'content-length': '129' } }),
  );
  await assert.rejects(() => declared(ENDPOINT, request, signal, 128), { code: 'RPC_RESPONSE_TOO_LARGE' });
  const empty = createFetchTransport(async () => new Response(null, { status: 204 }));
  assert.deepEqual(await empty(ENDPOINT, request, signal, 128), { status: 204, body: '' });
  const invalidUtf8 = createFetchTransport(
    async () => new Response(new Uint8Array([0xc3, 0x28]), { status: 200 }),
  );
  await assert.rejects(() => invalidUtf8(ENDPOINT, request, signal, 128), {
    code: 'RPC_INVALID_RESPONSE',
  });
});
