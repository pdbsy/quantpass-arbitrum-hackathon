import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, keccak256 } from 'ethers';
import { prepareVerifiedPools, seederInterface } from '../packages/testnet/src/pool-preparation.ts';
import { preparePoolInitialization } from '../packages/testnet/src/pool-init-plan.ts';
import { evidenceHash } from '../packages/testnet/src/executor-plan.ts';
import { feedInterface } from '../packages/testnet/src/trading-abi.ts';
import { asHexData } from '../packages/chain-adapter/src/types.ts';
import { tradingRpcFixture, tradingFixtureAddress as address } from './helpers/testnet-trading-rpc.ts';
import { poolsCli } from '../tools/testnet/pools.ts';
const assets = ['MSFT', 'NVDA', 'AAPL'].map((tokenSymbol, i) => ({
  id: '0x' + String(i + 1).repeat(64),
  tokenSymbol,
  tokenDecimals: 18,
  status: 'ASSET_STATUS_ACTIVE',
  currentMultiplier: '1',
  pendingMultiplier: '',
  deployments: [{ chainId: 4663, contractAddress: address(100 + i) }],
}));
const terms = assets.map((a) => ({
  identity: '4663:' + a.deployments[0]!.contractAddress,
  assetId: a.id,
  symbol: a.tokenSymbol,
  multiplier: '1',
}));
test('pool preparation qualifies real read boundaries and fresh official mappings, keeping LP capital separate and unsigned', async () => {
  const f = tradingRpcFixture(),
    owner = address(90),
    seeder = address(70),
    inventory = {
      ...f.inventory,
      stocks: f.inventory.stocks.map((s, i) => ({ ...s, referenceIdentity: evidenceHash(terms[i]) })),
    };
  let mismatch = false,
    stale = false,
    calls = 0;
  const abi = new Interface(['function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)']);
  const rpc = {
    chainId: f.client.chainId.bind(f.client),
    block: f.client.block.bind(f.client),
    logs: f.client.logs.bind(f.client),
    receipt: f.client.receipt.bind(f.client),
    code: async (...args: Parameters<typeof f.client.code>) =>
      args[0] === owner ? asHexData('0x') : f.client.code(...args),
    call: async (...args: Parameters<typeof f.client.call>) => {
      const c = args[0],
        i = inventory.stocks.findIndex((s) => s.feed === c.to);
      if (c.to === seeder) {
        const p = seederInterface.parseTransaction({ data: c.data })!;
        const value =
          p.name === 'owner'
            ? mismatch
              ? address(91)
              : owner
            : p.name === 'factory'
              ? inventory.factory
              : p.name === 'usdc'
                ? inventory.usdc
                : inventory.stocks[Number(p.args[0])]!.token;
        return asHexData(seederInterface.encodeFunctionResult(p.name, [value]));
      }
      if (i >= 0 && feedInterface.parseTransaction({ data: c.data })!.name === 'referenceIdentity')
        return asHexData(
          feedInterface.encodeFunctionResult('referenceIdentity', [inventory.stocks[i]!.referenceIdentity]),
        );
      if (
        inventory.stocks.some((s) => s.pool === c.to) &&
        c.data.startsWith(abi.getFunction('slot0')!.selector)
      )
        return asHexData(
          abi.encodeFunctionResult('slot0', [
            c.to === inventory.stocks[0]!.pool ? 0n : 1n << 96n,
            0,
            0,
            0,
            0,
            0,
            true,
          ]),
        );
      return f.client.call(...args);
    },
  };
  const budgets = inventory.stocks.map((s) => ({
    stock: s.token,
    pool: s.pool,
    tickLower: -60,
    tickUpper: 60,
    liquidity: '100',
    maxUsdc: '100000000',
    maxStock: '1000000000000000000',
  }));
  const options = {
    rpc,
    manifest: f.manifest,
    inventory,
    owner,
    seeder,
    seederCodeHash: keccak256('0x6000'),
    terms,
    budgets,
    now: () => 1000000,
    transport: async (url: string) => {
      calls++;
      return new Response(
        JSON.stringify(
          url.endsWith('/assets')
            ? { assets }
            : {
                quotes: [
                  {
                    tokenSymbol: url.split('/').at(-1),
                    deployments: assets.find((a) => a.tokenSymbol === url.split('/').at(-1))!.deployments,
                    bid: '99',
                    ask: '101',
                    currency: 'USD',
                    isTradingHalt: false,
                    generatedAt: new Date(stale ? 960000 : 1000000).toISOString(),
                  },
                ],
              },
        ),
      );
    },
  };
  const result = await prepareVerifiedPools(options);
  assert.equal(result.pools.length, 3);
  assert.equal(result.broadcast, 'NOT_RUN');
  assert.equal(result.pools[0]!.referencePriceUsdc, '100000000');
  assert.equal(result.pools[0]!.initialize!.from, owner);
  assert.equal(result.pools[1]!.initialize, null);
  assert.equal(result.pools[2]!.seed.from, owner);
  const before = calls;
  mismatch = true;
  await assert.rejects(prepareVerifiedPools(options), /SEEDER/);
  assert.equal(calls, before);
  mismatch = false;
  stale = true;
  await assert.rejects(prepareVerifiedPools(options), /REFERENCE/);
  stale = false;
  await assert.rejects(prepareVerifiedPools({ ...options, owner: f.manifest.contractAddress }), /INPUT/);
  await assert.rejects(
    prepareVerifiedPools({
      ...options,
      budgets: budgets.map((b, i) => (i ? b : { ...b, stock: address(11) })),
    }),
    /INPUT/,
  );
  for (const change of [
    { tickLower: -59 },
    { tickUpper: 0, tickLower: 60 },
    { liquidity: '0' },
    { maxUsdc: '-1' },
    { liquidity: String(2n ** 128n) },
  ])
    assert.throws(
      () =>
        preparePoolInitialization(
          owner,
          inventory.usdc,
          seeder,
          budgets.map((b, i) => ({ ...b, ...(i ? {} : change), priceUsdc: '100000000' })),
        ),
      /BUDGET/,
    );
});
test('pool CLI cannot broadcast or guess blank budgets', async () => {
  assert.equal(await poolsCli(['--help'], {}), 0);
  for (const args of [[], ['--broadcast'], ['--prepare', 'missing']])
    assert.equal(await poolsCli(args, {}), 2);
  assert.equal(
    await poolsCli(['--prepare', 'missing', 'missing', 'digest', 'missing', 'digest', 'missing'], {}),
    1,
  );
});
