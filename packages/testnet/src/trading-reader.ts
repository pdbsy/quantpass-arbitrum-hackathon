import { Interface, keccak256 } from 'ethers';
import type { DeploymentManifest } from '../../chain-adapter/src/manifest.ts';
import type { ReadonlyRpc, ChainBlock } from '../../chain-adapter/src/rpc.ts';
import { asAddress, asHexData } from '../../chain-adapter/src/types.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../../chain-adapter/src/pass-abi.ts';
import type { TradingInventory } from './trading-inventory.ts';
import {
  tradingInterface,
  tradingAbiHash,
  tradingAbiVersion,
  tokenInterface,
  feedInterface,
  venueInterface,
  factoryInterface,
  poolInterface,
} from './trading-abi.ts';

export interface TradingSnapshot {
  readonly maxPriceAge: number;
  readonly chainId: 46630;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly blockTimestamp: string;
  readonly manifestDigest: string;
  readonly owner: string;
  readonly vault: string;
  readonly pass: string;
  readonly stateVersion: string;
  readonly grantVersion: string;
  readonly principalBasis: string;
  readonly idleCash: string;
  readonly runtimeCash: string;
  readonly runtimeUnits: string;
  readonly lockedPass: string;
  readonly totalBuyUsdc: string;
  readonly closed: boolean;
  readonly liquidating: boolean;
  readonly liquidationUntil: string;
  readonly lowerUnitNav: string;
  readonly upperUnitNav: string;
  readonly grant: Readonly<{
    executor: string;
    expiresAt: string;
    liquidationWindow: string;
    maxOrderUsdc: string;
    maxTotalBuyUsdc: string;
    maxSlippageBps: string;
  }>;
  readonly stocks: readonly Readonly<{
    symbol: string;
    token: string;
    feed: string;
    pool: string;
    position: string;
    priceUsdc: string;
    observedAt: string;
    sourceDigest: string;
    priceValid: boolean;
    lowerPrice: string;
    upperPrice: string;
  }>[];
  readonly runtimeEquity: string | null;
  readonly vaultEquity: string | null;
  readonly unitNav: string | null;
  readonly valuation: 'VALID' | 'STALE_REFERENCE';
  readonly testAssets: true;
}
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
/** Validate identities and balances at one EIP-1898 snapshot, then verify its canonical hash again. */
export async function readTradingSnapshot(
  rpc: ReadonlyRpc,
  manifest: DeploymentManifest,
  inventory: TradingInventory,
  selectedBlock?: ChainBlock,
): Promise<TradingSnapshot> {
  if (
    manifest.contractName !== 'AlphaForgeTradingVault' ||
    manifest.contractType !== 'vault' ||
    manifest.abiVersion !== tradingAbiVersion ||
    !same(manifest.abiHash, tradingAbiHash) ||
    !same(manifest.strategyPassAbiHash, M3_STRATEGY_PASS_ABI_HASH) ||
    !same(inventory.deploymentManifestDigest, manifest.manifestDigest)
  )
    throw new Error('TRADING_DEPLOYMENT_IDENTITY');
  if ((await rpc.chainId()) !== 46630) throw new Error('TRADING_WRONG_CHAIN');
  const block = selectedBlock ?? (await rpc.block('latest'));
  if (
    !block ||
    block.number < manifest.deploymentBlock ||
    block.number < manifest.strategyPassDeploymentBlock
  )
    throw new Error('TRADING_BLOCK');
  const reference = { blockHash: block.hash, requireCanonical: true } as const;
  if ((await rpc.code(asAddress(inventory.owner), reference)) !== '0x')
    throw new Error('TRADING_EOA_OWNER_REQUIRED');
  const call = async (address: string, abi: Interface, method: string, args: readonly unknown[] = []) =>
    abi.decodeFunctionResult(
      method,
      await rpc.call(
        { to: asAddress(address), data: asHexData(abi.encodeFunctionData(method, args)) },
        reference,
      ),
    );
  const read = async (method: string, args: readonly unknown[] = []) =>
    (await call(manifest.contractAddress, tradingInterface, method, args))[0] as bigint | string | boolean;
  const codeHashes = [
    { address: manifest.contractAddress, hash: manifest.runtimeBytecodeHash },
    { address: manifest.strategyPassAddress, hash: manifest.strategyPassRuntimeBytecodeHash },
    ...inventory.codeHashes,
  ];
  if (new Set(codeHashes.map((c) => c.address.toLowerCase())).size !== codeHashes.length)
    throw new Error('TRADING_DEPLOYMENT_IDENTITY');
  await Promise.all(
    codeHashes.map(async (c) => {
      const code = await rpc.code(asAddress(c.address), reference);
      if (code === '0x' || !same(keccak256(code), c.hash)) throw new Error('TRADING_CODE_MISMATCH');
    }),
  );
  const uints = [
    'stateVersion',
    'grantVersion',
    'principalBasis',
    'idleCash',
    'runtimeCash',
    'runtimeUnits',
    'totalBuyUsdc',
    'openTrackedPositionCount',
    'liquidationUntil',
    'lowerUnitNav',
    'upperUnitNav',
  ] as const;
  const state = Object.fromEntries(
    await Promise.all(uints.map(async (method) => [method, BigInt(await read(method)).toString()])),
  ) as Record<(typeof uints)[number], string>;
  const identities = [
    ['owner', inventory.owner],
    ['pass', manifest.strategyPassAddress],
    ['afUsdc', inventory.usdc],
    ['router', inventory.router],
    ['passLocker', inventory.passLocker],
  ];
  await Promise.all(
    identities.map(async ([method, expected]) => {
      if (!method || !same(await read(method), expected)) throw new Error('TRADING_IMMUTABLE_MISMATCH');
    }),
  );
  if (BigInt(await read('maxPriceAge')) !== BigInt(inventory.maxPriceAge))
    throw new Error('TRADING_IMMUTABLE_MISMATCH');
  const strategyId = await read('strategyId');
  if (!same(strategyId, (await call(manifest.strategyPassAddress, tokenInterface, 'strategyId'))[0]))
    throw new Error('TRADING_PASS_MISMATCH');
  const [
    closed,
    liquidating,
    grantResult,
    lockedResult,
    cashResult,
    usdcDecimals,
    passDecimals,
    routerFactory,
    quoterFactory,
    passBacking,
    cashAllowance,
  ] = await Promise.all([
    read('closed'),
    read('liquidating'),
    call(manifest.contractAddress, tradingInterface, 'grant'),
    call(inventory.passLocker, tokenInterface, 'lockedBalance'),
    call(inventory.usdc, tokenInterface, 'balanceOf', [manifest.contractAddress]),
    call(inventory.usdc, tokenInterface, 'decimals'),
    call(manifest.strategyPassAddress, tokenInterface, 'decimals'),
    call(inventory.router, venueInterface, 'factory'),
    call(inventory.quoter, venueInterface, 'factory'),
    call(manifest.strategyPassAddress, tokenInterface, 'balanceOf', [inventory.passLocker]),
    call(inventory.usdc, tokenInterface, 'allowance', [manifest.contractAddress, inventory.router]),
  ]);
  const lockedPass = BigInt(lockedResult[0]),
    cash = BigInt(cashResult[0]);
  if (
    usdcDecimals[0] !== 6n ||
    passDecimals[0] !== 18n ||
    lockedPass !== BigInt(state.principalBasis) * 10n ** 12n ||
    cash < BigInt(state.idleCash) + BigInt(state.runtimeCash) ||
    BigInt(passBacking[0]) < lockedPass ||
    BigInt(cashAllowance[0]) !== 0n
  )
    throw new Error('TRADING_BACKING_MISMATCH');
  if (!same(routerFactory[0], inventory.factory) || !same(quoterFactory[0], inventory.factory))
    throw new Error('TRADING_VENUE_MISMATCH');
  const stocks = await Promise.all(
    inventory.stocks.map(async (stock, i) => {
      const [
        token,
        feed,
        position,
        lowerPrice,
        upperPrice,
        quote,
        keeper,
        referenceIdentity,
        balance,
        decimals,
        pool,
        factory,
        token0,
        token1,
        fee,
        allowance,
      ] = await Promise.all([
        read('stocks', [i]),
        read('feeds', [i]),
        read('trackedPosition', [stock.token]),
        read('lowerPrice', [i]),
        read('upperPrice', [i]),
        call(stock.feed, feedInterface, 'price'),
        call(stock.feed, feedInterface, 'keeper'),
        call(stock.feed, feedInterface, 'referenceIdentity'),
        call(stock.token, tokenInterface, 'balanceOf', [manifest.contractAddress]),
        call(stock.token, tokenInterface, 'decimals'),
        call(inventory.factory, factoryInterface, 'getPool', [inventory.usdc, stock.token, 3000]),
        call(stock.pool, poolInterface, 'factory'),
        call(stock.pool, poolInterface, 'token0'),
        call(stock.pool, poolInterface, 'token1'),
        call(stock.pool, poolInterface, 'fee'),
        call(stock.token, tokenInterface, 'allowance', [manifest.contractAddress, inventory.router]),
      ]);
      if (
        !same(token, stock.token) ||
        !same(feed, stock.feed) ||
        !same(keeper[0], stock.keeper) ||
        !same(referenceIdentity[0], stock.referenceIdentity)
      )
        throw new Error('TRADING_ASSET_MISMATCH');
      if (
        !same(pool[0], stock.pool) ||
        !same(factory[0], inventory.factory) ||
        fee[0] !== 3000n ||
        JSON.stringify([String(token0[0]).toLowerCase(), String(token1[0]).toLowerCase()].sort()) !==
          JSON.stringify([stock.token, inventory.usdc].sort())
      )
        throw new Error('TRADING_VENUE_MISMATCH');
      if (decimals[0] !== 18n || BigInt(balance[0]) < BigInt(position) || BigInt(allowance[0]) !== 0n)
        throw new Error('TRADING_BACKING_MISMATCH');
      const price = BigInt(quote[0]),
        observed = BigInt(quote[1]),
        source = String(quote[2]).toLowerCase();
      const valid =
        price > 0n &&
        !/^0x0+$/.test(source) &&
        observed <= block.timestamp &&
        block.timestamp - observed <= BigInt(inventory.maxPriceAge);
      return Object.freeze({
        symbol: stock.symbol,
        token: stock.token,
        feed: stock.feed,
        pool: stock.pool,
        position: String(position),
        priceUsdc: String(price),
        observedAt: String(observed),
        sourceDigest: source,
        priceValid: valid,
        lowerPrice: String(lowerPrice),
        upperPrice: String(upperPrice),
      });
    }),
  );
  const count = stocks.filter((s) => BigInt(s.position) > 0n).length;
  if (
    BigInt(state.openTrackedPositionCount) !== BigInt(count) ||
    (closed &&
      (state.principalBasis !== '0' ||
        state.runtimeUnits !== '0' ||
        state.idleCash !== '0' ||
        state.runtimeCash !== '0' ||
        count !== 0))
  )
    throw new Error('TRADING_ACCOUNTING_MISMATCH');
  const valid = stocks.every((s) => s.position === '0' || s.priceValid);
  const equity = valid
    ? BigInt(state.runtimeCash) +
      stocks.reduce((total, s) => total + (BigInt(s.position) * BigInt(s.priceUsdc)) / 10n ** 18n, 0n)
    : null;
  const confirmed = await rpc.block(block.number);
  if (confirmed?.hash !== block.hash) throw new Error('TRADING_REORG');
  return Object.freeze({
    maxPriceAge: inventory.maxPriceAge,
    chainId: 46630,
    blockNumber: String(block.number),
    blockHash: block.hash,
    blockTimestamp: String(block.timestamp),
    manifestDigest: manifest.manifestDigest,
    owner: inventory.owner,
    vault: manifest.contractAddress,
    pass: manifest.strategyPassAddress,
    stateVersion: state.stateVersion,
    grantVersion: state.grantVersion,
    principalBasis: state.principalBasis,
    idleCash: state.idleCash,
    runtimeCash: state.runtimeCash,
    runtimeUnits: state.runtimeUnits,
    lockedPass: String(lockedPass),
    totalBuyUsdc: state.totalBuyUsdc,
    closed: Boolean(closed),
    liquidating: Boolean(liquidating),
    liquidationUntil: state.liquidationUntil,
    lowerUnitNav: state.lowerUnitNav,
    upperUnitNav: state.upperUnitNav,
    grant: Object.freeze({
      executor: String(grantResult[0]).toLowerCase(),
      expiresAt: String(grantResult[1]),
      liquidationWindow: String(grantResult[2]),
      maxOrderUsdc: String(grantResult[3]),
      maxTotalBuyUsdc: String(grantResult[4]),
      maxSlippageBps: String(grantResult[5]),
    }),
    stocks: Object.freeze(stocks),
    runtimeEquity: equity === null ? null : String(equity),
    vaultEquity: equity === null ? null : String(equity + BigInt(state.idleCash)),
    unitNav:
      equity === null
        ? null
        : state.runtimeUnits === '0'
          ? '0'
          : String((equity * 10n ** 18n) / BigInt(state.runtimeUnits)),
    valuation: valid ? 'VALID' : 'STALE_REFERENCE',
    testAssets: true,
  });
}
