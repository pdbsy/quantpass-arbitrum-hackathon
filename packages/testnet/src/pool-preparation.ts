import { Interface, keccak256 } from 'ethers';
import type { ReadonlyRpc } from '../../chain-adapter/src/rpc.ts';
import type { DeploymentManifest } from '../../chain-adapter/src/manifest.ts';
import { asAddress, asHexData, asBlockHash } from '../../chain-adapter/src/types.ts';
import { readTradingSnapshot } from './trading-reader.ts';
import type { TradingInventory } from './trading-inventory.ts';
import { captureReferenceBatch } from '../../market-data/src/batch.ts';
import type { ReadTransport } from '../../market-data/src/capture.ts';
import { advanceReferenceEngine, createReferenceEngine, type ReferenceTerms } from './reference-engine.ts';
import { evidenceHash } from './executor-plan.ts';
import { preparePoolInitialization } from './pool-init-plan.ts';
import { walletAddress } from './address.ts';
import { tokenInterface } from './trading-abi.ts';
export const seederInterface = new Interface([
  'function owner() view returns(address)',
  'function factory() view returns(address)',
  'function usdc() view returns(address)',
  'function stocks(uint256) view returns(address)',
]);
const pool = new Interface(['function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)']);
export interface PoolBudget {
  readonly stock: string;
  readonly pool: string;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: string;
  readonly maxUsdc: string;
  readonly maxStock: string;
}
/** Fresh read-only qualification and official capture. Produces unsigned calls, never moves LP capital. */
export async function prepareVerifiedPools(options: {
  rpc: ReadonlyRpc;
  manifest: DeploymentManifest;
  inventory: TradingInventory;
  owner: string;
  seeder: string;
  seederCodeHash: string;
  terms: readonly ReferenceTerms[];
  budgets: readonly PoolBudget[];
  transport?: ReadTransport;
  now?: () => number;
}) {
  const { rpc, manifest, inventory } = options,
    owner = walletAddress(options.owner),
    seeder = walletAddress(options.seeder),
    now = options.now ?? Date.now;
  createReferenceEngine(options.terms);
  if (
    options.budgets.length !== 3 ||
    options.budgets.some(
      (b, i) =>
        Object.keys(b).length !== 7 ||
        Object.keys(b).some(
          (k) => !['stock', 'pool', 'tickLower', 'tickUpper', 'liquidity', 'maxUsdc', 'maxStock'].includes(k),
        ) ||
        walletAddress(b.stock) !== inventory.stocks[i]!.token ||
        walletAddress(b.pool) !== inventory.stocks[i]!.pool,
    ) ||
    inventory.stocks.some((s, i) => s.referenceIdentity !== evidenceHash(options.terms[i])) ||
    owner === manifest.contractAddress ||
    inventory.codeHashes.some((c) => c.address === owner) ||
    !/^0x[a-f0-9]{64}$/.test(options.seederCodeHash)
  )
    throw new Error('POOL_PREPARATION_INPUT');
  const snapshot = await readTradingSnapshot(rpc, manifest, inventory),
    reference = { blockHash: asBlockHash(snapshot.blockHash), requireCanonical: true } as const;
  if (
    (await rpc.code(asAddress(owner), reference)) !== '0x' ||
    keccak256(await rpc.code(asAddress(seeder), reference)) !== options.seederCodeHash
  )
    throw new Error('POOL_OPERATOR_IDENTITY');
  const call = async (to: string, abi: Interface, method: string, args: readonly unknown[] = []) =>
    abi.decodeFunctionResult(
      method,
      await rpc.call({ to: asAddress(to), data: asHexData(abi.encodeFunctionData(method, args)) }, reference),
    );
  for (const [method, expected] of [
    ['owner', owner],
    ['factory', inventory.factory],
    ['usdc', inventory.usdc],
  ])
    if (String((await call(seeder, seederInterface, method!))[0]).toLowerCase() !== expected)
      throw new Error('POOL_SEEDER_IDENTITY');
  for (let i = 0; i < 3; i++)
    if (
      String((await call(seeder, seederInterface, 'stocks', [i]))[0]).toLowerCase() !==
      inventory.stocks[i]!.token
    )
      throw new Error('POOL_SEEDER_IDENTITY');
  const batch = await captureReferenceBatch(
    {
      selections: options.terms.map((t) => {
        const [chain, address] = t.identity.split(':');
        return { chainId: Number(chain) as 4663 | 46630, contractAddress: address!, symbol: t.symbol };
      }),
      maxAgeMs: 30000,
      maxQuoteSkewMs: 10000,
      maxCaptureSpanMs: 30000,
    },
    options.transport,
    now,
  );
  const result = advanceReferenceEngine(createReferenceEngine(options.terms), batch);
  if (!result.quotes || result.state.paused) throw new Error('POOL_REFERENCE_BLOCKED');
  if (
    result.quotes.some(
      (q) => now() - Number(q.observedAt) * 1000 > 30000 || Number(q.observedAt) * 1000 > now(),
    )
  )
    throw new Error('POOL_REFERENCE_STALE');
  const plans = preparePoolInitialization(
    owner,
    inventory.usdc,
    seeder,
    options.budgets.map((b, i) => ({ ...b, priceUsdc: result.quotes![i]!.priceUsdc })),
  );
  const totalUsdc = options.budgets.reduce((n, b) => n + BigInt(b.maxUsdc), 0n);
  if (BigInt((await call(inventory.usdc, tokenInterface, 'balanceOf', [owner]))[0]) < totalUsdc)
    throw new Error('POOL_OPERATOR_BUDGET');
  const pools = [];
  for (let i = 0; i < 3; i++) {
    const b = options.budgets[i]!,
      state = await call(b.pool, pool, 'slot0');
    if (BigInt((await call(b.stock, tokenInterface, 'balanceOf', [owner]))[0]) < BigInt(b.maxStock))
      throw new Error('POOL_OPERATOR_BUDGET');
    pools.push({
      ...plans[i]!,
      initialize: BigInt(state[0]) === 0n ? plans[i]!.initialize : null,
      alreadyInitialized: BigInt(state[0]) !== 0n,
      currentSqrtPriceX96: String(state[0]),
    });
  }
  const canonical = await rpc.block(BigInt(snapshot.blockNumber));
  if (!canonical || canonical.hash !== snapshot.blockHash) throw new Error('POOL_PREPARATION_REORG');
  return Object.freeze({
    schemaVersion: 1,
    chainId: 46630,
    scope: 'TEST_SUBSTITUTES_OPERATOR_LP_ONLY',
    owner,
    seeder,
    verifiedBlock: snapshot.blockNumber,
    verifiedBlockHash: snapshot.blockHash,
    referenceBatch: batch,
    sourceDigest: result.sourceDigest,
    pools,
    signatures: 'NOT_RUN',
    broadcast: 'NOT_RUN',
  });
}
