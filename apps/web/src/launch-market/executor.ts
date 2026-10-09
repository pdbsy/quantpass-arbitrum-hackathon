import { Interface, ZeroAddress, getAddress, keccak256 } from 'ethers';
import { uint } from '../../../../packages/launch-market/src/config.ts';
import type { LaunchMarketManifest, StrategyId } from '../../../../packages/launch-market/src/types.ts';
import type { Eip1193Provider } from '../chain-wallet.ts';

/** This is the owner-isolated launch Vault ABI, not the older trading Vault grant. */
export const executorInterface = new Interface([
  'function owner() view returns(address)',
  'function pass() view returns(address)',
  'function afUsdc() view returns(address)',
  'function closed() view returns(bool)',
  'function executionVersion() view returns(uint256)',
  'function totalBuyUsdc() view returns(uint256)',
  'function grant() view returns(address executor,uint64 expiresAt,uint256 maxOrderUsdc,uint256 maxTotalBuyUsdc,uint16 maxSlippageBps)',
  'function configureExecutor((address executor,uint64 expiresAt,uint256 maxOrderUsdc,uint256 maxTotalBuyUsdc,uint16 maxSlippageBps) next)',
  'function revokeExecutor()',
]);
const factoryInterface = new Interface(['function vaults(address owner,uint8 index) view returns(address)']);
export interface ExecutorPermission {
  readonly executor: string;
  readonly expiresAt: string;
  readonly maxOrderUsdc: string;
  readonly maxTotalBuyUsdc: string;
  readonly maxSlippageBps: number;
}
export interface ExecutorSnapshot {
  readonly strategyId: StrategyId;
  readonly owner: string;
  readonly vault: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly blockTimestamp: number;
  readonly closed: boolean;
  readonly version: string;
  readonly totalBuyUsdc: string;
  readonly grant: ExecutorPermission;
}
export interface ExecutorReview {
  readonly kind: 'CONFIGURE' | 'REVOKE';
  readonly snapshot: ExecutorSnapshot;
  readonly permission: ExecutorPermission | null;
  readonly data: string;
  readonly gasEstimateRaw: string;
  readonly reviewExpiresAt: number;
}
export interface ExecutorPending {
  readonly owner: string;
  readonly vault: string;
  readonly strategyId: StrategyId;
  readonly kind: ExecutorReview['kind'];
  readonly data: string;
  readonly hash: string | null;
}
export const executorJournalKey = 'alphaforge:46630:pending-executor-transaction:v1';
const same = (a: string, b: string) => getAddress(a) === getAddress(b);
const quantity = (raw: unknown): bigint => {
  if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error('INVALID_CHAIN_EVIDENCE');
  return BigInt(raw);
};

export function validatePermission(permission: ExecutorPermission, snapshot: ExecutorSnapshot): void {
  const executor = getAddress(permission.executor);
  if (
    executor === ZeroAddress ||
    same(executor, snapshot.owner) ||
    same(executor, snapshot.vault) ||
    uint(permission.expiresAt) >= 2n ** 64n ||
    !Number.isFinite(new Date(Number(permission.expiresAt) * 1000).getTime()) ||
    uint(permission.expiresAt) <= BigInt(snapshot.blockTimestamp) ||
    uint(permission.maxOrderUsdc) === 0n ||
    uint(permission.maxTotalBuyUsdc) === 0n ||
    uint(permission.maxOrderUsdc) > uint(permission.maxTotalBuyUsdc) ||
    !Number.isSafeInteger(permission.maxSlippageBps) ||
    permission.maxSlippageBps < 0 ||
    permission.maxSlippageBps > 500
  )
    throw new Error('INVALID_EXECUTOR_PERMISSION');
}

/** Every authorization starts from pinned, fresh wallet RPC reads and trusted factory membership. */
export async function readExecutorSnapshot(
  provider: Eip1193Provider,
  manifest: LaunchMarketManifest,
  owner: string,
  vault: string,
  strategyId: StrategyId,
): Promise<ExecutorSnapshot> {
  if (String(await provider.request({ method: 'eth_chainId' })).toLowerCase() !== '0xb626')
    throw new Error('WALLET_WRONG_CHAIN');
  const block = (await provider.request({ method: 'eth_getBlockByNumber', params: ['latest', false] })) as {
    number: string;
    hash: string;
    timestamp: string;
  } | null;
  if (!block || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) throw new Error('INVALID_CHAIN_EVIDENCE');
  const blockNumber = quantity(block.number);
  const blockTimestamp = quantity(block.timestamp);
  if (blockTimestamp > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_CHAIN_EVIDENCE');
  const factory = manifest.vaultFactory;
  if (!factory) throw new Error('VAULT_FACTORY_UNAVAILABLE');
  const code = String(await provider.request({ method: 'eth_getCode', params: [factory, block.number] }));
  if (keccak256(code).toLowerCase() !== manifest.runtimeCodeHashes[factory.toLowerCase()]?.toLowerCase())
    throw new Error('VAULT_FACTORY_CODE_MISMATCH');
  const registered = String(
    await provider.request({
      method: 'eth_call',
      params: [
        {
          to: factory,
          data: factoryInterface.encodeFunctionData('vaults', [owner, strategyId === 'TSLA' ? 0 : 1]),
        },
        block.number,
      ],
    }),
  );
  if (!same(String(factoryInterface.decodeFunctionResult('vaults', registered)[0]), vault))
    throw new Error('VAULT_IDENTITY_CHANGED');
  const names = ['owner', 'pass', 'afUsdc', 'closed', 'executionVersion', 'totalBuyUsdc', 'grant'] as const;
  const values = await Promise.all(
    names.map(async (name) =>
      executorInterface.decodeFunctionResult(
        name,
        String(
          await provider.request({
            method: 'eth_call',
            params: [{ to: vault, data: executorInterface.encodeFunctionData(name) }, block.number],
          }),
        ),
      ),
    ),
  );
  if (
    !same(String(values[0]![0]), owner) ||
    !same(String(values[1]![0]), manifest.strategies[strategyId].pass) ||
    !same(String(values[2]![0]), manifest.usdc)
  )
    throw new Error('VAULT_IDENTITY_CHANGED');
  const pinned = (await provider.request({
    method: 'eth_getBlockByNumber',
    params: [block.number, false],
  })) as { hash: string } | null;
  if (!pinned || pinned.hash.toLowerCase() !== block.hash.toLowerCase()) throw new Error('CHAIN_REORGANIZED');
  const grant = values[6]!;
  return {
    strategyId,
    owner: getAddress(owner),
    vault: getAddress(vault),
    blockNumber: String(blockNumber),
    blockHash: block.hash,
    blockTimestamp: Number(blockTimestamp),
    closed: Boolean(values[3]![0]),
    version: String(values[4]![0]),
    totalBuyUsdc: String(values[5]![0]),
    grant: {
      executor: String(grant[0]),
      expiresAt: String(grant[1]),
      maxOrderUsdc: String(grant[2]),
      maxTotalBuyUsdc: String(grant[3]),
      maxSlippageBps: Number(grant[4]),
    },
  };
}

export async function reviewExecutor(
  provider: Eip1193Provider,
  snapshot: ExecutorSnapshot,
  permission: ExecutorPermission | null,
  now: number,
): Promise<ExecutorReview> {
  if (permission) {
    if (snapshot.closed) throw new Error('VAULT_CLOSED');
    validatePermission(permission, snapshot);
  }
  const kind = permission ? 'CONFIGURE' : 'REVOKE';
  const data = executorInterface.encodeFunctionData(
    permission ? 'configureExecutor' : 'revokeExecutor',
    permission ? [permission] : [],
  );
  const transaction = { from: snapshot.owner, to: snapshot.vault, data, value: '0x0' };
  await provider.request({ method: 'eth_call', params: [transaction, 'latest'] });
  const gas = quantity(await provider.request({ method: 'eth_estimateGas', params: [transaction] }));
  if (gas === 0n) throw new Error('INVALID_SIMULATION_EVIDENCE');
  return {
    kind,
    snapshot,
    permission: permission ? structuredClone(permission) : null,
    data,
    gasEstimateRaw: String(gas),
    reviewExpiresAt: now + 120,
  };
}

/** Browser persistence is only an actual transaction identifier/calldata, never an asset projection. */
export function readExecutorJournal(storage: Pick<Storage, 'getItem'> | undefined): ExecutorPending | null {
  try {
    const raw = storage?.getItem(executorJournalKey);
    if (!raw || raw.length > 2000) return null;
    const item = JSON.parse(raw) as ExecutorPending;
    if (
      !['CONFIGURE', 'REVOKE'].includes(item.kind) ||
      !['TSLA', 'AMZN'].includes(item.strategyId) ||
      (item.hash !== null && !/^0x[0-9a-fA-F]{64}$/.test(item.hash))
    )
      return null;
    getAddress(item.owner);
    getAddress(item.vault);
    const decoded = executorInterface.parseTransaction({ data: item.data, value: 0 })!;
    if (decoded.name !== (item.kind === 'CONFIGURE' ? 'configureExecutor' : 'revokeExecutor')) return null;
    return item;
  } catch {
    return null;
  }
}

export async function executorReceipt(
  provider: Eip1193Provider,
  pending: ExecutorPending,
): Promise<{
  state: 'SUBMITTED' | 'REORGED' | 'INCLUDED' | 'COMPLETED' | 'REVERTED';
  confirmations: number;
}> {
  if (!pending.hash) throw new Error('EXECUTOR_TRANSACTION_HASH_REQUIRED');
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
    throw new Error('INVALID_EXECUTOR_RECEIPT');
  await validateExecutorHash(provider, pending, pending.hash);
  const block = (await provider.request({
    method: 'eth_getBlockByNumber',
    params: [receipt.blockNumber, false],
  })) as { hash: string } | null;
  if (!block || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
    return { state: 'REORGED', confirmations: 0 };
  const depth =
    quantity(await provider.request({ method: 'eth_blockNumber' })) - quantity(receipt.blockNumber) + 1n;
  const confirmations = Number(depth < 0n ? 0n : depth > 3n ? 3n : depth);
  return {
    state: confirmations < 3 ? 'INCLUDED' : receipt.status === '0x1' ? 'COMPLETED' : 'REVERTED',
    confirmations,
  };
}

export async function validateExecutorHash(
  provider: Eip1193Provider,
  pending: ExecutorPending,
  hash: string,
): Promise<void> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('INVALID_EXECUTOR_RECEIPT');
  if (String(await provider.request({ method: 'eth_chainId' })).toLowerCase() !== '0xb626')
    throw new Error('WALLET_WRONG_CHAIN');
  const transaction = (await provider.request({
    method: 'eth_getTransactionByHash',
    params: [hash],
  })) as {
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
    throw new Error('INVALID_EXECUTOR_RECEIPT');
}
