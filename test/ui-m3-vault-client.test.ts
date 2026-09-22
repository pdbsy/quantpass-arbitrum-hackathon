import test from 'node:test';
import assert from 'node:assert/strict';
import {
  M3VaultApiClient,
  M3VaultReadFailure,
  M3VaultSubmissionFailure,
} from '../apps/web/src/m3-vault-client.ts';
import { asAddress, asBlockHash, asHexData, asTransactionHash } from '../packages/chain-adapter/src/types.ts';
import { encodeM3VaultCall } from '../packages/chain-adapter/src/vault-abi.ts';

const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const CONTRACT = asAddress('0x2222222222222222222222222222222222222222');
const CREATOR = asAddress('0x3333333333333333333333333333333333333333');
const PASS = asAddress('0x4444444444444444444444444444444444444444');
const USDC = asAddress('0x5555555555555555555555555555555555555555');
const ETH = asAddress('0x6666666666666666666666666666666666666666');
const BTC = asAddress('0x7777777777777777777777777777777777777777');
const LOCKER = asAddress('0x8888888888888888888888888888888888888888');
const BLOCK_HASH = asBlockHash(`0x${'aa'.repeat(32)}`);
const STRATEGY_ID = asHexData(`0x${'11'.repeat(32)}`);
const STRATEGY_REF = asHexData(`0x${'22'.repeat(32)}`);
const MANIFEST_DIGEST = asBlockHash(`0x${'12'.repeat(32)}`);
const VAULT_ABI_HASH = asBlockHash('0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977');
const VAULT_CODE_HASH = asBlockHash(`0x${'34'.repeat(32)}`);
const PASS_ABI_HASH = asBlockHash('0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f');
const PASS_CODE_HASH = asBlockHash(`0x${'56'.repeat(32)}`);

function payload() {
  return {
    chainId: 46_630,
    owner: OWNER,
    contract: CONTRACT,
    projectionKey: 'm3-vault',
    blockNumber: '100',
    blockHash: BLOCK_HASH,
    state: {
      owner: OWNER,
      strategyCreator: CREATOR,
      strategyId: STRATEGY_ID,
      strategyRef: STRATEGY_REF,
      pass: PASS,
      passStrategyId: STRATEGY_ID,
      afUsdc: USDC,
      afEth: ETH,
      afBtc: BTC,
      passLocker: LOCKER,
      principalBasis: '1000000',
      trackedUsdcBalance: '1000000',
      realizedProfit: '0',
      withdrawableUsdc: '1000000',
      trackedAfEth: '0',
      trackedAfBtc: '0',
      openTrackedPositionCount: '0',
      closed: false,
    },
  };
}

test('web Vault client reads the canonical owner projection through the same-process API', async () => {
  const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
  const client = new M3VaultApiClient(
    async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    { vaultAddress: CONTRACT, passAddress: PASS },
  );
  assert.deepEqual(await client.readSnapshot(OWNER), payload());
  assert.deepEqual(requests, [
    {
      input: `/api/v1/chain/vaults/${CONTRACT}/${OWNER}`,
      init: { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } },
    },
  ]);
});

test('web Vault client reads an exact contract-qualified StrategyPass projection', async () => {
  const passPayload = {
    chainId: 46_630,
    owner: OWNER,
    contract: PASS,
    projectionKey: 'm3-strategy-pass',
    blockNumber: '101',
    blockHash: BLOCK_HASH,
    state: {
      owner: OWNER,
      pass: PASS,
      strategyId: STRATEGY_ID,
      decimals: 18,
      balanceRaw: '1',
    },
  } as const;
  const requests: string[] = [];
  const client = new M3VaultApiClient(
    async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify(passPayload), { status: 200 });
    },
    { vaultAddress: CONTRACT, passAddress: PASS },
  );
  assert.deepEqual(await client.readPassSnapshot(OWNER), passPayload);
  assert.deepEqual(requests, [`/api/v1/chain/passes/${PASS}/${OWNER}`]);
});

test('web Vault client reads exact contract-qualified runtime status for identity cross-checking', async () => {
  const body = {
    lastAttempt: 'SUCCEEDED',
    errorCode: null,
    database: { status: 'HEALTHY', schemaVersion: 6, integrity: 'OK' },
    deployment: {
      chainId: 46_630,
      contract: CONTRACT,
      manifestDigest: MANIFEST_DIGEST,
      abiHash: VAULT_ABI_HASH,
      runtimeBytecodeHash: VAULT_CODE_HASH,
      strategyPassAddress: PASS,
      strategyPassAbiHash: PASS_ABI_HASH,
      strategyPassRuntimeBytecodeHash: PASS_CODE_HASH,
    },
  } as const;
  const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
  const client = new M3VaultApiClient(
    async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify(body), { status: 200 });
    },
    { vaultAddress: CONTRACT, passAddress: PASS },
  );

  assert.deepEqual(await client.readRuntimeStatus(), body);
  assert.deepEqual(requests, [
    {
      input: `/api/v1/chain/runtime-status/${CONTRACT}`,
      init: { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } },
    },
  ]);
});

test('web Vault client rejects malformed, foreign and unhealthy runtime status', async () => {
  const valid = {
    lastAttempt: 'SUCCEEDED',
    errorCode: null,
    database: { status: 'HEALTHY', schemaVersion: 6, integrity: 'OK' },
    deployment: {
      chainId: 46_630,
      contract: CONTRACT,
      manifestDigest: MANIFEST_DIGEST,
      abiHash: VAULT_ABI_HASH,
      runtimeBytecodeHash: VAULT_CODE_HASH,
      strategyPassAddress: PASS,
      strategyPassAbiHash: PASS_ABI_HASH,
      strategyPassRuntimeBytecodeHash: PASS_CODE_HASH,
    },
  };
  for (const body of [
    [],
    { ...valid, unexpected: true },
    { ...valid, lastAttempt: 'FAILED', errorCode: 'M3_INDEXER_SYNC_FAILED' },
    { ...valid, database: { ...valid.database, status: 'UNHEALTHY', integrity: 'FAILED' } },
    { ...valid, deployment: { ...valid.deployment, contract: CREATOR } },
    { ...valid, deployment: { ...valid.deployment, manifestDigest: '0x01' } },
  ]) {
    const client = new M3VaultApiClient(async () => new Response(JSON.stringify(body), { status: 200 }), {
      vaultAddress: CONTRACT,
      passAddress: PASS,
    });
    await assert.rejects(client.readRuntimeStatus(), /M3_VAULT_READ_FAILED/);
  }
});

test('web Vault client rejects malformed or conflicting StrategyPass projections', async () => {
  const valid = {
    chainId: 46_630,
    owner: OWNER,
    contract: PASS,
    projectionKey: 'm3-strategy-pass',
    blockNumber: '101',
    blockHash: BLOCK_HASH,
    state: {
      owner: OWNER,
      pass: PASS,
      strategyId: STRATEGY_ID,
      decimals: 18,
      balanceRaw: '1',
    },
  };
  const invalid = [
    [],
    { ...valid, contract: CONTRACT },
    { ...valid, owner: CREATOR },
    { ...valid, state: { ...valid.state, owner: CREATOR } },
    { ...valid, state: { ...valid.state, pass: CONTRACT } },
    { ...valid, state: { ...valid.state, strategyId: asHexData(`0x${'00'.repeat(32)}`) } },
    { ...valid, state: { ...valid.state, decimals: 6 } },
    { ...valid, state: { ...valid.state, balanceRaw: '01' } },
    { ...valid, blockHash: '0x01' },
  ];
  for (const body of invalid) {
    const client = new M3VaultApiClient(async () => new Response(JSON.stringify(body), { status: 200 }), {
      vaultAddress: CONTRACT,
      passAddress: PASS,
    });
    await assert.rejects(client.readPassSnapshot(OWNER), /M3_VAULT_READ_FAILED/);
  }
  const unavailable = new M3VaultApiClient(async () => new Response('{}', { status: 503 }), {
    vaultAddress: CONTRACT,
    passAddress: PASS,
  });
  await assert.rejects(unavailable.readPassSnapshot(OWNER), /M3_VAULT_READ_FAILED/);
  const transport = new M3VaultApiClient(
    async () => {
      throw new Error('network detail');
    },
    { vaultAddress: CONTRACT, passAddress: PASS },
  );
  await assert.rejects(transport.readPassSnapshot(OWNER), /M3_VAULT_READ_FAILED/);
});

test('web Vault client rejects foreign owners, malformed state and unavailable projections', async () => {
  for (const response of [
    new Response(JSON.stringify({ ...payload(), owner: CREATOR }), { status: 200 }),
    new Response(JSON.stringify({ ...payload(), state: { ...payload().state, principalBasis: '-1' } }), {
      status: 200,
    }),
    new Response(JSON.stringify({ error: 'CHAIN_PROJECTION_UNAVAILABLE' }), { status: 503 }),
  ]) {
    const client = new M3VaultApiClient(async () => response);
    await assert.rejects(
      () => client.readSnapshot(OWNER),
      (error: unknown) => error instanceof M3VaultReadFailure && error.code === 'M3_VAULT_READ_FAILED',
    );
  }
});

test('web Vault client registers exact wallet submission identity through the same-origin API', async () => {
  const calldata = encodeM3VaultCall('deposit(uint256)', [1_000_000n]);
  const txHash = asTransactionHash(`0x${'bb'.repeat(32)}`);
  const input = {
    operationId: 'web-submission-1',
    chainId: 46_630,
    owner: OWNER,
    target: CONTRACT,
    calldata,
    txHash,
  } as const;
  const response = {
    ...input,
    state: 'SUBMITTED',
    submittedAt: '2026-09-20T00:00:00.000Z',
  } as const;
  const requests: Array<{ input: string; init: RequestInit | undefined }> = [];
  const client = new M3VaultApiClient(async (request, init) => {
    requests.push({ input: String(request), init });
    return new Response(JSON.stringify(response), { status: 202 });
  });

  assert.deepEqual(await client.registerSubmission(input), response);
  assert.deepEqual(requests, [
    {
      input: '/api/v1/chain/operations',
      init: {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-QuantPass-Demo': '1',
        },
        body: JSON.stringify(input),
      },
    },
  ]);
});

test('web Vault submission client rejects extra input authority and conflicting responses', async () => {
  const input = {
    operationId: 'web-submission-2',
    chainId: 46_630,
    owner: OWNER,
    target: CONTRACT,
    calldata: encodeM3VaultCall('close()', []),
    txHash: asTransactionHash(`0x${'cc'.repeat(32)}`),
  } as const;
  const client = new M3VaultApiClient(
    async () =>
      new Response(
        JSON.stringify({
          ...input,
          owner: CREATOR,
          state: 'SUBMITTED',
          submittedAt: '2026-09-20T00:00:00.000Z',
        }),
        { status: 202 },
      ),
  );
  await assert.rejects(
    () => client.registerSubmission({ ...input, productReady: true } as typeof input),
    (error: unknown) =>
      error instanceof M3VaultSubmissionFailure && error.code === 'M3_VAULT_SUBMISSION_FAILED',
  );
  await assert.rejects(
    () => client.registerSubmission(input),
    (error: unknown) =>
      error instanceof M3VaultSubmissionFailure && error.code === 'M3_VAULT_SUBMISSION_FAILED',
  );
});

test('web Vault client reads exact operation evidence for the registered owner', async () => {
  const evidence = {
    lifecycle: 'CONFIRMED',
    receipt: 'SUCCESS',
    receiptCanonical: true,
    confirmations: 3,
    reconciliation: 'MATCHED',
    projection: 'READY',
    chainStatus: 'SOFT_READY',
    l1Status: 'UNKNOWN',
    finalityStatus: 'UNKNOWN',
    indexerStatus: 'HEALTHY',
    degradedReason: null,
    productReady: true,
  } as const;
  const client = new M3VaultApiClient(async (request, init) => {
    assert.equal(String(request), `/api/v1/chain/operations/web-submission-1/evidence?owner=${OWNER}`);
    assert.deepEqual(init, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    return new Response(JSON.stringify({ operationId: 'web-submission-1', ...evidence }), { status: 200 });
  });

  assert.deepEqual(await client.readOperationEvidence('web-submission-1', OWNER), evidence);
});

test('web Vault client rejects evidence with a conflicting operation id or extra authority', async () => {
  for (const body of [
    {
      operationId: 'different-operation',
      lifecycle: 'SUBMITTED',
      receipt: 'PENDING',
      receiptCanonical: false,
      confirmations: 0,
      reconciliation: 'PENDING',
      projection: 'PENDING',
      chainStatus: 'PENDING',
      l1Status: 'UNKNOWN',
      finalityStatus: 'UNKNOWN',
      indexerStatus: 'SYNCING',
      degradedReason: null,
      productReady: false,
    },
    {
      operationId: 'web-submission-1',
      lifecycle: 'SUBMITTED',
      receipt: 'PENDING',
      receiptCanonical: false,
      confirmations: 0,
      reconciliation: 'PENDING',
      projection: 'PENDING',
      chainStatus: 'PENDING',
      l1Status: 'UNKNOWN',
      finalityStatus: 'UNKNOWN',
      indexerStatus: 'SYNCING',
      degradedReason: null,
      productReady: false,
      owner: OWNER,
    },
  ]) {
    const client = new M3VaultApiClient(async () => new Response(JSON.stringify(body), { status: 200 }));
    await assert.rejects(
      () => client.readOperationEvidence('web-submission-1', OWNER),
      /M3_VAULT_READ_FAILED/,
    );
  }
});

test('web Vault client rejects malformed identity, bytes and block fields', async () => {
  const bodies = [
    [],
    { ...payload(), owner: 'invalid' },
    { ...payload(), state: { ...payload().state, strategyId: '0x01' } },
    { ...payload(), blockHash: '0x01' },
  ];
  for (const body of bodies) {
    const client = new M3VaultApiClient(async () => new Response(JSON.stringify(body), { status: 200 }));
    await assert.rejects(client.readSnapshot(OWNER), /M3_VAULT_READ_FAILED/);
  }
});

test('web Vault submission validates operation, chain, transport and response identity', async () => {
  const valid = {
    operationId: 'web-submission-3',
    chainId: 46_630,
    owner: OWNER,
    target: CONTRACT,
    calldata: encodeM3VaultCall('close()', []),
    txHash: asTransactionHash(`0x${'dd'.repeat(32)}`),
  } as const;
  for (const input of [
    { ...valid, operationId: 'invalid operation' },
    { ...valid, chainId: 1 },
  ]) {
    const client = new M3VaultApiClient(async () => new Response('{}', { status: 202 }));
    await assert.rejects(client.registerSubmission(input as typeof valid), /M3_VAULT_SUBMISSION_FAILED/);
  }

  const malformedResponse = new M3VaultApiClient(
    async () =>
      new Response(
        JSON.stringify({
          ...valid,
          owner: 'invalid',
          state: 'SUBMITTED',
          submittedAt: '2026-09-20T00:00:00.000Z',
        }),
        { status: 202 },
      ),
  );
  await assert.rejects(malformedResponse.registerSubmission(valid), /M3_VAULT_SUBMISSION_FAILED/);

  const unavailable = new M3VaultApiClient(async () => new Response('{}', { status: 409 }));
  await assert.rejects(unavailable.registerSubmission(valid), /M3_VAULT_SUBMISSION_FAILED/);

  const transport = new M3VaultApiClient(async () => {
    throw new Error('network detail');
  });
  await assert.rejects(transport.registerSubmission(valid), /M3_VAULT_SUBMISSION_FAILED/);
});

test('web Vault evidence accepts both explicit degraded reasons and rejects unavailable transport', async () => {
  const baseEvidence = {
    operationId: 'web-submission-4',
    lifecycle: 'REORGED',
    receipt: 'PENDING',
    receiptCanonical: false,
    confirmations: 0,
    reconciliation: 'PENDING',
    projection: 'STALE',
    chainStatus: 'REORGED',
    l1Status: 'UNKNOWN',
    finalityStatus: 'UNKNOWN',
    indexerStatus: 'DEGRADED',
    productReady: false,
  } as const;
  for (const degradedReason of ['CHAIN_REORG_DEPTH_EXCEEDED', 'CHAIN_REORG_NO_COMMON_ANCESTOR'] as const) {
    const client = new M3VaultApiClient(
      async () => new Response(JSON.stringify({ ...baseEvidence, degradedReason }), { status: 200 }),
    );
    assert.equal(
      (await client.readOperationEvidence('web-submission-4', OWNER)).degradedReason,
      degradedReason,
    );
  }

  const unavailable = new M3VaultApiClient(async () => new Response('{}', { status: 503 }));
  await assert.rejects(unavailable.readOperationEvidence('web-submission-4', OWNER), /M3_VAULT_READ_FAILED/);
  const transport = new M3VaultApiClient(async () => {
    throw new Error('network detail');
  });
  await assert.rejects(transport.readOperationEvidence('web-submission-4', OWNER), /M3_VAULT_READ_FAILED/);
  await assert.rejects(transport.readSnapshot(OWNER), /M3_VAULT_READ_FAILED/);
});

test('web Vault submission sanitizes unexpected response property failures', async () => {
  const input = {
    operationId: 'web-submission-5',
    chainId: 46_630,
    owner: OWNER,
    target: CONTRACT,
    calldata: encodeM3VaultCall('close()', []),
    txHash: asTransactionHash(`0x${'ee'.repeat(32)}`),
  } as const;
  const response = new Proxy(
    {
      ...input,
      state: 'SUBMITTED',
      submittedAt: '2026-09-20T00:00:00.000Z',
    },
    {
      get(target, property, receiver) {
        if (property === 'state') throw new Error('private response detail');
        return Reflect.get(target, property, receiver);
      },
    },
  );
  const client = new M3VaultApiClient((async () => ({
    status: 202,
    json: async () => response,
  })) as unknown as typeof fetch);
  await assert.rejects(
    client.registerSubmission(input),
    (error: unknown) => error instanceof M3VaultSubmissionFailure && !error.message.includes('private'),
  );
});

test('Pass and runtime API reads without configured contracts refuse before a network request', async () => {
  let requests = 0;
  const client = new M3VaultApiClient(async () => {
    requests++;
    throw Error('unexpected request');
  });
  await assert.rejects(client.readPassSnapshot(OWNER), /M3_VAULT_READ_FAILED/);
  await assert.rejects(client.readRuntimeStatus(), /M3_VAULT_READ_FAILED/);
  assert.equal(requests, 0);
});

test('runtime status failures are sanitized and never become healthy deployment evidence', async () => {
  for (const response of [
    async () => new Response('{}', { status: 503 }),
    async () => {
      throw { message: 'untrusted transport payload' };
    },
  ]) {
    const client = new M3VaultApiClient(response, { vaultAddress: CONTRACT, passAddress: PASS });
    await assert.rejects(
      client.readRuntimeStatus(),
      (error: unknown) => error instanceof M3VaultReadFailure && error.message === 'M3_VAULT_READ_FAILED',
    );
  }
});
