import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { M3ChainRuntime, composeM3ChainRuntime } from '../apps/server/src/m3-chain-runtime.ts';
import {
  deploymentManifestDigest,
  validateDeploymentManifest,
} from '../packages/chain-adapter/src/manifest.ts';
import type { ReadonlyRpc } from '../packages/chain-adapter/src/rpc.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../packages/chain-adapter/src/pass-abi.ts';
import { keccak256 } from '../packages/chain-adapter/src/keccak.ts';
import { encodeM3VaultCall, M3_VAULT_ABI_HASH } from '../packages/chain-adapter/src/vault-abi.ts';
import { asAddress, asBlockHash, asHexData, asTransactionHash } from '../packages/chain-adapter/src/types.ts';

const CONTRACT = asAddress('0x2222222222222222222222222222222222222222');
const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const PASS = asAddress('0x4444444444444444444444444444444444444444');
const RECIPIENT = asAddress('0x5555555555555555555555555555555555555555');
const TX = asTransactionHash(`0x${'aa'.repeat(32)}`);
const manifestBody = {
  schemaVersion: 1,
  environment: 'robinhood-chain-testnet',
  chainId: 46_630,
  contractName: 'AlphaForgeVault',
  contractType: 'vault',
  contractAddress: CONTRACT,
  deploymentBlock: '100',
  abiVersion: 'm3-vault-db620d6',
  abiHash: M3_VAULT_ABI_HASH,
  runtimeBytecodeHash: asBlockHash(`0x${'99'.repeat(32)}`),
  strategyPassAddress: PASS,
  strategyPassDeploymentBlock: '90',
  strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
  strategyPassRuntimeBytecodeHash: asBlockHash(`0x${'88'.repeat(32)}`),
} as const;
const manifestDigest = deploymentManifestDigest(manifestBody);
const manifest = validateDeploymentManifest(
  { ...manifestBody, manifestDigest },
  { environment: 'robinhood-chain-testnet', chainId: 46_630, manifestDigest, contractAddress: CONTRACT },
);

class InertRpc implements ReadonlyRpc {
  async chainId() {
    return 46_630;
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

test('runtime rejects live bytecode that does not match the trusted manifest before indexing', async () => {
  const runtime = new M3ChainRuntime({ dbPath: await path(), rpc: new InertRpc(), manifest });
  await assert.rejects(() => runtime.syncToHead(), /M3_DEPLOYMENT_CODE_MISMATCH/);
  assert.equal(runtime.store.checkpoint(manifest.chainId, manifest.contractAddress), null);
  runtime.close();
});

test('runtime rejects a wrong chain before code reads or projection writes', async () => {
  class WrongChainRpc extends InertRpc {
    codeReads = 0;
    override async chainId() {
      return 1;
    }
    override async code() {
      this.codeReads++;
      return asHexData('0x6000');
    }
  }
  const rpc = new WrongChainRpc();
  const runtime = new M3ChainRuntime({ dbPath: await path(), rpc, manifest });
  await assert.rejects(() => runtime.syncToHead(), /M3_DEPLOYMENT_CHAIN_MISMATCH/);
  assert.equal(rpc.codeReads, 0);
  assert.equal(runtime.store.checkpoint(manifest.chainId, manifest.contractAddress), null);
  assert.equal(runtime.store.checkpoint(manifest.chainId, manifest.strategyPassAddress), null);
  assert.throws(
    () => runtime.configureStrategyPassProjectionOwnership(false),
    /M3_STRATEGY_PASS_OWNERSHIP_LOCKED/,
  );
  runtime.close();
});

test('runtime locks deterministic Pass ownership before accepting submissions', async () => {
  const runtime = new M3ChainRuntime({ dbPath: await path(), rpc: new InertRpc(), manifest });
  runtime.configureStrategyPassProjectionOwnership(false);
  assert.equal(runtime.chainEvidence.passContract, undefined);
  assert.throws(
    () =>
      runtime.recordSubmission({
        operationId: 'follower-pass-transfer',
        chainId: 46_630,
        owner: OWNER,
        target: PASS,
        calldata: asHexData(`0xa9059cbb${RECIPIENT.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}`),
        txHash: asTransactionHash(`0x${'ef'.repeat(32)}`),
      }),
    /INVALID_M3_WALLET_SUBMISSION/,
  );
  assert.throws(
    () => runtime.configureStrategyPassProjectionOwnership(true),
    /M3_STRATEGY_PASS_OWNERSHIP_LOCKED/,
  );
  runtime.close();
});

test('runtime rejects mismatched StrategyPass bytecode before indexing either contract', async () => {
  const vaultCode = asHexData('0x6000');
  const expectedPassCode = asHexData('0x6001');
  const exactBody = {
    ...manifestBody,
    runtimeBytecodeHash: keccak256(vaultCode),
    strategyPassRuntimeBytecodeHash: keccak256(expectedPassCode),
  };
  const exactDigest = deploymentManifestDigest(exactBody);
  const exactManifest = validateDeploymentManifest(
    { ...exactBody, manifestDigest: exactDigest },
    {
      environment: 'robinhood-chain-testnet',
      chainId: 46_630,
      manifestDigest: exactDigest,
      contractAddress: CONTRACT,
    },
  );
  const runtime = new M3ChainRuntime({ dbPath: await path(), rpc: new InertRpc(), manifest: exactManifest });
  await assert.rejects(() => runtime.syncToHead(), /M3_STRATEGY_PASS_CODE_MISMATCH/);
  assert.equal(runtime.store.checkpoint(exactManifest.chainId, exactManifest.contractAddress), null);
  assert.equal(runtime.store.checkpoint(exactManifest.chainId, exactManifest.strategyPassAddress), null);
  runtime.close();
});

test('runtime records exact manifest-bound StrategyPass transfer without capacity rounding', async () => {
  const runtime = new M3ChainRuntime({ dbPath: await path(), rpc: new InertRpc(), manifest });
  const calldata = asHexData(`0xa9059cbb${RECIPIENT.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}`);
  const operation = runtime.recordSubmission({
    operationId: 'pass-transfer-one-wei',
    chainId: 46_630,
    owner: OWNER,
    target: PASS,
    calldata,
    txHash: asTransactionHash(`0x${'cc'.repeat(32)}`),
  });
  assert.equal(operation.state, 'SUBMITTED');
  assert.equal(operation.target, PASS);
  assert.equal(operation.calldata, calldata);
  assert.throws(
    () =>
      runtime.recordSubmission({
        operationId: 'pass-transfer-wrong-target',
        chainId: 46_630,
        owner: OWNER,
        target: RECIPIENT,
        calldata,
        txHash: asTransactionHash(`0x${'dd'.repeat(32)}`),
      }),
    /INVALID_M3_WALLET_SUBMISSION/,
  );
  runtime.close();
});

async function path() {
  await mkdir('.checks', { recursive: true });
  const directory = await mkdtemp(resolve('.checks/m3-runtime-'));
  return resolve(directory, 'chain.sqlite');
}

test('M3 runtime owns one persistent store/synchronizer lifecycle and records only exact Vault calldata', async () => {
  const dbPath = await path();
  let runtime = new M3ChainRuntime({
    dbPath,
    rpc: new InertRpc(),
    manifest,
    now: () => '2026-09-19T12:00:00.000Z',
  });
  const calldata = encodeM3VaultCall('deposit(uint256)', [1_000_000n]);
  const submitted = runtime.recordSubmission({
    operationId: 'runtime-deposit-1',
    chainId: 46_630,
    owner: OWNER,
    target: CONTRACT,
    calldata,
    txHash: TX,
  });
  assert.equal(submitted.state, 'SUBMITTED');
  assert.equal(submitted.calldata, calldata);
  assert.deepEqual(
    runtime.recordSubmission({
      operationId: 'runtime-deposit-1',
      chainId: 46_630,
      owner: OWNER,
      target: CONTRACT,
      calldata,
      txHash: TX,
    }),
    submitted,
  );
  assert.throws(
    () =>
      runtime.recordSubmission({
        operationId: 'runtime-view',
        chainId: 46_630,
        owner: OWNER,
        target: CONTRACT,
        calldata: encodeM3VaultCall('owner()', []),
        txHash: asTransactionHash(`0x${'bb'.repeat(32)}`),
      }),
    /INVALID_M3_WALLET_SUBMISSION/,
  );
  runtime.close();

  runtime = new M3ChainRuntime({ dbPath, rpc: new InertRpc(), manifest });
  assert.equal(runtime.store.operation('runtime-deposit-1')?.calldata, calldata);
  assert.equal(runtime.chainEvidence.store, runtime.store);
  runtime.store.saveOperation({
    ...runtime.store.operation('runtime-deposit-1')!,
    operationId: 'runtime-conflict',
    chainId: 1,
  });
  assert.throws(
    () =>
      runtime.recordSubmission({
        operationId: 'runtime-conflict',
        chainId: 46_630,
        owner: OWNER,
        target: CONTRACT,
        calldata,
        txHash: TX,
      }),
    /OPERATION_IDENTITY_CONFLICT/,
  );
  runtime.close();
});

test('deployment-aware composition stays disabled without evidence and validates the exact ABI before startup', async () => {
  assert.equal(composeM3ChainRuntime({ deploymentStatus: 'NOT_DEPLOYED' }), null);
  const dbPath = await path();
  const runtime = composeM3ChainRuntime({
    deploymentStatus: 'DEPLOYED',
    dbPath,
    rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
    manifestDocument: { ...manifestBody, manifestDigest },
    expectedManifestDigest: manifestDigest,
    expectedContractAddress: CONTRACT,
  });
  assert.ok(runtime instanceof M3ChainRuntime);
  assert.equal(runtime.manifest.abiVersion, 'm3-vault-db620d6');
  runtime.close();

  const wrongBody = { ...manifestBody, abiVersion: 'other-reviewed-abi' };
  const wrongDigest = deploymentManifestDigest(wrongBody);
  const wrongDbPath = await path();
  assert.throws(
    () =>
      composeM3ChainRuntime({
        deploymentStatus: 'DEPLOYED',
        dbPath: wrongDbPath,
        rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
        manifestDocument: { ...wrongBody, manifestDigest: wrongDigest },
        expectedManifestDigest: wrongDigest,
        expectedContractAddress: CONTRACT,
      }),
    /M3_VAULT_ABI_MISMATCH/,
  );
});
