import type { ReadonlyRpc } from '../../chain-adapter/src/rpc.ts';
import type { DeploymentManifest } from '../../chain-adapter/src/manifest.ts';
import { asAddress, asBlockHash, asHexData } from '../../chain-adapter/src/types.ts';
import type { TradingInventory } from './trading-inventory.ts';
import { readTradingSnapshot } from './trading-reader.ts';
import { quoterInterface, tradingInterface } from './trading-abi.ts';
import { planExecutorTrade, type TradeRequest } from './executor-plan.ts';

/** Read-only quote and full Vault simulation at exactly the qualified canonical block. */
export async function prepareExecutorOrder(
  rpc: ReadonlyRpc,
  manifest: DeploymentManifest,
  inventory: TradingInventory,
  request: TradeRequest,
) {
  const snapshot = await readTradingSnapshot(rpc, manifest, inventory);
  const stock = inventory.stocks[request.stockIndex];
  if (!stock || !['BUY', 'SELL'].includes(request.side)) throw new Error('EXECUTOR_ROUTE');
  const reference = { blockHash: asBlockHash(snapshot.blockHash), requireCanonical: true } as const;
  const params = [
    request.side === 'BUY' ? inventory.usdc : stock.token,
    request.side === 'BUY' ? stock.token : inventory.usdc,
    request.amountIn,
    3000,
    0,
  ];
  const quoted = quoterInterface.decodeFunctionResult(
    'quoteExactInputSingle',
    await rpc.call(
      {
        to: asAddress(inventory.quoter),
        data: asHexData(quoterInterface.encodeFunctionData('quoteExactInputSingle', [params])),
      },
      reference,
    ),
  );
  const plan = planExecutorTrade(snapshot, inventory, request, String(quoted[0]));
  if (!plan.intent) return { ...plan, snapshot };
  const simulated = tradingInterface.decodeFunctionResult(
    'execute',
    await rpc.call(
      {
        from: asAddress(plan.intent.executor),
        to: asAddress(manifest.contractAddress),
        data: asHexData(plan.intent.calldata),
      },
      reference,
    ),
  );
  if (BigInt(simulated[0]) < BigInt(plan.minAmountOut)) throw new Error('EXECUTOR_SIMULATION');
  const canonical = await rpc.block(BigInt(snapshot.blockNumber));
  if (!canonical || canonical.hash !== snapshot.blockHash) throw new Error('EXECUTOR_REORG');
  return { ...plan, snapshot };
}
