import { Interface } from 'ethers';
import { walletAddress } from './address.ts';
import { initialPoolSqrtPrice } from './deployment-plan.ts';
import { tokenInterface } from './trading-abi.ts';

interface PoolInitialization {
  readonly stock: string;
  readonly pool: string;
  readonly priceUsdc: string;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: string;
  readonly maxUsdc: string;
  readonly maxStock: string;
}
/** LP capital belongs to the explicit operator; user Vault capital is never an initialization source. */
export function preparePoolInitialization(
  owner: string,
  usdc: string,
  seeder: string,
  pools: readonly PoolInitialization[],
) {
  const from = walletAddress(owner),
    cash = walletAddress(usdc),
    target = walletAddress(seeder);
  if (
    pools.length !== 3 ||
    new Set(pools.map((p) => walletAddress(p.pool))).size !== 3 ||
    new Set(pools.map((p) => walletAddress(p.stock))).size !== 3
  )
    throw new Error('POOL_INITIALIZATION_IDENTITY');
  const abi = new Interface([
    'function seed(address stock,int24 lower,int24 upper,uint128 liquidity,uint256 maxUsdc,uint256 maxStock) returns(uint256,uint256)',
  ]);
  const call = (to: string, data: string) => Object.freeze({ chainId: 46630, from, to, value: '0', data });
  return Object.freeze(
    pools.map((p) => {
      if (
        Object.keys(p).length !== 8 ||
        !Number.isSafeInteger(p.tickLower) ||
        !Number.isSafeInteger(p.tickUpper) ||
        p.tickLower < -887220 ||
        p.tickUpper > 887220 ||
        p.tickLower >= p.tickUpper ||
        p.tickLower % 60 !== 0 ||
        p.tickUpper % 60 !== 0 ||
        ![p.liquidity, p.maxUsdc, p.maxStock].every((v) => /^[1-9][0-9]{0,77}$/.test(v)) ||
        BigInt(p.liquidity) >= 2n ** 128n ||
        BigInt(p.maxUsdc) >= 2n ** 256n ||
        BigInt(p.maxStock) >= 2n ** 256n
      )
        throw new Error('POOL_INITIALIZATION_BUDGET');
      const stock = walletAddress(p.stock),
        pool = walletAddress(p.pool),
        sqrt = initialPoolSqrtPrice(cash, stock, p.priceUsdc);
      if ([from, target, cash].includes(stock) || [from, target, cash, stock].includes(pool))
        throw new Error('POOL_INITIALIZATION_IDENTITY');
      return Object.freeze({
        stock,
        pool,
        referencePriceUsdc: p.priceUsdc,
        requiresCanonicalFactoryPoolVerification: true,
        requiresFreshOfficialReference: true,
        initialize: call(
          pool,
          new Interface(['function initialize(uint160)']).encodeFunctionData('initialize', [sqrt]),
        ),
        approveUsdc: call(cash, tokenInterface.encodeFunctionData('approve', [target, p.maxUsdc])),
        approveStock: call(stock, tokenInterface.encodeFunctionData('approve', [target, p.maxStock])),
        seed: call(
          target,
          abi.encodeFunctionData('seed', [
            stock,
            p.tickLower,
            p.tickUpper,
            p.liquidity,
            p.maxUsdc,
            p.maxStock,
          ]),
        ),
        clearUsdcApproval: call(cash, tokenInterface.encodeFunctionData('approve', [target, 0])),
        clearStockApproval: call(stock, tokenInterface.encodeFunctionData('approve', [target, 0])),
        signatures: 'NOT_RUN',
        broadcast: 'NOT_RUN',
      });
    }),
  );
}
