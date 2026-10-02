import assert from 'node:assert/strict';
import test from 'node:test';
import { tradingRpcFixture, tradingFixtureAddress } from './helpers/testnet-trading-rpc.ts';
import { prepareExecutorOrder } from '../packages/testnet/src/executor-prepare.ts';
import { quoterInterface, tradingInterface } from '../packages/testnet/src/trading-abi.ts';
import { asHexData } from '../packages/chain-adapter/src/types.ts';
test('preparation uses canonical QuoterV2 and executor simulation only, pool deviation never invokes execute', async () => {
  const f = tradingRpcFixture();
  const executor = tradingFixtureAddress(41);
  let simulations = 0,
    quote = 995000000000000000n;
  const rpc = {
    chainId: () => f.client.chainId(),
    block: (n: Parameters<typeof f.client.block>[0]) => f.client.block(n),
    code: f.client.code.bind(f.client),
    receipt: f.client.receipt.bind(f.client),
    logs: f.client.logs.bind(f.client),
    call: async (...args: Parameters<typeof f.client.call>) => {
      const [call, block] = args;
      if (
        call.to === f.inventory.quoter &&
        call.data.startsWith(quoterInterface.getFunction('quoteExactInputSingle')!.selector)
      ) {
        assert.ok(typeof block === 'object' && block.requireCanonical);
        return asHexData(
          quoterInterface.encodeFunctionResult('quoteExactInputSingle', [quote, 1, 0, 100000]),
        );
      }
      const action =
        call.to === f.manifest.contractAddress
          ? tradingInterface.parseTransaction({ data: call.data })
          : null;
      if (action?.name === 'grant')
        return asHexData(
          tradingInterface.encodeFunctionResult('grant', [executor, 1100, 60, 200000000, 1000000000, 100]),
        );
      if (action?.name === 'execute') {
        assert.equal(call.from, executor);
        simulations++;
        return asHexData(tradingInterface.encodeFunctionResult('execute', [quote]));
      }
      return f.client.call(...args);
    },
  };
  const request = {
    stockIndex: 1,
    side: 'BUY' as const,
    amountIn: '100000000',
    deadline: '1010',
    sourceDigest: '0x' + 'cd'.repeat(32),
    createdAt: 1000000,
    executor,
  };
  assert.equal((await prepareExecutorOrder(rpc, f.manifest, f.inventory, request)).state, 'READY');
  assert.equal(simulations, 1);
  quote = 980000000000000000n;
  assert.equal(
    (await prepareExecutorOrder(rpc, f.manifest, f.inventory, request)).state,
    'PAUSED_POOL_PRICE_DEVIATION',
  );
  assert.equal(simulations, 1);
});
