import { Interface, ZeroAddress, getAddress, keccak256 } from 'ethers';
import { uint } from '../../../../packages/launch-market/src/config.ts';
import type { LaunchMarketManifest, StrategyId } from '../../../../packages/launch-market/src/types.ts';
import type { Eip1193Provider } from '../chain-wallet.ts';
import { readExecutorSnapshot, type ExecutorSnapshot } from './executor.ts';

/** Owner execution settles actual AF-USDC and fixed test-stock inventory, never PASS price PnL. */
export const stockExecutionInterface = new Interface([
  'function targetStock() view returns(address)',
  'function stockReserve() view returns(address)',
  'function referenceFeed() view returns(address)',
  'function maxPriceAge() view returns(uint32)',
  'function trackedUsdcBalance() view returns(uint256)',
  'function trackedPosition(address token) view returns(uint256)',
  'function execute(bool buy,uint256 input,uint256 minOutput,uint64 deadline,uint256 expectedVersion) returns(uint256)',
]);
const factory = new Interface([
  'function strategy(uint8 index) view returns(tuple(address creator,address pass,address usdc,address targetStock,address otherStock,address stockReserve,address referenceFeed,bytes32 strategyRef,uint32 maxPriceAge))',
]);
const venue = new Interface([
  'function usdc() view returns(address)',
  'function stock() view returns(address)',
  'function feed() view returns(address)',
  'function maxPriceAge() view returns(uint32)',
  'function paused() view returns(bool)',
]);
const feed = new Interface([
  'function price() view returns(uint256,uint64,bytes32)',
  'function regularOpen() view returns(uint64)',
  'function regularClose() view returns(uint64)',
  'function calendarObservedAt() view returns(uint64)',
  'function calendarDigest() view returns(bytes32)',
  'function executionAllowed() view returns(bool)',
]);
const token = new Interface(['function balanceOf(address) view returns(uint256)']);
const zeroDigest = `0x${'00'.repeat(32)}`;
const same = (a: string, b: string) => getAddress(a) === getAddress(b);
const quantity = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error('INVALID_CHAIN_EVIDENCE');
  return BigInt(value);
};
const timestamp = (value: unknown): number => {
  const raw = BigInt(String(value));
  if (raw < 0n || raw > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_CHAIN_EVIDENCE');
  return Number(raw);
};

export type StockExecutionStatus =
  | 'UNINITIALIZED'
  | 'MARKET_CLOSED'
  | 'STALE_REFERENCE'
  | 'STALE_CALENDAR'
  | 'PAUSED'
  | 'VAULT_CLOSED'
  | 'READY';
export interface StockExecutionSnapshot extends ExecutorSnapshot {
  readonly targetStock: string;
  readonly stockReserve: string;
  readonly referenceFeed: string;
  readonly maxPriceAge: number;
  readonly trackedCashRaw: string;
  readonly trackedStockRaw: string;
  readonly vaultUsdcRaw: string;
  readonly vaultStockRaw: string;
  readonly reserveUsdcRaw: string;
  readonly reserveStockRaw: string;
  readonly stockPriceUsdcRaw: string;
  readonly referenceObservedAt: number;
  readonly referenceDigest: string;
  readonly regularOpen: number;
  readonly regularClose: number;
  readonly calendarObservedAt: number;
  readonly calendarDigest: string;
  readonly executionAllowed: boolean;
  readonly venuePaused: boolean;
  readonly status: StockExecutionStatus;
  readonly executionCutoff: number | null;
}
export interface StockExecutionReview {
  readonly snapshot: StockExecutionSnapshot;
  readonly buy: boolean;
  readonly inputRaw: string;
  readonly estimatedOutRaw: string;
  readonly minOutRaw: string;
  readonly slippageBps: number;
  readonly deadline: number;
  readonly data: string;
  readonly gasEstimateRaw: string;
  readonly reviewExpiresAt: number;
}
export interface StockExecutionPending {
  readonly owner: string;
  readonly vault: string;
  readonly strategyId: StrategyId;
  readonly data: string;
  readonly hash: string | null;
}

function referenceStatus(snapshot: Omit<StockExecutionSnapshot, 'status' | 'executionCutoff'>, now: number) {
  if (snapshot.closed) return 'VAULT_CLOSED';
  if (
    uint(snapshot.stockPriceUsdcRaw) === 0n ||
    snapshot.referenceDigest === zeroDigest ||
    snapshot.referenceObservedAt === 0 ||
    snapshot.calendarDigest === zeroDigest ||
    snapshot.calendarObservedAt === 0
  )
    return 'UNINITIALIZED';
  if (snapshot.referenceObservedAt > now || now - snapshot.referenceObservedAt > snapshot.maxPriceAge)
    return 'STALE_REFERENCE';
  if (snapshot.calendarObservedAt > now || now - snapshot.calendarObservedAt > 60) return 'STALE_CALENDAR';
  if (snapshot.regularOpen > now || now >= snapshot.regularClose || !snapshot.executionAllowed)
    return 'MARKET_CLOSED';
  if (snapshot.venuePaused) return 'PAUSED';
  return 'READY';
}

/** All contract reads share the factory-verified canonical block, including stock/calendar state. */
export async function readStockExecutionSnapshot(
  provider: Eip1193Provider,
  manifest: LaunchMarketManifest,
  owner: string,
  vault: string,
  strategyId: StrategyId,
): Promise<StockExecutionSnapshot> {
  if (manifest.chainId !== 46630 || !['TSLA', 'AMZN'].includes(strategyId))
    throw new Error('WALLET_WRONG_CHAIN');
  const base = await readExecutorSnapshot(provider, manifest, owner, vault, strategyId);
  const block = `0x${uint(base.blockNumber).toString(16)}`;
  async function call(address: string, abi: Interface, name: string, args: readonly unknown[] = []) {
    return abi.decodeFunctionResult(
      name,
      String(
        await provider.request({
          method: 'eth_call',
          params: [{ to: address, data: abi.encodeFunctionData(name, args) }, block],
        }),
      ),
    );
  }
  const configured = (
    await call(manifest.vaultFactory!, factory, 'strategy', [strategyId === 'TSLA' ? 0 : 1])
  )[0];
  const targetStock = getAddress(String(configured.targetStock));
  const stockReserve = getAddress(String(configured.stockReserve));
  const referenceFeed = getAddress(String(configured.referenceFeed));
  const maxPriceAge = Number(configured.maxPriceAge);
  if (
    !same(String(configured.pass), manifest.strategies[strategyId].pass) ||
    !same(String(configured.usdc), manifest.usdc) ||
    [targetStock, stockReserve, referenceFeed].includes(ZeroAddress) ||
    !Number.isSafeInteger(maxPriceAge) ||
    maxPriceAge < 1 ||
    maxPriceAge > 60
  )
    throw new Error('STOCK_ROUTE_MISMATCH');
  await Promise.all(
    [manifest.usdc, manifest.strategies[strategyId].pass, targetStock, stockReserve, referenceFeed].map(
      async (address) => {
        const code = String(await provider.request({ method: 'eth_getCode', params: [address, block] }));
        if (
          !/^0x(?:[0-9a-fA-F]{2})+$/.test(code) ||
          keccak256(code).toLowerCase() !== manifest.runtimeCodeHashes[address.toLowerCase()]?.toLowerCase()
        )
          throw new Error('STOCK_ROUTE_CODE_MISMATCH');
      },
    ),
  );
  const values = await Promise.all([
    call(vault, stockExecutionInterface, 'targetStock'),
    call(vault, stockExecutionInterface, 'stockReserve'),
    call(vault, stockExecutionInterface, 'referenceFeed'),
    call(vault, stockExecutionInterface, 'maxPriceAge'),
    call(vault, stockExecutionInterface, 'trackedUsdcBalance'),
    call(vault, stockExecutionInterface, 'trackedPosition', [targetStock]),
    call(stockReserve, venue, 'usdc'),
    call(stockReserve, venue, 'stock'),
    call(stockReserve, venue, 'feed'),
    call(stockReserve, venue, 'maxPriceAge'),
    call(stockReserve, venue, 'paused'),
    call(referenceFeed, feed, 'price'),
    call(referenceFeed, feed, 'regularOpen'),
    call(referenceFeed, feed, 'regularClose'),
    call(referenceFeed, feed, 'calendarObservedAt'),
    call(referenceFeed, feed, 'calendarDigest'),
    call(referenceFeed, feed, 'executionAllowed'),
    call(manifest.usdc, token, 'balanceOf', [vault]),
    call(targetStock, token, 'balanceOf', [vault]),
    call(manifest.usdc, token, 'balanceOf', [stockReserve]),
    call(targetStock, token, 'balanceOf', [stockReserve]),
  ]);
  if (
    !same(String(values[0]![0]), targetStock) ||
    !same(String(values[1]![0]), stockReserve) ||
    !same(String(values[2]![0]), referenceFeed) ||
    Number(values[3]![0]) !== maxPriceAge ||
    !same(String(values[6]![0]), manifest.usdc) ||
    !same(String(values[7]![0]), targetStock) ||
    !same(String(values[8]![0]), referenceFeed) ||
    Number(values[9]![0]) !== maxPriceAge
  )
    throw new Error('STOCK_ROUTE_MISMATCH');
  const snapshot = {
    ...base,
    targetStock,
    stockReserve,
    referenceFeed,
    maxPriceAge,
    trackedCashRaw: String(values[4]![0]),
    trackedStockRaw: String(values[5]![0]),
    vaultUsdcRaw: String(values[17]![0]),
    vaultStockRaw: String(values[18]![0]),
    reserveUsdcRaw: String(values[19]![0]),
    reserveStockRaw: String(values[20]![0]),
    stockPriceUsdcRaw: String(values[11]![0]),
    referenceObservedAt: timestamp(values[11]![1]),
    referenceDigest: String(values[11]![2]),
    regularOpen: timestamp(values[12]![0]),
    regularClose: timestamp(values[13]![0]),
    calendarObservedAt: timestamp(values[14]![0]),
    calendarDigest: String(values[15]![0]),
    executionAllowed: Boolean(values[16]![0]),
    venuePaused: Boolean(values[10]![0]),
  };
  if (
    uint(snapshot.trackedCashRaw) > uint(snapshot.vaultUsdcRaw) ||
    uint(snapshot.trackedStockRaw) > uint(snapshot.vaultStockRaw)
  )
    throw new Error('VAULT_TRACKED_BALANCE_MISMATCH');
  const pinned = (await provider.request({ method: 'eth_getBlockByNumber', params: [block, false] })) as {
    hash: string;
  } | null;
  if (!pinned || pinned.hash.toLowerCase() !== base.blockHash.toLowerCase())
    throw new Error('CHAIN_REORGANIZED');
  if (String(await provider.request({ method: 'eth_chainId' })).toLowerCase() !== '0xb626')
    throw new Error('WALLET_WRONG_CHAIN');
  const status = referenceStatus(snapshot, base.blockTimestamp);
  return {
    ...snapshot,
    status,
    executionCutoff:
      status === 'READY'
        ? Math.min(
            snapshot.referenceObservedAt + maxPriceAge,
            snapshot.calendarObservedAt + 60,
            snapshot.regularClose - 1,
          )
        : null,
  };
}

/** A reviewed owner trade is bounded by on-chain price/calendar freshness and actual inventories. */
export async function reviewStockExecution(
  provider: Eip1193Provider,
  snapshot: StockExecutionSnapshot,
  buy: boolean,
  inputRaw: string,
  slippageBps: number,
  now: number,
): Promise<StockExecutionReview> {
  if (
    !Number.isSafeInteger(now) ||
    now < snapshot.blockTimestamp ||
    !Number.isSafeInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 500
  )
    throw new Error('INVALID_STOCK_EXECUTION');
  const status = referenceStatus(snapshot, now);
  if (status !== 'READY') throw new Error(`STOCK_EXECUTION_${status}`);
  const input = uint(inputRaw),
    price = uint(snapshot.stockPriceUsdcRaw);
  if (!input || input > uint(buy ? snapshot.trackedCashRaw : snapshot.trackedStockRaw))
    throw new Error('INSUFFICIENT_VAULT_BALANCE');
  const output = buy ? (input * 10n ** 18n) / price : (input * price) / 10n ** 18n;
  const minimum = (output * BigInt(10000 - slippageBps)) / 10000n;
  if (output === 0n || minimum === 0n || output > 2n ** 256n - 1n) throw new Error('STOCK_EXECUTION_DUST');
  if (output > uint(buy ? snapshot.reserveStockRaw : snapshot.reserveUsdcRaw))
    throw new Error('INSUFFICIENT_TEST_STOCK_RESERVE');
  const deadline = Math.min(
    now + 60,
    snapshot.referenceObservedAt + snapshot.maxPriceAge,
    snapshot.calendarObservedAt + 60,
    snapshot.regularClose - 1,
  );
  if (deadline <= now) throw new Error('STOCK_EXECUTION_STALE_REFERENCE');
  const data = stockExecutionInterface.encodeFunctionData('execute', [
    buy,
    input,
    minimum,
    deadline,
    uint(snapshot.version),
  ]);
  const transaction = { from: snapshot.owner, to: snapshot.vault, data, value: '0x0' };
  if (String(await provider.request({ method: 'eth_chainId' })).toLowerCase() !== '0xb626')
    throw new Error('WALLET_WRONG_CHAIN');
  const canonical = (await provider.request({
    method: 'eth_getBlockByNumber',
    params: [`0x${uint(snapshot.blockNumber).toString(16)}`, false],
  })) as { hash: string } | null;
  if (!canonical || canonical.hash.toLowerCase() !== snapshot.blockHash.toLowerCase())
    throw new Error('CHAIN_REORGANIZED');
  await provider.request({ method: 'eth_call', params: [transaction, 'latest'] });
  const gas = quantity(await provider.request({ method: 'eth_estimateGas', params: [transaction] }));
  if (gas === 0n) throw new Error('INVALID_SIMULATION_EVIDENCE');
  return {
    snapshot,
    buy,
    inputRaw: String(input),
    estimatedOutRaw: String(output),
    minOutRaw: String(minimum),
    slippageBps,
    deadline,
    data,
    gasEstimateRaw: String(gas),
    reviewExpiresAt: deadline,
  };
}

/** Validate semantic execute calldata before consulting an actual saved transaction hash. */
function validatePending(pending: StockExecutionPending): void {
  getAddress(pending.owner);
  getAddress(pending.vault);
  if (!['TSLA', 'AMZN'].includes(pending.strategyId)) throw new Error('INVALID_STOCK_EXECUTION_RECEIPT');
  const parsed = stockExecutionInterface.parseTransaction({ data: pending.data, value: 0 });
  if (
    !parsed ||
    parsed.name !== 'execute' ||
    parsed.args[1] === 0n ||
    parsed.args[2] === 0n ||
    stockExecutionInterface.encodeFunctionData('execute', parsed.args).toLowerCase() !==
      pending.data.toLowerCase()
  )
    throw new Error('INVALID_STOCK_EXECUTION_RECEIPT');
}

export async function validateStockExecutionHash(
  provider: Eip1193Provider,
  pending: StockExecutionPending,
  hash: string,
): Promise<void> {
  validatePending(pending);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('INVALID_STOCK_EXECUTION_RECEIPT');
  if (String(await provider.request({ method: 'eth_chainId' })).toLowerCase() !== '0xb626')
    throw new Error('WALLET_WRONG_CHAIN');
  const transaction = (await provider.request({ method: 'eth_getTransactionByHash', params: [hash] })) as {
    hash: string;
    from: string;
    to: string;
    input: string;
    value: string;
  } | null;
  if (
    !transaction ||
    transaction.hash.toLowerCase() !== hash.toLowerCase() ||
    !same(transaction.from, pending.owner) ||
    !same(transaction.to, pending.vault) ||
    transaction.input.toLowerCase() !== pending.data.toLowerCase() ||
    quantity(transaction.value) !== 0n
  )
    throw new Error('INVALID_STOCK_EXECUTION_RECEIPT');
}

export async function stockExecutionReceipt(
  provider: Eip1193Provider,
  pending: StockExecutionPending,
): Promise<{
  state: 'SUBMITTED' | 'REORGED' | 'INCLUDED' | 'COMPLETED' | 'REVERTED';
  confirmations: number;
}> {
  validatePending(pending);
  if (!pending.hash || !/^0x[0-9a-fA-F]{64}$/.test(pending.hash))
    throw new Error('STOCK_EXECUTION_TRANSACTION_HASH_REQUIRED');
  if (String(await provider.request({ method: 'eth_chainId' })).toLowerCase() !== '0xb626')
    throw new Error('WALLET_WRONG_CHAIN');
  const receipt = (await provider.request({
    method: 'eth_getTransactionReceipt',
    params: [pending.hash],
  })) as {
    transactionHash: string;
    from: string;
    to: string;
    status: string;
    blockNumber: string;
    blockHash: string;
  } | null;
  if (!receipt) return { state: 'SUBMITTED', confirmations: 0 };
  if (
    receipt.transactionHash.toLowerCase() !== pending.hash.toLowerCase() ||
    !same(receipt.from, pending.owner) ||
    !same(receipt.to, pending.vault) ||
    !['0x0', '0x1'].includes(receipt.status) ||
    !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash)
  )
    throw new Error('INVALID_STOCK_EXECUTION_RECEIPT');
  await validateStockExecutionHash(provider, pending, pending.hash);
  const block = (await provider.request({
    method: 'eth_getBlockByNumber',
    params: [receipt.blockNumber, false],
  })) as { hash: string } | null;
  if (!block || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
    return { state: 'REORGED', confirmations: 0 };
  const transaction = (await provider.request({
    method: 'eth_getTransactionByHash',
    params: [pending.hash],
  })) as {
    blockNumber: string | null;
    blockHash: string | null;
  } | null;
  if (
    !transaction ||
    transaction.blockNumber !== receipt.blockNumber ||
    transaction.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase()
  )
    throw new Error('INVALID_STOCK_EXECUTION_RECEIPT');
  const depth =
    quantity(await provider.request({ method: 'eth_blockNumber' })) - quantity(receipt.blockNumber) + 1n;
  const confirmations = Number(depth < 0n ? 0n : depth > 3n ? 3n : depth);
  return {
    state: confirmations < 3 ? 'INCLUDED' : receipt.status === '0x1' ? 'COMPLETED' : 'REVERTED',
    confirmations,
  };
}
