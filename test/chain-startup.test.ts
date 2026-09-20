import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startM3Server, type M3ServerStartupOptions } from '../apps/server/src/m3-startup.ts';
import {
  deploymentManifestDigest,
  type DeploymentManifestDocument,
} from '../packages/chain-adapter/src/manifest.ts';
import type {
  ChainBlock,
  ChainCall,
  ChainCallBlock,
  ChainLog,
  ChainLogFilter,
  ChainReceipt,
  ReadonlyRpc,
} from '../packages/chain-adapter/src/rpc.ts';
import { keccak256 } from '../packages/chain-adapter/src/keccak.ts';
import {
  encodeM3StrategyPassTransfer,
  M3_STRATEGY_PASS_ABI_HASH,
  M3_STRATEGY_PASS_TRANSFER_TOPIC,
} from '../packages/chain-adapter/src/pass-abi.ts';
import {
  M3_VAULT_ABI_HASH,
  M3_VAULT_REVIEW_ABI,
  encodeM3VaultCall,
} from '../packages/chain-adapter/src/vault-abi.ts';
import { transitionOperation } from '../packages/chain-adapter/src/lifecycle.ts';
import {
  asAddress,
  asBlockHash,
  asHexData,
  asTransactionHash,
  type Address,
  type HexData,
} from '../packages/chain-adapter/src/types.ts';

const CHAIN_ID = 46_630;
const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const CONTRACT = asAddress('0x2222222222222222222222222222222222222222');
const CREATOR = asAddress('0x3333333333333333333333333333333333333333');
const PASS = asAddress('0x4444444444444444444444444444444444444444');
const USDC = asAddress('0x5555555555555555555555555555555555555555');
const ETH = asAddress('0x6666666666666666666666666666666666666666');
const BTC = asAddress('0x7777777777777777777777777777777777777777');
const LOCKER = asAddress('0x8888888888888888888888888888888888888888');
const TX = asTransactionHash(`0x${'aa'.repeat(32)}`);
const BAD_TX = asTransactionHash(`0x${'bb'.repeat(32)}`);
const PASS_TX = asTransactionHash(`0x${'cc'.repeat(32)}`);
const RECIPIENT = asAddress('0x9999999999999999999999999999999999999999');
const SECOND_OWNER = asAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const SECOND_CONTRACT = asAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const SECOND_PASS = asAddress('0xcccccccccccccccccccccccccccccccccccccccc');
const STRATEGY_ID = asHexData(`0x${'11'.repeat(32)}`);
const SECOND_STRATEGY_ID = asHexData(`0x${'33'.repeat(32)}`);
const STRATEGY_REF = asHexData(`0x${'22'.repeat(32)}`);
const RUNTIME_CODE = asHexData('0x6000');
const blocks = new Map<bigint, ChainBlock>(
  [1n, 2n, 3n].map((number) => [
    number,
    {
      number,
      hash: asBlockHash(`0x${Number(number).toString(16).padStart(64, '0')}`),
      parentHash: asBlockHash(
        `0x${Number(number - 1n)
          .toString(16)
          .padStart(64, '0')}`,
      ),
      timestamp: number,
    },
  ]),
);

const manifestBody: DeploymentManifestDocument = {
  schemaVersion: 1,
  environment: 'robinhood-chain-testnet',
  chainId: CHAIN_ID,
  contractName: 'AlphaForgeVault',
  contractType: 'vault',
  contractAddress: CONTRACT,
  deploymentBlock: '1',
  abiVersion: 'm3-vault-db620d6',
  abiHash: M3_VAULT_ABI_HASH,
  runtimeBytecodeHash: keccak256(RUNTIME_CODE),
  strategyPassAddress: PASS,
  strategyPassDeploymentBlock: '1',
  strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
  strategyPassRuntimeBytecodeHash: keccak256(RUNTIME_CODE),
};
const manifestDigest = deploymentManifestDigest(manifestBody);

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function addressWord(value: Address): HexData {
  return asHexData(`0x${value.slice(2).padStart(64, '0')}`);
}

class StartupRpc implements ReadonlyRpc {
  readonly latest: bigint;
  constructor(latest = 3n) {
    this.latest = latest;
  }
  calls = 0;
  receiptCalls = 0;
  readonly receiptHashes: string[] = [];
  async chainId() {
    return CHAIN_ID;
  }
  async code() {
    return RUNTIME_CODE;
  }
  async block(number: bigint | 'latest') {
    return blocks.get(number === 'latest' ? this.latest : number) ?? null;
  }
  async receipt(hash: typeof TX): Promise<ChainReceipt | null> {
    this.receiptCalls++;
    this.receiptHashes.push(hash);
    if (hash === BAD_TX) {
      const block = blocks.get(1n)!;
      return {
        transactionHash: BAD_TX,
        blockNumber: 1n,
        blockHash: block.hash,
        transactionIndex: 1,
        from: CREATOR,
        to: CONTRACT,
        status: 'SUCCESS',
        logs: [],
      };
    }
    if (hash !== TX) return null;
    const block = blocks.get(1n)!;
    return {
      transactionHash: TX,
      blockNumber: 1n,
      blockHash: block.hash,
      transactionIndex: 0,
      from: OWNER,
      to: CONTRACT,
      status: 'SUCCESS',
      logs: [this.depositLog()],
    };
  }
  async logs(filter: ChainLogFilter): Promise<readonly ChainLog[]> {
    return filter.address === CONTRACT && filter.fromBlock === 1n && filter.toBlock === 1n
      ? [this.depositLog()]
      : [];
  }
  depositLog(): ChainLog {
    const block = blocks.get(1n)!;
    return {
      address: CONTRACT,
      blockNumber: 1n,
      blockHash: block.hash,
      transactionHash: TX,
      transactionIndex: 0,
      logIndex: 0,
      data: asHexData(
        `0x${word(1_000_000n)}${word(1_000_000_000_000_000_000n)}${word(1_000_000n)}${word(1_000_000n)}`,
      ),
      topics: [
        M3_VAULT_REVIEW_ABI.eventTopics['Deposited(address,uint256,uint256,uint256,uint256)'],
        addressWord(OWNER),
      ],
      removed: false,
    };
  }
  async call(request: ChainCall, reference: ChainCallBlock): Promise<HexData> {
    this.calls++;
    if (typeof reference !== 'object') assert.fail('expected canonical block reference');
    assert.equal(reference.requireCanonical, true);
    const selector = request.data.slice(0, 10);
    if (request.to === PASS && selector === '0x492f4e18') return STRATEGY_ID;
    if (request.to === PASS && selector === '0x313ce567') return asHexData(`0x${word(18n)}`);
    assert.equal(request.to, CONTRACT);
    const addresses: Record<string, Address> = {
      '0x8da5cb5b': OWNER,
      '0x499bb2ab': CREATOR,
      '0xa7a1ed72': PASS,
      '0x8b5a851f': USDC,
      '0xf20173bc': ETH,
      '0xa8d937e9': BTC,
      '0xab88dc4b': LOCKER,
    };
    if (addresses[selector]) return addressWord(addresses[selector]);
    if (selector === '0x492f4e18') return STRATEGY_ID;
    if (selector === '0xc288f3de') return STRATEGY_REF;
    const values: Record<string, bigint> = {
      '0xad587035': 1_000_000n,
      '0x0510ca51': 1_000_000n,
      '0x738b74f0': 0n,
      '0x442ad6a0': 1_000_000n,
      '0x34dda870': 0n,
      '0xb31ede63': 0n,
      '0x597e1fb5': 0n,
    };
    if (values[selector] !== undefined) return asHexData(`0x${word(values[selector])}`);
    throw new Error('unexpected call');
  }
}

class StrategyPassStartupRpc extends StartupRpc {
  override async receipt(hash: typeof TX): Promise<ChainReceipt | null> {
    if (hash !== PASS_TX) return super.receipt(hash);
    const block = blocks.get(1n)!;
    return {
      transactionHash: PASS_TX,
      blockNumber: 1n,
      blockHash: block.hash,
      transactionIndex: 2,
      from: OWNER,
      to: PASS,
      status: 'SUCCESS',
      logs: [this.transferLog()],
    };
  }

  override async logs(filter: ChainLogFilter): Promise<readonly ChainLog[]> {
    if (filter.address === PASS && filter.fromBlock === 1n && filter.toBlock === 1n)
      return [this.transferLog()];
    return super.logs(filter);
  }

  transferLog(): ChainLog {
    const block = blocks.get(1n)!;
    return {
      address: PASS,
      blockNumber: 1n,
      blockHash: block.hash,
      transactionHash: PASS_TX,
      transactionIndex: 2,
      logIndex: 0,
      data: asHexData(`0x${word(1n)}`),
      topics: [M3_STRATEGY_PASS_TRANSFER_TOPIC, addressWord(OWNER), addressWord(RECIPIENT)],
      removed: false,
    };
  }

  override async call(request: ChainCall, reference: ChainCallBlock): Promise<HexData> {
    if (request.to !== PASS) return super.call(request, reference);
    if (typeof reference !== 'object') assert.fail('expected canonical block reference');
    assert.equal(reference.requireCanonical, true);
    const selector = request.data.slice(0, 10);
    if (selector === '0x313ce567') return asHexData(`0x${word(18n)}`);
    if (selector === '0x492f4e18') return STRATEGY_ID;
    if (selector === '0x70a08231') {
      const owner = asAddress(`0x${request.data.slice(-40)}`);
      return asHexData(`0x${word(owner === OWNER ? 999n : owner === RECIPIENT ? 1n : 0n)}`);
    }
    throw new Error('unexpected pass call');
  }
}

class IsolatedStartupRpc implements ReadonlyRpc {
  readonly contract: Address;
  readonly pass: Address;
  readonly owner: Address;
  readonly strategyId: HexData;
  readonly locker: Address;

  constructor(contract: Address, pass: Address, owner: Address, strategyId: HexData, locker = LOCKER) {
    this.contract = contract;
    this.pass = pass;
    this.owner = owner;
    this.strategyId = strategyId;
    this.locker = locker;
  }
  async chainId() {
    return CHAIN_ID;
  }
  async code() {
    return RUNTIME_CODE;
  }
  async block(number: bigint | 'latest') {
    return blocks.get(number === 'latest' ? 3n : number) ?? null;
  }
  async receipt(): Promise<ChainReceipt | null> {
    return null;
  }
  async logs(filter: ChainLogFilter): Promise<readonly ChainLog[]> {
    void filter;
    return [];
  }
  async call(request: ChainCall, reference: ChainCallBlock): Promise<HexData> {
    if (typeof reference !== 'object') assert.fail('expected canonical block reference');
    const selector = request.data.slice(0, 10);
    if (request.to === this.pass) {
      if (selector === '0x492f4e18') return this.strategyId;
      if (selector === '0x313ce567') return asHexData(`0x${word(18n)}`);
      if (selector === '0x70a08231') return asHexData(`0x${word(0n)}`);
      throw new Error('unexpected pass call');
    }
    assert.equal(request.to, this.contract);
    const addresses: Record<string, Address> = {
      '0x8da5cb5b': this.owner,
      '0x499bb2ab': CREATOR,
      '0xa7a1ed72': this.pass,
      '0x8b5a851f': USDC,
      '0xf20173bc': ETH,
      '0xa8d937e9': BTC,
      '0xab88dc4b': this.locker,
    };
    if (addresses[selector]) return addressWord(addresses[selector]);
    if (selector === '0x492f4e18') return this.strategyId;
    if (selector === '0xc288f3de') return STRATEGY_REF;
    if (
      [
        '0xad587035',
        '0x0510ca51',
        '0x738b74f0',
        '0x442ad6a0',
        '0x34dda870',
        '0xb31ede63',
        '0x597e1fb5',
      ].includes(selector)
    )
      return asHexData(`0x${word(0n)}`);
    throw new Error('unexpected Vault call');
  }
}

class SharedPassStartupRpc extends IsolatedStartupRpc {
  failSync = false;
  passLogCalls = 0;

  override async block(number: bigint | 'latest') {
    if (this.failSync && number === 'latest') throw new Error('shared pass owner unavailable');
    return super.block(number);
  }

  override async logs(filter: ChainLogFilter): Promise<readonly ChainLog[]> {
    if (filter.address !== PASS) return [];
    this.passLogCalls++;
    if (filter.fromBlock > 1n || filter.toBlock < 1n) return [];
    const block = blocks.get(1n)!;
    return [
      {
        address: PASS,
        blockNumber: 1n,
        blockHash: block.hash,
        transactionHash: TX,
        transactionIndex: 0,
        logIndex: 0,
        data: asHexData(`0x${word(1_000n)}`),
        topics: [
          M3_STRATEGY_PASS_TRANSFER_TOPIC,
          addressWord(asAddress('0x0000000000000000000000000000000000000000')),
          addressWord(OWNER),
        ],
        removed: false,
      },
      {
        address: PASS,
        blockNumber: 1n,
        blockHash: block.hash,
        transactionHash: PASS_TX,
        transactionIndex: 1,
        logIndex: 0,
        data: asHexData(`0x${word(400n)}`),
        topics: [M3_STRATEGY_PASS_TRANSFER_TOPIC, addressWord(OWNER), addressWord(SECOND_OWNER)],
        removed: false,
      },
    ];
  }

  override async call(request: ChainCall, reference: ChainCallBlock): Promise<HexData> {
    if (request.to === PASS && request.data.slice(0, 10) === '0x70a08231') {
      const owner = asAddress(`0x${request.data.slice(-40)}`);
      return asHexData(`0x${word(owner === OWNER ? 600n : owner === SECOND_OWNER ? 400n : 0n)}`);
    }
    return super.call(request, reference);
  }
}

async function directory() {
  await mkdir('.checks', { recursive: true });
  return mkdtemp(resolve('.checks/m3-startup-'));
}

test('default M3 server startup is executable and inert while deployment is NOT_DEPLOYED', async () => {
  const root = await directory();
  const server = await startM3Server(
    {
      deployment: { deploymentStatus: 'NOT_DEPLOYED' },
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      syncIntervalMs: null,
    },
    { createRpc: () => assert.fail('NOT_DEPLOYED must not create RPC') },
  );
  assert.equal(server.runtime, null);
  assert.equal(await server.syncNow(), null);
  assert.equal(
    (await server.app.inject({ url: '/api/health', headers: { host: '127.0.0.1:4180' } })).statusCode,
    200,
  );
  await server.close();
  await server.close();
  await assert.rejects(server.syncNow(), /M3_SERVER_CLOSED/);
});

test('deployed startup composes runtime, app, bounded sync and canonical API progression with injected RPC', async () => {
  const root = await directory();
  const rpc = new StartupRpc();
  const server = await startM3Server(
    {
      deployment: {
        deploymentStatus: 'DEPLOYED',
        dbPath: resolve(root, 'chain.sqlite'),
        rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
        manifestDocument: { ...manifestBody, manifestDigest },
        expectedManifestDigest: manifestDigest,
        expectedContractAddress: CONTRACT,
        maxBlocksPerSync: 3,
        now: () => '2026-09-20T00:00:00.000Z',
      },
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      syncIntervalMs: null,
    },
    { createRpc: () => rpc },
  );
  assert.ok(server.runtime);
  const body = {
    operationId: 'startup-deposit',
    chainId: CHAIN_ID,
    owner: OWNER,
    target: CONTRACT,
    calldata: encodeM3VaultCall('deposit(uint256)', [1_000_000n]),
    txHash: TX,
  };
  const submitted = await server.app.inject({
    method: 'POST',
    url: '/api/v1/chain/operations',
    headers: { host: '127.0.0.1:4180', origin: 'http://127.0.0.1:4180', 'x-quantpass-demo': '1' },
    payload: body,
  });
  assert.equal(submitted.statusCode, 202, submitted.body);
  await server.syncNow();
  const evidence = await server.app.inject({
    url: `/api/v1/chain/operations/startup-deposit/evidence?owner=${OWNER}`,
    headers: { host: '127.0.0.1:4180' },
  });
  assert.equal(evidence.statusCode, 200, evidence.body);
  assert.equal(evidence.json().lifecycle, 'CONFIRMED');
  assert.equal(evidence.json().productReady, true);
  assert.ok(rpc.calls >= 72);
  await server.close();
});

test('deployed startup composes and synchronizes two isolated Vault runtimes', async () => {
  const root = await directory();
  const secondManifestBody: DeploymentManifestDocument = {
    ...manifestBody,
    contractAddress: SECOND_CONTRACT,
    strategyPassAddress: SECOND_PASS,
  };
  const secondManifestDigest = deploymentManifestDigest(secondManifestBody);
  const servers = new Map<string, ReadonlyRpc>([
    [
      'https://rpc.testnet.chain.robinhood.com/first',
      new IsolatedStartupRpc(CONTRACT, PASS, OWNER, STRATEGY_ID),
    ],
    [
      'https://rpc.testnet.chain.robinhood.com/second',
      new IsolatedStartupRpc(SECOND_CONTRACT, SECOND_PASS, SECOND_OWNER, SECOND_STRATEGY_ID),
    ],
  ]);
  const server = await startM3Server(
    {
      deployments: [
        {
          deploymentStatus: 'DEPLOYED',
          dbPath: resolve(root, 'first-chain.sqlite'),
          rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com/first'],
          manifestDocument: { ...manifestBody, manifestDigest },
          expectedManifestDigest: manifestDigest,
          expectedContractAddress: CONTRACT,
        },
        {
          deploymentStatus: 'DEPLOYED',
          dbPath: resolve(root, 'second-chain.sqlite'),
          rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com/second'],
          manifestDocument: { ...secondManifestBody, manifestDigest: secondManifestDigest },
          expectedManifestDigest: secondManifestDigest,
          expectedContractAddress: SECOND_CONTRACT,
        },
      ],
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      syncIntervalMs: null,
    },
    {
      createRpc: (endpoints) => servers.get(endpoints[0]!) ?? assert.fail('unexpected RPC endpoint'),
    },
  );
  try {
    assert.equal(server.runtime, null);
    assert.equal(server.runtimes.length, 2);
    assert.deepEqual(await server.syncNow(), {
      scannedBlocks: 0,
      insertedEvents: 0,
      reorgedBlocks: 0,
      trackedOperations: 0,
      trackingFailures: 0,
    });
    const headers = { host: '127.0.0.1:4180' };
    const status = await server.app.inject({ url: '/api/v1/chain/runtime-status', headers });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().runtimes.length, 2);
    for (const [contract, owner] of [
      [CONTRACT, OWNER],
      [SECOND_CONTRACT, SECOND_OWNER],
    ] as const) {
      const projection = await server.app.inject({
        url: `/api/v1/chain/vaults/${contract}/${owner}`,
        headers,
      });
      assert.equal(projection.statusCode, 200, projection.body);
      assert.equal(projection.json().state.owner, owner);
    }
    assert.equal(
      (await server.app.inject({ url: `/api/v1/chain/vaults/${OWNER}`, headers })).statusCode,
      400,
    );
  } finally {
    await server.close();
  }
});

test('two Vault owners share one Pass sync owner while Vault state and operations stay isolated', async () => {
  const root = await directory();
  const secondLocker = asAddress('0xdddddddddddddddddddddddddddddddddddddddd');
  const secondManifestBody: DeploymentManifestDocument = {
    ...manifestBody,
    contractAddress: SECOND_CONTRACT,
  };
  const secondManifestDigest = deploymentManifestDigest(secondManifestBody);
  const primaryRpc = new SharedPassStartupRpc(CONTRACT, PASS, OWNER, STRATEGY_ID);
  const followerRpc = new SharedPassStartupRpc(
    SECOND_CONTRACT,
    PASS,
    SECOND_OWNER,
    STRATEGY_ID,
    secondLocker,
  );
  const servers = new Map<string, ReadonlyRpc>([
    ['https://rpc.testnet.chain.robinhood.com/first', primaryRpc],
    ['https://rpc.testnet.chain.robinhood.com/second', followerRpc],
  ]);
  const server = await startM3Server(
    {
      deployments: [
        {
          deploymentStatus: 'DEPLOYED',
          dbPath: resolve(root, 'second-chain.sqlite'),
          rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com/second'],
          manifestDocument: { ...secondManifestBody, manifestDigest: secondManifestDigest },
          expectedManifestDigest: secondManifestDigest,
          expectedContractAddress: SECOND_CONTRACT,
          now: () => '2026-09-20T00:00:00.000Z',
        },
        {
          deploymentStatus: 'DEPLOYED',
          dbPath: resolve(root, 'first-chain.sqlite'),
          rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com/first'],
          manifestDocument: { ...manifestBody, manifestDigest },
          expectedManifestDigest: manifestDigest,
          expectedContractAddress: CONTRACT,
          now: () => '2026-09-20T00:00:00.000Z',
        },
      ],
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      syncIntervalMs: null,
    },
    {
      createRpc: (endpoints) => servers.get(endpoints[0]!) ?? assert.fail('unexpected RPC endpoint'),
    },
  );
  try {
    const primary = server.runtimes.find((runtime) => runtime.manifest.contractAddress === CONTRACT);
    const follower = server.runtimes.find((runtime) => runtime.manifest.contractAddress === SECOND_CONTRACT);
    assert.ok(primary);
    assert.ok(follower);
    assert.ok(primary.store.checkpoint(CHAIN_ID, PASS));
    assert.equal(follower.store.checkpoint(CHAIN_ID, PASS), null);
    assert.ok(primaryRpc.passLogCalls > 0);
    assert.equal(followerRpc.passLogCalls, 0);

    const headers = { host: '127.0.0.1:4180' };
    for (const [contract, owner, locker] of [
      [CONTRACT, OWNER, LOCKER],
      [SECOND_CONTRACT, SECOND_OWNER, secondLocker],
    ] as const) {
      const projection = await server.app.inject({
        url: `/api/v1/chain/vaults/${contract}/${owner}`,
        headers,
      });
      assert.equal(projection.statusCode, 200, projection.body);
      assert.equal(projection.json().state.owner, owner);
      assert.equal(projection.json().state.pass, PASS);
      assert.equal(projection.json().state.passLocker, locker);
    }
    for (const [owner, balanceRaw] of [
      [OWNER, '600'],
      [SECOND_OWNER, '400'],
    ] as const) {
      const balance = await server.app.inject({
        url: `/api/v1/chain/passes/${PASS}/${owner}`,
        headers,
      });
      assert.equal(balance.statusCode, 200, balance.body);
      assert.equal(balance.json().state.owner, owner);
      assert.equal(balance.json().state.balanceRaw, balanceRaw);
    }

    for (const [operationId, owner, target, txHash] of [
      ['first-owner-close', OWNER, CONTRACT, TX],
      ['second-owner-close', SECOND_OWNER, SECOND_CONTRACT, BAD_TX],
    ] as const) {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/v1/chain/operations',
        headers: { ...headers, origin: 'http://127.0.0.1:4180', 'x-quantpass-demo': '1' },
        payload: {
          operationId,
          chainId: CHAIN_ID,
          owner,
          target,
          calldata: encodeM3VaultCall('close()', []),
          txHash,
        },
      });
      assert.equal(response.statusCode, 202, response.body);
    }
    assert.ok(primary.store.operation('first-owner-close'));
    assert.equal(follower.store.operation('first-owner-close'), null);
    assert.ok(follower.store.operation('second-owner-close'));
    assert.equal(primary.store.operation('second-owner-close'), null);

    const passSubmission = await server.app.inject({
      method: 'POST',
      url: '/api/v1/chain/operations',
      headers: { ...headers, origin: 'http://127.0.0.1:4180', 'x-quantpass-demo': '1' },
      payload: {
        operationId: 'second-owner-pass-transfer',
        chainId: CHAIN_ID,
        owner: SECOND_OWNER,
        target: PASS,
        calldata: encodeM3StrategyPassTransfer(RECIPIENT, 1n),
        txHash: PASS_TX,
      },
    });
    assert.equal(passSubmission.statusCode, 202, passSubmission.body);
    assert.ok(primary.store.operation('second-owner-pass-transfer'));
    assert.equal(follower.store.operation('second-owner-pass-transfer'), null);
    assert.equal(
      (
        await server.app.inject({
          url: `/api/v1/chain/operations/second-owner-pass-transfer/evidence?owner=${SECOND_OWNER}`,
          headers,
        })
      ).statusCode,
      200,
    );

    primaryRpc.failSync = true;
    await assert.rejects(server.syncNow(), /M3_RUNTIME_SYNC_FAILED/);
    const stalePass = await server.app.inject({
      url: `/api/v1/chain/passes/${PASS}/${OWNER}`,
      headers,
    });
    assert.equal(stalePass.statusCode, 503, stalePass.body);
    assert.equal(stalePass.json().error, 'CHAIN_PROJECTION_UNAVAILABLE');
  } finally {
    await server.close();
  }
});

test('shared Pass startup rejects conflicting deployment identity', async () => {
  const root = await directory();
  const conflictingManifestBody: DeploymentManifestDocument = {
    ...manifestBody,
    contractAddress: SECOND_CONTRACT,
    strategyPassDeploymentBlock: '2',
  };
  const conflictingManifestDigest = deploymentManifestDigest(conflictingManifestBody);
  await assert.rejects(
    startM3Server(
      {
        deployments: [
          {
            deploymentStatus: 'DEPLOYED',
            dbPath: resolve(root, 'first-chain.sqlite'),
            rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com/first'],
            manifestDocument: { ...manifestBody, manifestDigest },
            expectedManifestDigest: manifestDigest,
            expectedContractAddress: CONTRACT,
          },
          {
            deploymentStatus: 'DEPLOYED',
            dbPath: resolve(root, 'second-chain.sqlite'),
            rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com/second'],
            manifestDocument: {
              ...conflictingManifestBody,
              manifestDigest: conflictingManifestDigest,
            },
            expectedManifestDigest: conflictingManifestDigest,
            expectedContractAddress: SECOND_CONTRACT,
          },
        ],
        app: {
          dbPath: resolve(root, 'ledger.sqlite'),
          env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
          origin: 'http://127.0.0.1:4180',
        },
        syncIntervalMs: null,
      },
      { createRpc: () => new IsolatedStartupRpc(CONTRACT, PASS, OWNER, STRATEGY_ID) },
    ),
    /M3_SHARED_STRATEGY_PASS_IDENTITY_CONFLICT/,
  );
});

test('multi-runtime startup rejects empty, inactive and shared database sets', async () => {
  const root = await directory();
  const app = {
    dbPath: resolve(root, 'ledger.sqlite'),
    env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
    origin: 'http://127.0.0.1:4180',
  };
  const deployment = {
    deploymentStatus: 'DEPLOYED' as const,
    dbPath: resolve(root, 'shared-chain.sqlite'),
    rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
    manifestDocument: { ...manifestBody, manifestDigest },
    expectedManifestDigest: manifestDigest,
    expectedContractAddress: CONTRACT,
  };
  for (const deployments of [
    [],
    [{ deploymentStatus: 'NOT_DEPLOYED' as const }, deployment],
    [deployment, deployment],
  ])
    await assert.rejects(
      startM3Server(
        { deployments, app, syncIntervalMs: null },
        { createRpc: () => assert.fail('invalid deployment set must fail before RPC creation') },
      ),
      /INVALID_M3_DEPLOYMENT_SET/,
    );
});

test('startup requires exactly one deployment form and a bounded sync interval', async () => {
  const root = await directory();
  const app = {
    dbPath: resolve(root, 'ledger.sqlite'),
    env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
    origin: 'http://127.0.0.1:4180',
  };
  for (const options of [
    { app, syncIntervalMs: null },
    {
      app,
      deployment: { deploymentStatus: 'NOT_DEPLOYED' as const },
      deployments: [],
      syncIntervalMs: null,
    },
  ])
    await assert.rejects(startM3Server(options as M3ServerStartupOptions), /INVALID_M3_DEPLOYMENT_SET/);

  for (const syncIntervalMs of [999, 300_001, 1.5])
    await assert.rejects(
      startM3Server({
        app,
        deployment: { deploymentStatus: 'NOT_DEPLOYED' },
        syncIntervalMs,
      }),
      /INVALID_M3_SYNC_INTERVAL/,
    );
});

test('StrategyPass transfer reaches canonical evidence and exact holder balance projections', async () => {
  const root = await directory();
  const server = await startM3Server(
    {
      deployment: {
        deploymentStatus: 'DEPLOYED',
        dbPath: resolve(root, 'chain.sqlite'),
        rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
        manifestDocument: { ...manifestBody, manifestDigest },
        expectedManifestDigest: manifestDigest,
        expectedContractAddress: CONTRACT,
        maxBlocksPerSync: 3,
        now: () => '2026-09-20T00:00:00.000Z',
      },
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      syncIntervalMs: null,
    },
    { createRpc: () => new StrategyPassStartupRpc() },
  );
  const submitted = await server.app.inject({
    method: 'POST',
    url: '/api/v1/chain/operations',
    headers: { host: '127.0.0.1:4180', origin: 'http://127.0.0.1:4180', 'x-quantpass-demo': '1' },
    payload: {
      operationId: 'startup-pass-transfer',
      chainId: CHAIN_ID,
      owner: OWNER,
      target: PASS,
      calldata: encodeM3StrategyPassTransfer(RECIPIENT, 1n),
      txHash: PASS_TX,
    },
  });
  assert.equal(submitted.statusCode, 202, submitted.body);
  await server.syncNow();

  const evidence = await server.app.inject({
    url: `/api/v1/chain/operations/startup-pass-transfer/evidence?owner=${OWNER}`,
    headers: { host: '127.0.0.1:4180' },
  });
  assert.equal(evidence.statusCode, 200, evidence.body);
  assert.equal(evidence.json().lifecycle, 'CONFIRMED');
  assert.equal(evidence.json().productReady, true);

  const recipient = await server.app.inject({
    url: `/api/v1/chain/passes/${PASS}/${RECIPIENT}`,
    headers: { host: '127.0.0.1:4180' },
  });
  assert.equal(recipient.statusCode, 200, recipient.body);
  assert.deepEqual(recipient.json().state, {
    owner: RECIPIENT,
    pass: PASS,
    strategyId: STRATEGY_ID,
    decimals: 18,
    balanceRaw: '1',
  });
  await server.close();
});

test('each runtime pass tracks at most 100 pending operation identities', async () => {
  const root = await directory();
  const rpc = new StartupRpc();
  const server = await startM3Server(
    {
      deployment: {
        deploymentStatus: 'DEPLOYED',
        dbPath: resolve(root, 'chain.sqlite'),
        rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
        manifestDocument: { ...manifestBody, manifestDigest },
        expectedManifestDigest: manifestDigest,
        expectedContractAddress: CONTRACT,
        maxBlocksPerSync: 3,
      },
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      syncIntervalMs: null,
    },
    { createRpc: () => rpc },
  );
  for (let index = 0; index < 101; index++)
    server.runtime!.recordSubmission({
      operationId: `bounded-${index.toString().padStart(3, '0')}`,
      chainId: CHAIN_ID,
      owner: OWNER,
      target: CONTRACT,
      calldata: encodeM3VaultCall('close()', []),
      txHash: asTransactionHash(`0x${(index + 1).toString(16).padStart(64, '0')}`),
    });
  const result = await server.syncNow();
  assert.equal(result?.trackedOperations, 100);
  assert.equal(rpc.receiptCalls, 100);
  const finalHash = asTransactionHash(`0x${(101).toString(16).padStart(64, '0')}`);
  assert.equal(rpc.receiptHashes.includes(finalHash), false);
  assert.equal((await server.syncNow())?.trackedOperations, 100);
  assert.equal(rpc.receiptCalls, 200);
  assert.equal(rpc.receiptHashes.includes(finalHash), true);
  await server.close();
});

test('runtime isolates one invalid receipt and continues tracking later operations', async () => {
  const root = await directory();
  const rpc = new StartupRpc();
  const server = await startM3Server(
    {
      deployment: {
        deploymentStatus: 'DEPLOYED',
        dbPath: resolve(root, 'chain.sqlite'),
        rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
        manifestDocument: { ...manifestBody, manifestDigest },
        expectedManifestDigest: manifestDigest,
        expectedContractAddress: CONTRACT,
        maxBlocksPerSync: 3,
      },
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      syncIntervalMs: null,
    },
    { createRpc: () => rpc },
  );
  server.runtime!.recordSubmission({
    operationId: 'a-invalid-receipt',
    chainId: CHAIN_ID,
    owner: OWNER,
    target: CONTRACT,
    calldata: encodeM3VaultCall('close()', []),
    txHash: BAD_TX,
  });
  server.runtime!.recordSubmission({
    operationId: 'b-valid-receipt',
    chainId: CHAIN_ID,
    owner: OWNER,
    target: CONTRACT,
    calldata: encodeM3VaultCall('deposit(uint256)', [1_000_000n]),
    txHash: TX,
  });

  const result = await server.syncNow();
  assert.equal(result?.trackedOperations, 2);
  assert.equal(result?.trackingFailures, 1);
  assert.equal(server.runtime!.store.operation('a-invalid-receipt')?.state, 'SUBMITTED');
  assert.equal(server.runtime!.store.operation('b-valid-receipt')?.state, 'CONFIRMED');
  await server.close();
});

test('runtime retries a reconciliation failure and restores canonical confirmation', async () => {
  const root = await directory();
  const server = await startM3Server(
    {
      deployment: {
        deploymentStatus: 'DEPLOYED',
        dbPath: resolve(root, 'chain.sqlite'),
        rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
        manifestDocument: { ...manifestBody, manifestDigest },
        expectedManifestDigest: manifestDigest,
        expectedContractAddress: CONTRACT,
        maxBlocksPerSync: 3,
        now: () => '2026-09-20T00:00:00.000Z',
      },
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      syncIntervalMs: null,
    },
    { createRpc: () => new StartupRpc() },
  );
  const submitted = server.runtime!.recordSubmission({
    operationId: 'recover-reconciliation',
    chainId: CHAIN_ID,
    owner: OWNER,
    target: CONTRACT,
    calldata: encodeM3VaultCall('deposit(uint256)', [1_000_000n]),
    txHash: TX,
  });
  const mined = transitionOperation(submitted, {
    state: 'MINED',
    blockNumber: 1n,
    blockHash: blocks.get(1n)!.hash,
    transactionIndex: 0,
    receiptStatus: 'SUCCESS',
  });
  server.runtime!.store.saveOperation(
    transitionOperation(mined, {
      state: 'RECONCILIATION_FAILED',
      errorCode: 'EVENT_EVIDENCE_MISMATCH',
    }),
  );

  const result = await server.syncNow();
  assert.equal(result?.trackedOperations, 1);
  assert.equal(result?.trackingFailures, 0);
  assert.equal(server.runtime!.store.operation('recover-reconciliation')?.state, 'CONFIRMED');
  await server.close();
});

test('runtime catches up a large head gap in bounded passes and keeps projections unavailable meanwhile', async () => {
  const root = await directory();
  for (let number = 4n; number <= 7n; number++)
    blocks.set(number, {
      number,
      hash: asBlockHash(`0x${Number(number).toString(16).padStart(64, '0')}`),
      parentHash: asBlockHash(
        `0x${Number(number - 1n)
          .toString(16)
          .padStart(64, '0')}`,
      ),
      timestamp: number,
    });
  const server = await startM3Server(
    {
      deployment: {
        deploymentStatus: 'DEPLOYED',
        dbPath: resolve(root, 'chain.sqlite'),
        rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
        manifestDocument: { ...manifestBody, manifestDigest },
        expectedManifestDigest: manifestDigest,
        expectedContractAddress: CONTRACT,
        maxBlocksPerSync: 2,
      },
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      syncIntervalMs: null,
    },
    { createRpc: () => new StartupRpc(7n) },
  );
  assert.equal(server.runtime!.store.checkpoint(CHAIN_ID, CONTRACT)?.blockNumber, 2n);
  assert.deepEqual(server.runtime!.store.syncHealth(CHAIN_ID, CONTRACT), {
    healthy: false,
    error: 'CHAIN_SYNC_INCOMPLETE',
  });
  assert.equal((await server.syncNow())?.scannedBlocks, 2);
  assert.equal(server.runtime!.store.checkpoint(CHAIN_ID, CONTRACT)?.blockNumber, 4n);
  assert.equal((await server.syncNow())?.scannedBlocks, 2);
  assert.equal(server.runtime!.store.checkpoint(CHAIN_ID, CONTRACT)?.blockNumber, 6n);
  assert.equal((await server.syncNow())?.scannedBlocks, 1);
  assert.equal(server.runtime!.store.checkpoint(CHAIN_ID, CONTRACT)?.blockNumber, 7n);
  assert.deepEqual(server.runtime!.store.syncHealth(CHAIN_ID, CONTRACT), { healthy: true, error: null });
  await server.close();
});

test('startup rejects non-loopback listen hosts at runtime', async () => {
  const root = await directory();
  await assert.rejects(
    startM3Server({
      deployment: { deploymentStatus: 'NOT_DEPLOYED' },
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      listen: { host: '0.0.0.0' as '127.0.0.1', port: 4180 },
      syncIntervalMs: null,
    }),
    /INVALID_M3_LISTEN_ADDRESS/,
  );
});

test('startup rejects invalid loopback ports before building the application', async () => {
  const root = await directory();
  for (const port of [-1, 65_536, 1.5])
    await assert.rejects(
      startM3Server({
        deployment: { deploymentStatus: 'NOT_DEPLOYED' },
        app: {
          dbPath: resolve(root, `ledger-${port}.sqlite`),
          env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
          origin: 'http://127.0.0.1:4180',
        },
        listen: { host: '127.0.0.1', port },
        syncIntervalMs: null,
      }),
      /INVALID_M3_LISTEN_ADDRESS/,
    );
});

test('indexer connectivity failure does not prevent the product server starting or later recovering', async () => {
  const root = await directory();
  const rpc = new StartupRpc();
  const originalHead = rpc.block.bind(rpc);
  let unavailable = true;
  rpc.block = (number) =>
    unavailable ? Promise.reject(new Error('private RPC error detail')) : originalHead(number);
  const server = await startM3Server(
    {
      deployment: {
        deploymentStatus: 'DEPLOYED',
        dbPath: resolve(root, 'chain.sqlite'),
        rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
        manifestDocument: { ...manifestBody, manifestDigest },
        expectedManifestDigest: manifestDigest,
        expectedContractAddress: CONTRACT,
      },
      app: {
        dbPath: resolve(root, 'ledger.sqlite'),
        env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
        origin: 'http://127.0.0.1:4180',
      },
      syncIntervalMs: null,
    },
    { createRpc: () => rpc },
  );
  try {
    const headers = { host: '127.0.0.1:4180' };
    assert.equal((await server.app.inject({ url: '/api/health', headers })).statusCode, 200);
    const status = await server.app.inject({ url: '/api/v1/chain/runtime-status', headers });
    assert.deepEqual(status.json(), {
      lastAttempt: 'FAILED',
      errorCode: 'M3_INDEXER_SYNC_FAILED',
      database: { status: 'HEALTHY', schemaVersion: 6, integrity: 'OK' },
      deployment: {
        chainId: CHAIN_ID,
        contract: CONTRACT,
        manifestDigest,
        abiHash: M3_VAULT_ABI_HASH,
        runtimeBytecodeHash: manifestBody.runtimeBytecodeHash,
        strategyPassAddress: PASS,
        strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
        strategyPassRuntimeBytecodeHash: manifestBody.strategyPassRuntimeBytecodeHash,
      },
    });
    assert.doesNotMatch(status.body, /private RPC error/);
    assert.equal(
      (await server.app.inject({ url: `/api/v1/chain/vaults/${OWNER}`, headers })).statusCode,
      503,
    );
    unavailable = false;
    await server.syncNow();
    assert.equal(
      (await server.app.inject({ url: `/api/v1/chain/vaults/${OWNER}`, headers })).statusCode,
      200,
    );
    assert.deepEqual((await server.app.inject({ url: '/api/v1/chain/runtime-status', headers })).json(), {
      lastAttempt: 'SUCCEEDED',
      errorCode: null,
      database: { status: 'HEALTHY', schemaVersion: 6, integrity: 'OK' },
      deployment: {
        chainId: CHAIN_ID,
        contract: CONTRACT,
        manifestDigest,
        abiHash: M3_VAULT_ABI_HASH,
        runtimeBytecodeHash: manifestBody.runtimeBytecodeHash,
        strategyPassAddress: PASS,
        strategyPassAbiHash: M3_STRATEGY_PASS_ABI_HASH,
        strategyPassRuntimeBytecodeHash: manifestBody.strategyPassRuntimeBytecodeHash,
      },
    });
    unavailable = true;
    await assert.rejects(server.syncNow());
    // A formerly healthy cached projection cannot survive a subsequent failed refresh as live data.
    assert.equal(
      (await server.app.inject({ url: `/api/v1/chain/vaults/${OWNER}`, headers })).statusCode,
      503,
    );
    assert.equal((await server.app.inject({ url: '/api/health', headers })).statusCode, 200);
  } finally {
    await server.close();
  }
});

test('restart on an unrecoverable reorg preserves history and serves the product while projection reads stay unavailable', async () => {
  const root = await directory();
  const options = {
    deployment: {
      deploymentStatus: 'DEPLOYED' as const,
      dbPath: resolve(root, 'chain.sqlite'),
      rpcEndpoints: ['https://rpc.testnet.chain.robinhood.com'],
      manifestDocument: { ...manifestBody, manifestDigest },
      expectedManifestDigest: manifestDigest,
      expectedContractAddress: CONTRACT,
    },
    app: {
      dbPath: resolve(root, 'ledger.sqlite'),
      env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
      origin: 'http://127.0.0.1:4180',
    },
    syncIntervalMs: null,
  };
  let server = await startM3Server(options, { createRpc: () => new StartupRpc() });
  const previous = server.runtime!.store.checkpoint(CHAIN_ID, CONTRACT);
  server.runtime!.store.markSyncUnhealthy(CHAIN_ID, CONTRACT, 'CHAIN_REORG_DEPTH_EXCEEDED');
  await server.close();
  const fork = new StartupRpc();
  fork.block = async (number) => {
    const original = blocks.get(number === 'latest' ? 3n : number);
    return original ? { ...original, hash: asBlockHash(`0x${'ff'.repeat(32)}`) } : null;
  };
  server = await startM3Server(options, { createRpc: () => fork });
  try {
    const headers = { host: '127.0.0.1:4180' };
    assert.equal((await server.app.inject({ url: '/api/health', headers })).statusCode, 200);
    assert.equal(
      (await server.app.inject({ url: `/api/v1/chain/vaults/${OWNER}`, headers })).statusCode,
      503,
    );
    assert.deepEqual(server.runtime!.store.checkpoint(CHAIN_ID, CONTRACT), previous);
    assert.equal(server.runtime!.store.syncHealth(CHAIN_ID, CONTRACT).healthy, false);
  } finally {
    await server.close();
  }
});
