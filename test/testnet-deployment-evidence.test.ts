import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import test from 'node:test';
import { verifyTestnetDeployment } from '../packages/testnet/src/deployment-evidence.ts';
import { deploymentEvidenceCli } from '../tools/testnet/deployment-evidence.ts';
import { tradingRpcFixture, tradingFixtureAddress as address } from './helpers/testnet-trading-rpc.ts';
import { asTransactionHash, asHexData } from '../packages/chain-adapter/src/types.ts';
import { evidenceHash } from '../packages/testnet/src/executor-plan.ts';
import { feedInterface } from '../packages/testnet/src/trading-abi.ts';
import { seederInterface } from '../packages/testnet/src/pool-preparation.ts';
import type { ChainTransaction, ChainReceipt } from '../packages/chain-adapter/src/rpc.ts';
const terms = ['MSFT', 'NVDA', 'AAPL'].map((symbol, i) => ({
  identity: '4663:' + address(100 + i),
  assetId: '0x' + String(i + 1).repeat(64),
  symbol,
  multiplier: '1',
}));
async function fixture() {
  const f = tradingRpcFixture(),
    deployer = address(90),
    block = (await f.client.block(1n))!;
  const addresses = {
    usdc: address(3),
    pass: address(60),
    stocks: [address(10), address(11), address(12)],
    feeds: [address(20), address(21), address(22)],
    factory: address(6),
    router: address(4),
    quoter: address(5),
    seeder: address(70),
    keeper: address(40),
    executor: address(40),
    vaults: [{ owner: address(1), vault: address(50), passLocker: address(2) }],
  };
  const destinations = [
    addresses.usdc,
    addresses.pass,
    ...addresses.stocks,
    ...addresses.feeds,
    addresses.factory,
    addresses.router,
    addresses.quoter,
    addresses.seeder,
    address(50),
  ];
  // Receipt-reader boundary fixtures only. These are not compiled creation bytecode or deployed-chain evidence.
  const transactions = destinations.map((expectedAddress, i) => ({
    name: 'boundary-' + i,
    from: deployer,
    expectedAddress,
    chainId: 46630,
    nonce: i,
    value: '0',
    data: '0x' + (i + 1).toString(16).padStart(8, '0'),
    artifactDigest: 'ab'.repeat(32),
  }));
  const poolCalls = addresses.stocks.map((stock, i) => ({
    from: deployer,
    to: addresses.factory,
    chainId: 46630,
    nonce: destinations.length + i,
    value: '0',
    data: new Interface(['function createPool(address,address,uint24) returns(address)']).encodeFunctionData(
      'createPool',
      [addresses.usdc, stock, 3000],
    ),
  }));
  const txs = new Map<string, ChainTransaction>(),
    receipts = new Map<string, ChainReceipt>();
  const creationHashes = transactions.map((t, i) => {
    const hash = asTransactionHash('0x' + (i + 1).toString(16).padStart(64, '0'));
    txs.set(hash, {
      hash,
      from: deployer,
      to: null,
      chainId: 46630,
      data: asHexData(t.data),
      value: 0n,
      nonce: BigInt(t.nonce),
      blockHash: block.hash,
      blockNumber: block.number,
      transactionIndex: i,
    });
    receipts.set(hash, {
      transactionHash: hash,
      from: deployer,
      to: null,
      contractAddress: t.expectedAddress,
      status: 'SUCCESS',
      blockHash: block.hash,
      blockNumber: block.number,
      transactionIndex: i,
      logs: [],
    });
    return hash;
  });
  const poolCreationHashes = poolCalls.map((t, i) => {
    const hash = asTransactionHash('0x' + (100 + i).toString(16).padStart(64, '0'));
    txs.set(hash, {
      hash,
      from: deployer,
      to: addresses.factory,
      chainId: 46630,
      data: asHexData(t.data),
      value: 0n,
      nonce: BigInt(t.nonce),
      blockHash: block.hash,
      blockNumber: block.number,
      transactionIndex: 20 + i,
    });
    receipts.set(hash, {
      transactionHash: hash,
      from: deployer,
      to: addresses.factory,
      status: 'SUCCESS',
      blockHash: block.hash,
      blockNumber: block.number,
      transactionIndex: 20 + i,
      logs: [],
    });
    return hash;
  });
  const rpc = {
    chainId: f.client.chainId.bind(f.client),
    block: f.client.block.bind(f.client),
    code: f.client.code.bind(f.client),
    logs: f.client.logs.bind(f.client),
    transaction: async (hash: Parameters<typeof f.client.receipt>[0]) => txs.get(hash) ?? null,
    receipt: async (hash: Parameters<typeof f.client.receipt>[0]) => receipts.get(hash) ?? null,
    call: async (...args: Parameters<typeof f.client.call>) => {
      if (args[0].to === addresses.seeder) {
        const parsed = seederInterface.parseTransaction({ data: args[0].data })!;
        const value =
          parsed.name === 'owner'
            ? deployer
            : parsed.name === 'factory'
              ? addresses.factory
              : parsed.name === 'usdc'
                ? addresses.usdc
                : addresses.stocks[Number(parsed.args[0])];
        return asHexData(seederInterface.encodeFunctionResult(parsed.name, [value]));
      }
      const index = addresses.feeds.indexOf(args[0].to),
        parsed = index >= 0 ? feedInterface.parseTransaction({ data: args[0].data }) : null;
      if (parsed?.name === 'referenceIdentity')
        return asHexData(
          feedInterface.encodeFunctionResult('referenceIdentity', [evidenceHash(terms[index])]),
        );
      return f.client.call(...args);
    },
  };
  const plan = { addresses, transactions, poolCalls } as unknown as Parameters<
    typeof verifyTestnetDeployment
  >[1];
  return { rpc, plan, creationHashes, poolCreationHashes, txs, receipts };
}
test('deployment proof binds creation data, nonce, actual addresses, canonical receipts and qualified snapshots', async () => {
  const f = await fixture();
  const verify = () =>
    verifyTestnetDeployment(f.rpc, f.plan, f.creationHashes, f.poolCreationHashes, terms, 30);
  const result = await verify();
  assert.equal(result.vaults.length, 1);
  assert.equal(result.vaults[0]!.inventory.owner, address(1));
  assert.equal(result.poolInitialization, 'NOT_ASSERTED');
  assert.equal(result.executionGrants, 'NOT_ASSERTED');
  const hash = f.creationHashes[0]!,
    tx = f.txs.get(hash)!,
    receipt = f.receipts.get(hash)!;
  for (const change of [
    { data: asHexData('0x00000000') },
    { nonce: 999n },
    { from: address(91) },
    { to: address(3) },
    { value: 1n },
    { blockHash: '0x' + 'ff'.repeat(32) },
  ]) {
    f.txs.set(hash, { ...tx, ...change } as ChainTransaction);
    await assert.rejects(verify(), /CREATION_RECEIPT/);
  }
  f.txs.set(hash, tx);
  for (const change of [{ status: 'REVERTED' }, { contractAddress: address(91) }, { blockNumber: 15n }]) {
    f.receipts.set(hash, { ...receipt, ...change } as ChainReceipt);
    await assert.rejects(verify(), /CREATION_RECEIPT/);
  }
  f.receipts.set(hash, receipt);
  const poolhash = f.poolCreationHashes[0]!,
    pooltx = f.txs.get(poolhash)!;
  f.txs.set(poolhash, { ...pooltx, data: asHexData('0x12345678') });
  await assert.rejects(verify(), /POOL_RECEIPT/);
  f.txs.set(poolhash, pooltx);
  await assert.rejects(
    verifyTestnetDeployment(
      { ...f.rpc, chainId: async () => 4663 },
      f.plan,
      f.creationHashes,
      f.poolCreationHashes,
      terms,
      30,
    ),
    /INPUT/,
  );
  await assert.rejects(
    verifyTestnetDeployment(
      { ...f.rpc, code: async () => asHexData('0x') },
      f.plan,
      f.creationHashes,
      f.poolCreationHashes,
      terms,
      30,
    ),
    /CODE/,
  );
  assert.equal((await verify()).receipts.length, f.plan.transactions.length);
});
test('missing records and CLI misuse cannot promote an unsigned plan to deployed status', async () => {
  const f = await fixture();
  await assert.rejects(verifyTestnetDeployment(f.rpc, f.plan, [], [], [], 30), /INPUT/);
  assert.equal(await deploymentEvidenceCli(['--help'], {}), 0);
  for (const args of [[], ['--broadcast'], ['--verify', 'missing']])
    assert.equal(await deploymentEvidenceCli(args, {}), 2);
  assert.equal(
    await deploymentEvidenceCli(
      ['--verify', 'missing', 'missing', '0x' + 'ab'.repeat(32), 'missing', 'missing'],
      {},
    ),
    1,
  );
});
