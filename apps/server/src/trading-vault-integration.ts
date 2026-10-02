import type {
  ContractIntegration,
  DecodedContractEvent,
  CanonicalContractEvent,
  ReconciliationResult,
} from '../../../packages/chain-adapter/src/reconciliation.ts';
import type {
  ChainLog,
  ChainReceipt,
  ChainBlock,
  ReadonlyRpc,
} from '../../../packages/chain-adapter/src/rpc.ts';
import type { DeploymentManifest } from '../../../packages/chain-adapter/src/manifest.ts';
import type { ChainOperation } from '../../../packages/chain-adapter/src/lifecycle.ts';
import type { TradingInventory } from '../../../packages/testnet/src/trading-inventory.ts';
import { tradingInterface } from '../../../packages/testnet/src/trading-abi.ts';
import { readTradingSnapshot } from '../../../packages/testnet/src/trading-reader.ts';
import { asAddress } from '../../../packages/chain-adapter/src/types.ts';
import { tradingPerformance } from '../../../packages/testnet/src/trading-performance.ts';

export const TRADING_PROJECTION_KEY = 'alphaforge-trading-v1';
export function decodeTradingEvent(log: ChainLog): DecodedContractEvent | null {
  const topic = log.topics[0];
  if (!topic) return null;
  const fragment = tradingInterface.getEvent(topic);
  if (!fragment) return null;
  const decoded = tradingInterface.decodeEventLog(fragment, log.data, [...log.topics]);
  const exact = tradingInterface.encodeEventLog(fragment, [...decoded]);
  if (
    exact.data.toLowerCase() !== log.data.toLowerCase() ||
    JSON.stringify(exact.topics.map((v) => v.toLowerCase())) !==
      JSON.stringify(log.topics.map((v) => v.toLowerCase()))
  )
    throw new Error('TRADING_EVENT_ENCODING');
  const data: Record<string, unknown> = {};
  fragment.inputs.forEach((input, i) => {
    const value = decoded[i];
    data[input.name] =
      typeof value === 'bigint' ? value.toString() : typeof value === 'string' ? value.toLowerCase() : value;
  });
  return Object.freeze({
    eventSignature: topic,
    eventName: fragment.name,
    normalizedData: Object.freeze(data),
  });
}
interface Context {
  readonly rpc: ReadonlyRpc;
  readonly manifest: DeploymentManifest;
  readonly block: ChainBlock;
  readonly events: readonly CanonicalContractEvent[];
}
const field = (e: CanonicalContractEvent, key: string) => e.normalizedData[key];
export class TradingVaultContractIntegration implements ContractIntegration {
  readonly inventory: TradingInventory;
  constructor(inventory: TradingInventory) {
    this.inventory = inventory;
  }
  decode = decodeTradingEvent;
  async rebuildProjections(context: Context) {
    const state = await readTradingSnapshot(context.rpc, context.manifest, this.inventory, context.block);
    const performance = tradingPerformance(context.events, state.vaultEquity);
    for (const stock of state.stocks)
      if ((performance.positions.find((p) => p.stock === stock.token)?.quantityRaw ?? '0') !== stock.position)
        throw new Error('TRADING_POSITION_EVENT_MISMATCH');
    return Object.freeze([
      Object.freeze({
        owner: asAddress(this.inventory.owner),
        projectionKey: TRADING_PROJECTION_KEY,
        blockNumber: context.block.number,
        blockHash: context.block.hash,
        state: Object.freeze({ ...state }),
      }),
    ]);
  }
  async reconcileOperation(
    context: Context & { readonly operation: ChainOperation; readonly receipt: ChainReceipt },
  ): Promise<ReconciliationResult> {
    const mismatch = { status: 'MISMATCH', errorCode: 'EVENT_EVIDENCE_MISMATCH' } as const;
    try {
      const op = context.operation;
      if (
        !op.calldata ||
        op.chainId !== 46630 ||
        op.target.toLowerCase() !== context.manifest.contractAddress.toLowerCase() ||
        op.txHash !== context.receipt.transactionHash ||
        context.receipt.status !== 'SUCCESS' ||
        context.block.number !== context.receipt.blockNumber ||
        context.block.hash !== context.receipt.blockHash ||
        context.receipt.from.toLowerCase() !== op.owner.toLowerCase() ||
        context.receipt.to?.toLowerCase() !== context.manifest.contractAddress.toLowerCase()
      )
        return mismatch;
      if (!context.rpc.transaction) return mismatch;
      const tx = await context.rpc.transaction(context.receipt.transactionHash);
      if (
        !tx ||
        tx.chainId !== 46630 ||
        tx.from.toLowerCase() !== op.owner.toLowerCase() ||
        tx.to?.toLowerCase() !== context.manifest.contractAddress.toLowerCase() ||
        tx.data.toLowerCase() !== op.calldata.toLowerCase() ||
        tx.value !== 0n ||
        tx.blockHash !== context.receipt.blockHash ||
        tx.blockNumber !== context.receipt.blockNumber ||
        tx.transactionIndex !== context.receipt.transactionIndex
      )
        return mismatch;
      const action = tradingInterface.parseTransaction({ data: op.calldata });
      if (
        !action ||
        tradingInterface.encodeFunctionData(action.fragment, [...action.args]).toLowerCase() !==
          op.calldata.toLowerCase()
      )
        return mismatch;
      const own = op.owner.toLowerCase() === this.inventory.owner;
      if (!own && !['execute', 'checkRisk'].includes(action.name)) return mismatch;
      const events = context.events.filter(
        (e) =>
          e.transactionHash === context.receipt.transactionHash &&
          e.blockHash === context.receipt.blockHash &&
          e.address.toLowerCase() === context.manifest.contractAddress.toLowerCase(),
      );
      if (
        events.some(
          (e) =>
            e.removed ||
            e.chainId !== 46630 ||
            e.blockNumber !== context.block.number ||
            e.transactionIndex !== context.receipt.transactionIndex,
        )
      )
        return mismatch;
      const one = (name: string) => {
        const found = events.filter((e) => e.eventName === name);
        return found.length === 1 ? found[0] : undefined;
      };
      let matched = false;
      if (action.name === 'execute') {
        const a = action.args[0],
          buy = String(a.tokenIn).toLowerCase() === this.inventory.usdc;
        const stock = this.inventory.stocks.find(
          (s) => s.token === String(buy ? a.tokenOut : a.tokenIn).toLowerCase(),
        );
        if (!stock || (!buy && String(a.tokenOut).toLowerCase() !== this.inventory.usdc)) return mismatch;
        const fill = one('SwapExecuted'),
          cancel = one('RiskOrderCancelled');
        if (fill && !cancel)
          matched =
            field(fill, 'stock') === stock.token &&
            field(fill, 'buy') === buy &&
            field(fill, 'input') === String(a.amountIn) &&
            BigInt(String(field(fill, 'output'))) >= BigInt(a.minAmountOut) &&
            BigInt(String(field(fill, 'stateVersion'))) === BigInt(a.expectedVersion) + 1n;
        else if (cancel && !fill && buy)
          matched = BigInt(String(field(cancel, 'stateVersion'))) === BigInt(a.expectedVersion) + 1n;
      } else {
        switch (action.name) {
          case 'deposit': {
            const e = one('Deposited');
            matched = !!e && field(e, 'amountUsdc') === String(action.args[0]);
            break;
          }
          case 'withdraw': {
            const e = one('Withdrawn');
            matched = !!e && field(e, 'amountUsdc') === String(action.args[0]);
            break;
          }
          case 'allocate':
          case 'deallocate': {
            const e = one('CapitalChanged');
            matched =
              !!e &&
              field(e, 'allocated') === (action.name === 'allocate') &&
              field(e, 'amountUsdc') === String(action.args[0]);
            break;
          }
          case 'authorizeExecutor': {
            const e = one('GrantAuthorized');
            matched =
              !!e &&
              field(e, 'executor') === String(action.args[0].executor).toLowerCase() &&
              field(e, 'expiresAt') === String(action.args[0].expiresAt);
            break;
          }
          case 'close':
            matched = !!one('Closed');
            break;
          case 'setBounds':
            matched = !!one('BoundsChanged');
            break;
          case 'stop':
          case 'revokeExecutor':
          case 'checkRisk':
            matched = events.every((e) => e.eventName === 'LiquidationStarted');
            break;
          case 'rescueUntrackedToken':
          case 'rescueNative': {
            const e = one('DustRescued');
            matched =
              !!e &&
              field(e, 'token') ===
                (action.name === 'rescueNative'
                  ? '0x' + '0'.repeat(40)
                  : String(action.args[0]).toLowerCase());
            break;
          }
        }
      }
      if (!matched) return mismatch;
      const snapshot = await readTradingSnapshot(
        context.rpc,
        context.manifest,
        this.inventory,
        context.block,
      );
      if (action.name === 'close' && !snapshot.closed)
        return { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' };
      if (['stop', 'revokeExecutor'].includes(action.name) && !snapshot.liquidating)
        return { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' };
      if (
        action.name === 'execute' &&
        BigInt(snapshot.stateVersion) < BigInt(action.args[0].expectedVersion) + 1n
      )
        return { status: 'MISMATCH', errorCode: 'CONTRACT_STATE_MISMATCH' };
      return { status: 'MATCH' };
    } catch {
      return mismatch;
    }
  }
}
