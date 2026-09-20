import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApp } from '../apps/server/src/app.ts';
import { buildM3App } from '../apps/server/src/m3-app.ts';
import { M3ChainRuntime } from '../apps/server/src/m3-chain-runtime.ts';
import {
  registerChainEvidenceRoutes,
  type ChainEvidenceRoutesOptions,
} from '../apps/server/src/chain-routes.ts';
import { createOperation, transitionOperation } from '../packages/chain-adapter/src/lifecycle.ts';
import {
  deploymentManifestDigest,
  validateDeploymentManifest,
} from '../packages/chain-adapter/src/manifest.ts';
import type { ReadonlyRpc } from '../packages/chain-adapter/src/rpc.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../packages/chain-adapter/src/pass-abi.ts';
import { asAddress, asBlockHash, asHexData, asTransactionHash } from '../packages/chain-adapter/src/types.ts';
import { encodeM3VaultCall, M3_VAULT_ABI_HASH } from '../packages/chain-adapter/src/vault-abi.ts';

const CHAIN_ID = 46_630;
const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const OTHER_OWNER = asAddress('0x3333333333333333333333333333333333333333');
const CONTRACT = asAddress('0x2222222222222222222222222222222222222222');
const OTHER_CONTRACT = asAddress('0x4444444444444444444444444444444444444444');
const STRATEGY_PASS = asAddress('0x6666666666666666666666666666666666666666');
const OTHER_STRATEGY_PASS = asAddress('0x7777777777777777777777777777777777777777');
const TX_HASH = asTransactionHash(`0x${'aa'.repeat(32)}`);
const OTHER_TX_HASH = asTransactionHash(`0x${'dd'.repeat(32)}`);
const BLOCK_HASH = asBlockHash(`0x${'bb'.repeat(32)}`);
const PARENT_HASH = asBlockHash(`0x${'cc'.repeat(32)}`);
const env = { QP_MODE: 'local', QP_ADAPTER: 'mock' };
const origin = 'http://127.0.0.1:4180';
const headers = { host: '127.0.0.1:4180' };
const manifestBody = {
  schemaVersion: 1,
  environment: 'robinhood-chain-testnet',
  chainId: CHAIN_ID,
  contractName: 'AlphaForgeVault',
  contractType: 'vault',
  contractAddress: CONTRACT,
  deploymentBlock: '1',
  abiVersion: 'm3-vault-db620d6',
  abiHash: M3_VAULT_ABI_HASH,
  runtimeBytecodeHash: asBlockHash(`0x${'99'.repeat(32)}`),
  strategyPassAddress: STRATEGY_PASS,
  strategyPassDeploymentBlock: '1',
  strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
  strategyPassRuntimeBytecodeHash: asBlockHash(`0x${'88'.repeat(32)}`),
} as const;
const manifestDigest = deploymentManifestDigest(manifestBody);
const manifest = validateDeploymentManifest(
  { ...manifestBody, manifestDigest },
  { environment: 'robinhood-chain-testnet', chainId: CHAIN_ID, manifestDigest, contractAddress: CONTRACT },
);

class InertRpc implements ReadonlyRpc {
  async chainId() {
    return CHAIN_ID;
  }
  async block() {
    return null;
  }
  async receipt() {
    return null;
  }
  async logs() {
    return [];
  }
  async code() {
    return asHexData('0x6000');
  }
  async call() {
    return asHexData('0x');
  }
}

async function folder() {
  await mkdir('.checks', { recursive: true });
  return mkdtemp(resolve('.checks/chain-api-'));
}

function submitted(operationId: string) {
  return transitionOperation(
    createOperation({
      operationId,
      chainId: CHAIN_ID,
      owner: OWNER,
      target: CONTRACT,
      state: 'AWAITING_SIGNATURE',
    }),
    { state: 'SUBMITTED', txHash: TX_HASH, submittedAt: '2026-09-19T12:00:00.000Z' },
  );
}

test('chain route registration rejects ambiguous or malformed runtime identities', async () => {
  const directory = await folder();
  const runtime = new M3ChainRuntime({
    dbPath: resolve(directory, 'chain.sqlite'),
    rpc: new InertRpc(),
    manifest,
  });
  const base = runtime.chainEvidence;
  const { passProjectionKey, ...withoutPassProjection } = base;
  assert.equal(passProjectionKey, 'm3-strategy-pass');
  const cases: ReadonlyArray<readonly [unknown, RegExp]> = [
    [[], /INVALID_CHAIN_RUNTIME_SET/],
    [[{ ...base, projectionKey: 'bad/key' }], /INVALID_PROJECTION_KEY/],
    [[base, { ...base }], /DUPLICATE_CHAIN_RUNTIME/],
    [[withoutPassProjection], /INVALID_CHAIN_RUNTIME_SET/],
    [[{ ...base, passProjectionKey: 'bad/key' }], /INVALID_PROJECTION_KEY/],
    [[{ ...base, passContract: base.contract }], /DUPLICATE_CHAIN_RUNTIME/],
  ];
  for (const [input, expectedError] of cases) {
    const app = Fastify();
    assert.throws(
      () =>
        registerChainEvidenceRoutes(
          app,
          input as ChainEvidenceRoutesOptions | readonly ChainEvidenceRoutesOptions[],
        ),
      expectedError,
    );
    await app.close();
  }
  runtime.close();
});

test('server exposes its canonical operation evidence and hides owner mismatches as not found', async (t) => {
  const directory = await folder();
  const runtime = new M3ChainRuntime({
    dbPath: resolve(directory, 'chain.sqlite'),
    rpc: new InertRpc(),
    manifest,
  });
  const chainStore = runtime.store;
  chainStore.saveOperation(submitted('operation-api'));
  const { app } = await buildApp({
    dbPath: resolve(directory, 'ledger.sqlite'),
    env,
    origin,
    chainRuntime: runtime,
  });
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    url: `/api/v1/chain/operations/operation-api/evidence?owner=${OWNER}`,
    headers,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    operationId: 'operation-api',
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
  });

  for (const url of [
    `/api/v1/chain/operations/operation-api/evidence?owner=${OTHER_OWNER}`,
    `/api/v1/chain/operations/missing/evidence?owner=${OWNER}`,
  ]) {
    const absent = await app.inject({ url, headers });
    assert.equal(absent.statusCode, 404);
    assert.equal(absent.json().error, 'CHAIN_OPERATION_NOT_FOUND');
  }
});

test('degraded indexer evidence remains readable and cannot claim product readiness', async (t) => {
  const directory = await folder();
  const runtime = new M3ChainRuntime({
    dbPath: resolve(directory, 'chain.sqlite'),
    rpc: new InertRpc(),
    manifest,
  });
  const chainStore = runtime.store;
  chainStore.recordCanonicalBlock(
    CHAIN_ID,
    CONTRACT,
    { number: 1n, hash: BLOCK_HASH, parentHash: PARENT_HASH, timestamp: 1n },
    [],
  );
  chainStore.saveOperation(submitted('operation-degraded-api'));
  chainStore.markSyncUnhealthy(CHAIN_ID, CONTRACT, 'CHAIN_REORG_DEPTH_EXCEEDED');
  const { app } = await buildApp({
    dbPath: resolve(directory, 'ledger.sqlite'),
    env,
    origin,
    chainRuntime: runtime,
  });
  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    url: `/api/v1/chain/operations/operation-degraded-api/evidence?owner=${OWNER}`,
    headers,
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().indexerStatus, 'DEGRADED');
  assert.equal(response.json().degradedReason, 'CHAIN_REORG_DEPTH_EXCEEDED');
  assert.equal(response.json().projection, 'STALE');
  assert.equal(response.json().productReady, false);
});

test('operation evidence fails closed after the runtime synchronization attempt fails', async (t) => {
  const directory = await folder();
  const runtime = new M3ChainRuntime({
    dbPath: resolve(directory, 'chain.sqlite'),
    rpc: new InertRpc(),
    manifest,
  });
  runtime.store.saveOperation(submitted('operation-failed-sync'));
  await assert.rejects(() => runtime.syncToHead(), /M3_DEPLOYMENT_CODE_MISMATCH/);
  const { app } = await buildApp({
    dbPath: resolve(directory, 'ledger.sqlite'),
    env,
    origin,
    chainRuntime: runtime,
  });
  t.after(async () => app.close());

  const response = await app.inject({
    url: `/api/v1/chain/operations/operation-failed-sync/evidence?owner=${OWNER}`,
    headers,
  });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().error, 'CHAIN_PROJECTION_UNAVAILABLE');
});

test('operation evidence returns not found when the matched operation disappears before snapshot read', async (t) => {
  const directory = await folder();
  const runtime = new M3ChainRuntime({
    dbPath: resolve(directory, 'chain.sqlite'),
    rpc: new InertRpc(),
    manifest,
  });
  runtime.store.saveOperation(submitted('operation-deleted-before-evidence'));
  const originalOperation = runtime.store.operation.bind(runtime.store);
  let firstRead = true;
  Object.defineProperty(runtime.store, 'operation', {
    configurable: true,
    value(operationId: string) {
      const operation = originalOperation(operationId);
      if (firstRead && operation) {
        firstRead = false;
        runtime.store.db.prepare('DELETE FROM chain_transactions WHERE operation_id = ?').run(operationId);
      }
      return operation;
    },
  });
  const { app } = await buildApp({
    dbPath: resolve(directory, 'ledger.sqlite'),
    env,
    origin,
    chainRuntime: runtime,
  });
  t.after(async () => app.close());

  const response = await app.inject({
    url: `/api/v1/chain/operations/operation-deleted-before-evidence/evidence?owner=${OWNER}`,
    headers,
  });
  assert.equal(response.statusCode, 404, response.body);
  assert.equal(response.json().error, 'CHAIN_OPERATION_NOT_FOUND');
});

test('same-process runtime exposes a recoverable owner projection without a demo identity', async (t) => {
  const directory = await folder();
  const runtime = new M3ChainRuntime({
    dbPath: resolve(directory, 'chain.sqlite'),
    rpc: new InertRpc(),
    manifest,
  });
  const chainStore = runtime.store;
  const block = { number: 1n, hash: BLOCK_HASH, parentHash: PARENT_HASH, timestamp: 1n };
  chainStore.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
  chainStore.commitProjections(CHAIN_ID, CONTRACT, block, [
    {
      chainId: CHAIN_ID,
      owner: OWNER,
      contract: CONTRACT,
      projectionKey: 'm3-vault',
      blockNumber: 1n,
      blockHash: BLOCK_HASH,
      state: { principalBasis: '1000000', closed: false },
    },
  ]);
  const { app } = await buildApp({
    dbPath: resolve(directory, 'ledger.sqlite'),
    env,
    origin,
    chainRuntime: runtime,
  });
  t.after(async () => app.close());

  const response = await app.inject({ url: `/api/v1/chain/vaults/${OWNER}`, headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    chainId: CHAIN_ID,
    owner: OWNER,
    contract: CONTRACT,
    projectionKey: 'm3-vault',
    blockNumber: '1',
    blockHash: BLOCK_HASH,
    state: { closed: false, principalBasis: '1000000' },
  });
  const absent = await app.inject({ url: `/api/v1/chain/vaults/${OTHER_OWNER}`, headers });
  assert.equal(absent.statusCode, 404);
  assert.equal(absent.json().error, 'CHAIN_PROJECTION_NOT_FOUND');
});

test('Vault projection is unavailable before the first canonical synchronization', async (t) => {
  const directory = await folder();
  const runtime = new M3ChainRuntime({
    dbPath: resolve(directory, 'chain.sqlite'),
    rpc: new InertRpc(),
    manifest,
  });
  const { app } = await buildApp({
    dbPath: resolve(directory, 'ledger.sqlite'),
    env,
    origin,
    chainRuntime: runtime,
  });
  t.after(async () => app.close());
  const response = await app.inject({ url: `/api/v1/chain/vaults/${OWNER}`, headers });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, 'CHAIN_PROJECTION_UNAVAILABLE');
});

test('submission API accepts only pending identity and rejects forged state or conflicts', async (t) => {
  const directory = await folder();
  const runtime = new M3ChainRuntime({
    dbPath: resolve(directory, 'chain.sqlite'),
    rpc: new InertRpc(),
    manifest,
    now: () => '2026-09-20T00:00:00.000Z',
  });
  const { app } = await buildApp({
    dbPath: resolve(directory, 'ledger.sqlite'),
    env,
    origin,
    chainRuntime: runtime,
  });
  t.after(async () => app.close());
  const body = {
    operationId: 'submitted-via-api',
    chainId: CHAIN_ID,
    owner: OWNER,
    target: CONTRACT,
    calldata: encodeM3VaultCall('deposit(uint256)', [1_000_000n]),
    txHash: TX_HASH,
  };
  const request = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/chain/operations',
      headers: { ...headers, origin, 'x-quantpass-demo': '1' },
      payload,
    });
  const created = await request(body);
  assert.equal(created.statusCode, 202, created.body);
  assert.deepEqual(created.json(), {
    operationId: body.operationId,
    chainId: CHAIN_ID,
    owner: OWNER,
    target: CONTRACT,
    calldata: body.calldata,
    state: 'SUBMITTED',
    txHash: TX_HASH,
    submittedAt: '2026-09-20T00:00:00.000Z',
  });
  assert.deepEqual((await request(body)).json(), created.json());

  const conflict = await request({ ...body, txHash: asTransactionHash(`0x${'dd'.repeat(32)}`) });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, 'CHAIN_OPERATION_CONFLICT');

  const duplicateTransaction = await request({ ...body, operationId: 'different-operation-id' });
  assert.equal(duplicateTransaction.statusCode, 409, duplicateTransaction.body);
  assert.equal(duplicateTransaction.json().error, 'CHAIN_OPERATION_CONFLICT');

  const wrongOrigin = await app.inject({
    method: 'POST',
    url: '/api/v1/chain/operations',
    headers: { ...headers, origin: 'http://localhost:9999', 'x-quantpass-demo': '1' },
    payload: { ...body, operationId: 'wrong-origin' },
  });
  assert.equal(wrongOrigin.statusCode, 403);

  const missingWriteHeader = await app.inject({
    method: 'POST',
    url: '/api/v1/chain/operations',
    headers: { ...headers, origin },
    payload: { ...body, operationId: 'missing-write-header' },
  });
  assert.equal(missingWriteHeader.statusCode, 403);

  const withoutTxHash = {
    operationId: body.operationId,
    chainId: body.chainId,
    owner: body.owner,
    target: body.target,
    calldata: body.calldata,
  };
  for (const forged of [
    { ...body, state: 'CONFIRMED' },
    { ...body, productReady: true },
    { ...body, receipt: { status: 'SUCCESS' } },
    { ...body, submittedAt: '2026-09-20T00:00:00.000Z' },
    {
      ...withoutTxHash,
      operationId: 'submission-ambiguous',
      submissionStatus: 'SUBMISSION_AMBIGUOUS',
    },
  ]) {
    const rejected = await request(forged);
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error, 'INVALID_REQUEST');
  }
  assert.equal(runtime.store.operation('submission-ambiguous'), null);
});

test('runtime status exposes fixed deployment identity and database health without private paths', async (t) => {
  const directory = await folder();
  const runtime = new M3ChainRuntime({
    dbPath: resolve(directory, 'private-chain.sqlite'),
    rpc: new InertRpc(),
    manifest,
  });
  const { app } = await buildApp({
    dbPath: resolve(directory, 'private-ledger.sqlite'),
    env,
    origin,
    chainRuntime: runtime,
  });
  t.after(async () => app.close());

  const response = await app.inject({ url: '/api/v1/chain/runtime-status', headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    lastAttempt: 'NOT_RUN',
    errorCode: null,
    database: { status: 'HEALTHY', schemaVersion: 6, integrity: 'OK' },
    deployment: {
      chainId: CHAIN_ID,
      contract: CONTRACT,
      manifestDigest,
      abiHash: M3_VAULT_ABI_HASH,
      runtimeBytecodeHash: manifest.runtimeBytecodeHash,
      strategyPassAddress: STRATEGY_PASS,
      strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
      strategyPassRuntimeBytecodeHash: manifest.strategyPassRuntimeBytecodeHash,
    },
  });
  assert.doesNotMatch(response.body, /private-chain|private-ledger|\.sqlite/);
});

test('multi-Vault API isolates contract, wallet and strategy state and requires explicit Vault selection', async (t) => {
  const directory = await folder();
  const dbPath = resolve(directory, 'shared-chain.sqlite');
  const otherManifestBody = {
    ...manifestBody,
    contractAddress: OTHER_CONTRACT,
    strategyPassAddress: OTHER_STRATEGY_PASS,
  };
  const otherManifestDigest = deploymentManifestDigest(otherManifestBody);
  const otherManifest = validateDeploymentManifest(
    { ...otherManifestBody, manifestDigest: otherManifestDigest },
    {
      environment: 'robinhood-chain-testnet',
      chainId: CHAIN_ID,
      manifestDigest: otherManifestDigest,
      contractAddress: OTHER_CONTRACT,
    },
  );
  const first = new M3ChainRuntime({ dbPath, rpc: new InertRpc(), manifest });
  const second = new M3ChainRuntime({ dbPath, rpc: new InertRpc(), manifest: otherManifest });
  const block = { number: 1n, hash: BLOCK_HASH, parentHash: PARENT_HASH, timestamp: 1n };
  first.store.recordCanonicalBlock(CHAIN_ID, CONTRACT, block, []);
  first.store.commitProjections(CHAIN_ID, CONTRACT, block, [
    {
      chainId: CHAIN_ID,
      owner: OWNER,
      contract: CONTRACT,
      projectionKey: 'm3-vault',
      blockNumber: 1n,
      blockHash: BLOCK_HASH,
      state: { strategyId: 'trend', principalBasis: '1000000' },
    },
  ]);
  second.store.recordCanonicalBlock(CHAIN_ID, OTHER_CONTRACT, block, []);
  second.store.commitProjections(CHAIN_ID, OTHER_CONTRACT, block, [
    {
      chainId: CHAIN_ID,
      owner: OTHER_OWNER,
      contract: OTHER_CONTRACT,
      projectionKey: 'm3-vault',
      blockNumber: 1n,
      blockHash: BLOCK_HASH,
      state: { strategyId: 'yield', principalBasis: '2000000' },
    },
  ]);
  const multiOptions = {
    dbPath: resolve(directory, 'ledger.sqlite'),
    env,
    origin,
    chainRuntimes: [first, second],
  } as Parameters<typeof buildM3App>[0];
  await assert.rejects(
    () =>
      buildM3App({
        ...multiOptions,
        dbPath: resolve(directory, 'empty-ledger.sqlite'),
        chainRuntimes: [],
      }),
    /INVALID_CHAIN_RUNTIME_SET/,
  );
  await assert.rejects(
    () =>
      buildM3App({
        ...multiOptions,
        dbPath: resolve(directory, 'conflicting-ledger.sqlite'),
        chainRuntime: first,
      } as Parameters<typeof buildM3App>[0]),
    /INVALID_CHAIN_RUNTIME_SET/,
  );
  await assert.rejects(
    () =>
      buildM3App({
        ...multiOptions,
        dbPath: resolve(directory, 'duplicate-ledger.sqlite'),
        chainRuntimes: [first, first],
      }),
    /DUPLICATE_CHAIN_RUNTIME/,
  );
  const { app } = await buildM3App(multiOptions);
  t.after(async () => {
    await app.close();
    first.close();
    second.close();
  });

  const firstRead = await app.inject({
    url: `/api/v1/chain/vaults/${CONTRACT}/${OWNER}`,
    headers,
  });
  assert.equal(firstRead.statusCode, 200, firstRead.body);
  assert.equal(firstRead.json().state.strategyId, 'trend');
  const secondRead = await app.inject({
    url: `/api/v1/chain/vaults/${OTHER_CONTRACT}/${OTHER_OWNER}`,
    headers,
  });
  assert.equal(secondRead.statusCode, 200, secondRead.body);
  assert.equal(secondRead.json().state.strategyId, 'yield');
  assert.equal(
    (
      await app.inject({
        url: `/api/v1/chain/vaults/${OTHER_CONTRACT}/${OWNER}`,
        headers,
      })
    ).statusCode,
    404,
  );

  const ambiguous = await app.inject({ url: `/api/v1/chain/vaults/${OWNER}`, headers });
  assert.equal(ambiguous.statusCode, 400, ambiguous.body);
  assert.equal(ambiguous.json().error, 'INVALID_REQUEST');

  const submitted = await app.inject({
    method: 'POST',
    url: '/api/v1/chain/operations',
    headers: { ...headers, origin, 'x-quantpass-demo': '1' },
    payload: {
      operationId: 'other-vault-close',
      chainId: CHAIN_ID,
      owner: OTHER_OWNER,
      target: OTHER_CONTRACT,
      calldata: encodeM3VaultCall('close()', []),
      txHash: OTHER_TX_HASH,
    },
  });
  assert.equal(submitted.statusCode, 202, submitted.body);
  assert.equal(submitted.json().target, OTHER_CONTRACT);
  assert.equal(second.store.operation('other-vault-close')?.target, OTHER_CONTRACT);

  const unconfigured = await app.inject({
    method: 'POST',
    url: '/api/v1/chain/operations',
    headers: { ...headers, origin, 'x-quantpass-demo': '1' },
    payload: {
      operationId: 'unconfigured-vault',
      chainId: CHAIN_ID,
      owner: OWNER,
      target: OWNER,
      calldata: encodeM3VaultCall('close()', []),
      txHash: asTransactionHash(`0x${'ee'.repeat(32)}`),
    },
  });
  assert.equal(unconfigured.statusCode, 400, unconfigured.body);
  assert.equal(unconfigured.json().error, 'CHAIN_SUBMISSION_INVALID');

  const otherStatus = await app.inject({
    url: `/api/v1/chain/runtime-status/${OTHER_CONTRACT}`,
    headers,
  });
  assert.equal(otherStatus.statusCode, 200, otherStatus.body);
  assert.equal(otherStatus.json().deployment.contract, OTHER_CONTRACT);
  for (const url of [
    `/api/v1/chain/runtime-status/${OWNER}`,
    `/api/v1/chain/vaults/${OWNER}/${OWNER}`,
    `/api/v1/chain/passes/${OWNER}/${OWNER}`,
  ]) {
    const missing = await app.inject({ url, headers });
    assert.equal(missing.statusCode, 404, missing.body);
    assert.equal(missing.json().error, 'CHAIN_PROJECTION_NOT_FOUND');
  }
  const statusList = await app.inject({ url: '/api/v1/chain/runtime-status', headers });
  assert.equal(statusList.statusCode, 200, statusList.body);
  assert.deepEqual(
    statusList
      .json()
      .runtimes.map((status: { deployment: { contract: string } }) => status.deployment.contract),
    [CONTRACT, OTHER_CONTRACT],
  );
});
