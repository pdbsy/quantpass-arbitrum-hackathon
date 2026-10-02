import { ContractFactory, Interface, getCreateAddress, type InterfaceAbi } from 'ethers';
import { walletAddress } from './address.ts';
import { evidenceHash } from './executor-plan.ts';
import { tradingInterface } from './trading-abi.ts';
import type { ReferenceTerms } from './reference-engine.ts';

export interface DeploymentArtifact {
  readonly abi: InterfaceAbi;
  readonly bytecode: string;
  readonly runtimeBytes: number;
  readonly sha256: string;
}
export interface DeploymentWorksheet {
  readonly schemaVersion: 1;
  readonly chainId: 46630;
  readonly kind: 'UNSIGNED_TESTNET_DEPLOYMENT';
  readonly deployer: string;
  readonly creator: string;
  readonly executor: string;
  readonly keeper: string;
  readonly nonce: number;
  readonly owners: readonly string[];
  readonly strategyId: string;
  readonly strategyRef: string;
  readonly usdcSupply: string;
  readonly passSupply: string;
  readonly stockSupplies: readonly string[];
  readonly maxPriceAge: number;
  readonly weth: string;
  readonly factoryV2: string;
  readonly positionManager: string;
}
function uint(v: unknown, bits = 256): string {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,77}$/.test(v) || BigInt(v) >= 2n ** BigInt(bits))
    throw new Error('DEPLOYMENT_WORKSHEET');
  return v;
}
const hash = (v: unknown) => {
  if (typeof v !== 'string' || !/^0x[0-9a-f]{64}$/.test(v) || /^0x0+$/.test(v))
    throw new Error('DEPLOYMENT_WORKSHEET');
  return v;
};
const optionalAddress = (v: unknown) => (v === '0x' + '0'.repeat(40) ? String(v) : walletAddress(String(v)));
export function parseDeploymentWorksheet(input: unknown): DeploymentWorksheet {
  const keys = [
    'schemaVersion',
    'chainId',
    'kind',
    'deployer',
    'creator',
    'executor',
    'keeper',
    'nonce',
    'owners',
    'strategyId',
    'strategyRef',
    'usdcSupply',
    'passSupply',
    'stockSupplies',
    'maxPriceAge',
    'weth',
    'factoryV2',
    'positionManager',
  ];
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    throw new Error('DEPLOYMENT_WORKSHEET');
  const v = input as Record<string, unknown>;
  if (
    v.schemaVersion !== 1 ||
    v.chainId !== 46630 ||
    v.kind !== 'UNSIGNED_TESTNET_DEPLOYMENT' ||
    !Number.isSafeInteger(v.nonce) ||
    Number(v.nonce) < 0 ||
    Number(v.nonce) > 2147483547 ||
    !Array.isArray(v.owners) ||
    v.owners.length < 1 ||
    v.owners.length > 16 ||
    !Array.isArray(v.stockSupplies) ||
    v.stockSupplies.length !== 3 ||
    !Number.isSafeInteger(v.maxPriceAge) ||
    Number(v.maxPriceAge) < 1 ||
    Number(v.maxPriceAge) > 30
  )
    throw new Error('DEPLOYMENT_WORKSHEET');
  const deployer = walletAddress(String(v.deployer)),
    creator = walletAddress(String(v.creator)),
    executor = walletAddress(String(v.executor)),
    keeper = walletAddress(String(v.keeper)),
    owners = v.owners.map((o) => walletAddress(String(o)));
  if (new Set(owners).size !== owners.length || owners.includes(executor) || owners.includes(keeper))
    throw new Error('DEPLOYMENT_OWNER_KEY_SEPARATION');
  if (BigInt(uint(v.passSupply)) % 10n ** 12n !== 0n) throw new Error('DEPLOYMENT_PASS_PRECISION');
  return Object.freeze({
    schemaVersion: 1,
    chainId: 46630,
    kind: 'UNSIGNED_TESTNET_DEPLOYMENT',
    deployer,
    creator,
    executor,
    keeper,
    nonce: Number(v.nonce),
    owners: Object.freeze(owners),
    strategyId: hash(v.strategyId),
    strategyRef: hash(v.strategyRef),
    usdcSupply: uint(v.usdcSupply),
    passSupply: uint(v.passSupply),
    stockSupplies: Object.freeze(v.stockSupplies.map((s) => uint(s))),
    maxPriceAge: Number(v.maxPriceAge),
    weth: walletAddress(String(v.weth)),
    factoryV2: optionalAddress(v.factoryV2),
    positionManager: optionalAddress(v.positionManager),
  });
}
export function qualifyTradingArtifact(artifact: DeploymentArtifact) {
  const compiled = new Interface(artifact.abi);
  for (const fragment of tradingInterface.fragments) {
    const signature = fragment.format('sighash');
    const actual =
      fragment.type === 'function'
        ? compiled.getFunction(signature)
        : fragment.type === 'event'
          ? compiled.getEvent(signature)
          : null;
    const normalized = (f: typeof fragment) => {
      const v = JSON.parse(f.format('json'));
      const param = (p: { type: string; name: string; indexed?: boolean; components?: unknown }) => ({
        type: p.type,
        ...(p.components ? { components: p.components } : {}),
        ...(v.type === 'event' ? { name: p.name, indexed: !!p.indexed } : {}),
      });
      return JSON.stringify({
        type: v.type,
        stateMutability: v.stateMutability,
        anonymous: v.anonymous,
        inputs: v.inputs?.map(param),
        outputs: v.outputs?.map(param),
      });
    };
    if (!actual || normalized(actual) !== normalized(fragment)) throw new Error('DEPLOYMENT_ABI_MISMATCH');
  }
  if (artifact.runtimeBytes > 24576) throw new Error('DEPLOYMENT_CODE_SIZE');
}
/** Deterministic unsigned creation sequence. Operator must validate nonce and each real receipt before proceeding. */
export async function prepareDeploymentPlan(
  input: unknown,
  terms: readonly ReferenceTerms[],
  artifacts: Readonly<Record<string, DeploymentArtifact>>,
) {
  const w = parseDeploymentWorksheet(input);
  if (terms.length !== 3) throw new Error('DEPLOYMENT_REFERENCE');
  qualifyTradingArtifact(artifacts.AlphaForgeTradingVault!);
  let nonce = w.nonce;
  const transactions: Array<{
    name: string;
    expectedAddress: string;
    nonce: number;
    from: string;
    chainId: number;
    value: string;
    data: string;
    artifactDigest: string;
  }> = [];
  const deploy = async (name: string, artifactName: string, args: readonly unknown[]) => {
    const artifact = artifacts[artifactName];
    if (
      !artifact ||
      !/^0x(?:[a-fA-F0-9]{2})+$/.test(artifact.bytecode) ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      artifact.runtimeBytes > 24576
    )
      throw new Error('DEPLOYMENT_ARTIFACT');
    const expectedAddress = getCreateAddress({ from: w.deployer, nonce }),
      tx = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(...args);
    transactions.push({
      name,
      expectedAddress: expectedAddress.toLowerCase(),
      nonce,
      from: w.deployer,
      chainId: 46630,
      value: '0',
      data: String(tx.data),
      artifactDigest: artifact.sha256,
    });
    nonce++;
    return expectedAddress.toLowerCase();
  };
  const usdc = await deploy('AF-USDC', 'AlphaForgeTestUSDC', [w.usdcSupply, w.deployer]);
  const pass = await deploy('Strategy Pass', 'StrategyPass', [
    'AlphaForge Test Strategy Pass',
    'AF-TEST-PASS',
    w.strategyId,
    w.passSupply,
    w.deployer,
  ]);
  const stocks = [];
  for (let i = 0; i < 3; i++)
    stocks.push(
      await deploy('AF-TEST-' + terms[i]!.symbol, 'AlphaForgeTestStock', [i, w.stockSupplies[i], w.deployer]),
    );
  const feeds = [];
  for (let i = 0; i < 3; i++)
    feeds.push(
      await deploy('Test reference ' + terms[i]!.symbol, 'AlphaForgeTestReferenceFeed', [
        w.keeper,
        evidenceHash(terms[i]),
      ]),
    );
  const factory = await deploy('Uniswap V3 Factory TESTNET', 'UniswapV3Factory', []);
  const router = await deploy('SwapRouter02 TESTNET', 'SwapRouter02', [
    w.factoryV2,
    factory,
    w.positionManager,
    w.weth,
  ]);
  const quoter = await deploy('QuoterV2 TESTNET', 'QuoterV2', [factory, w.weth]);
  const seeder = await deploy('Operator LP seeder TESTNET', 'AlphaForgeLiquiditySeeder', [
    w.deployer,
    factory,
    usdc,
    stocks,
  ]);
  const vaults = [];
  for (const owner of w.owners) {
    const vault = await deploy('Independent Vault ' + owner, 'AlphaForgeTradingVault', [
      [owner, w.creator, w.strategyId, w.strategyRef, pass, usdc, router, stocks, feeds, w.maxPriceAge],
    ]);
    vaults.push({ owner, vault, passLocker: getCreateAddress({ from: vault, nonce: 1 }).toLowerCase() });
  }
  const poolCalls = stocks.map((stock) => ({
    from: w.deployer,
    to: factory,
    chainId: 46630,
    value: '0',
    data: new Interface(['function createPool(address,address,uint24) returns(address)']).encodeFunctionData(
      'createPool',
      [usdc, stock, 3000],
    ),
    nonce: nonce++,
  }));
  return Object.freeze({
    schemaVersion: 1,
    chainId: 46630,
    scope: 'TEST_SUBSTITUTES_ONLY',
    status: 'UNSIGNED_REQUIRES_OPERATOR_RECEIPTS',
    worksheetDigest: evidenceHash(w),
    transactions,
    poolCalls,
    addresses: {
      usdc,
      pass,
      stocks,
      feeds,
      factory,
      router,
      quoter,
      seeder,
      vaults,
      keeper: w.keeper,
      executor: w.executor,
    },
    executionGrants: 'NOT_CREATED',
    fundDistribution: 'NOT_CREATED',
    poolInitialization: 'REQUIRES_FRESH_REFERENCE_AND_REAL_POOL_ADDRESSES',
    signatures: 'NOT_RUN',
    broadcast: 'NOT_RUN',
  });
}
function sqrt(value: bigint) {
  if (value < 0n) throw new Error('POOL_PRICE');
  if (value < 2n) return value;
  let a = value,
    b = (a + 1n) / 2n;
  while (b < a) {
    a = b;
    b = (a + value / a) / 2n;
  }
  return a;
}
export function initialPoolSqrtPrice(usdc: string, stock: string, priceUsdc: string) {
  const a = walletAddress(usdc),
    b = walletAddress(stock),
    p = BigInt(uint(priceUsdc));
  if (a === b) throw new Error('POOL_PRICE');
  const value = sqrt(a < b ? ((10n ** 18n) << 192n) / p : (p << 192n) / 10n ** 18n);
  if (value <= 4295128739n || value >= 1461446703485210103287273052203988822378723970342n)
    throw new Error('POOL_PRICE_RANGE');
  return String(value);
}
