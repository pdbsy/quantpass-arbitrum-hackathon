import { readFile } from 'node:fs/promises';
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  id,
  keccak256,
  parseEther,
  toBeHex,
} from 'ethers';
import type { LaunchMarketManifest } from '../../packages/launch-market/src/types.ts';

export async function artifact(file: string, name: string) {
  return JSON.parse(
    await readFile(new URL(`../../.checks/af-chain01/out/${file}.sol/${name}.json`, import.meta.url), 'utf8'),
  );
}

/** Isolated local EVM only. Random keys stay in memory and are never deployment credentials. */
export async function deployLocalMarket(rpcUrl = 'http://127.0.0.1:8547') {
  const url = new URL(rpcUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('LOCAL_EVM_ONLY');
  const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1, batchStallTime: 1 });
  provider.pollingInterval = 20;
  if (
    !String(await provider.send('web3_clientVersion', [])).includes('anvil/v1.5.1') ||
    BigInt(await provider.send('eth_chainId', [])) !== 46630n
  ) {
    provider.destroy();
    throw new Error('PINNED_LOCAL_ANVIL_REQUIRED');
  }
  const operator = Wallet.createRandom().connect(provider),
    alice = Wallet.createRandom().connect(provider),
    bob = Wallet.createRandom().connect(provider);
  for (const actor of [operator, alice, bob])
    await provider.send('anvil_setBalance', [actor.address, toBeHex(parseEther('100'))]);
  const signer = new NonceManager(operator),
    a = new NonceManager(alice),
    b = new NonceManager(bob);
  const start = BigInt(await provider.send('eth_blockNumber', [])).toString();
  async function deploy(file: string, name: string, args: unknown[]) {
    const compiled = await artifact(file, name);
    const deployed = await new ContractFactory(compiled.abi, compiled.bytecode.object, signer).deploy(
      ...args,
    );
    await deployed.waitForDeployment();
    return new Contract(await deployed.getAddress(), compiled.abi, signer);
  }
  async function execute(contract: Contract, method: string, ...args: unknown[]) {
    return (await contract.getFunction(method)(...args)).wait();
  }
  const owner = operator.address,
    million = 1_000_000n * 10n ** 18n;
  const usdc = await deploy('AlphaForgeTestAsset', 'AlphaForgeTestUSDC', [2_000_000n * 10n ** 6n, owner]);
  const tsla = await deploy('StrategyPass', 'StrategyPass', [
    'TSLA PASS',
    'TSLA-PASS',
    id('TSLA'),
    million,
    owner,
  ]);
  const amzn = await deploy('StrategyPass', 'StrategyPass', [
    'AMZN PASS',
    'AMZN-PASS',
    id('AMZN'),
    million,
    owner,
  ]);
  const factory = await deploy('AlphaForgePassFactory', 'AlphaForgePassFactory', [owner, usdc.target]);
  const reserve = await deploy('AlphaForgeNativeReserve', 'AlphaForgeNativeReserve', [
    owner,
    usdc.target,
    owner,
    0,
    [parseEther('1'), parseEther('5'), parseEther('20'), parseEther('1')],
  ]);
  const router = await deploy('AlphaForgeMarketRouter', 'AlphaForgeMarketRouter', [
    factory.target,
    reserve.target,
  ]);
  const launch = await deploy('AlphaForgeFairLaunch', 'AlphaForgeFairLaunch', [
    [owner, tsla.target, usdc.target, factory.target, reserve.target, bob.address],
  ]);
  const claim = await deploy('AlphaForgeClaimReserve', 'AlphaForgeClaimReserve', [owner, usdc.target, owner]);
  await execute(factory, 'configureInitializer', tsla.target, launch.target);
  await execute(factory, 'configureInitializer', amzn.target, owner);
  await execute(reserve, 'authorizeRouter', launch.target);
  await execute(reserve, 'authorizeRouter', router.target);
  await execute(reserve, 'configureTradingRouter', router.target);
  await execute(reserve, 'fundNative', { value: parseEther('50') });
  await execute(usdc, 'approve', reserve.target, 100_000n * 10n ** 6n);
  await execute(reserve, 'fundUsdc', 100_000n * 10n ** 6n);
  await execute(usdc, 'approve', claim.target, 100_000n * 10n ** 6n);
  await execute(claim, 'fund', 100_000n * 10n ** 6n);
  await execute(claim, 'openClaims');
  await execute(tsla, 'transfer', launch.target, million);
  await execute(usdc, 'transfer', launch.target, 250_000n * 10n ** 6n);
  await execute(amzn, 'approve', factory.target, million / 2n);
  await execute(usdc, 'approve', factory.target, 250_000n * 10n ** 6n);
  await execute(factory, 'createPool', amzn.target, bob.address);
  await execute(amzn, 'transfer', '0x86767116cd40bf6b4f8cf88e08d11e38b04364cf', million / 2n);
  await execute(launch, 'openMint');
  const stocks: Contract[] = [],
    feeds: Contract[] = [],
    venues: Contract[] = [];
  for (const strategy of ['TSLA', 'AMZN']) {
    const stock = await deploy('AlphaForgeStrategyVault', 'AlphaForgeStrategyTestStock', [
      strategy === 'TSLA',
      million,
      owner,
    ]);
    const feed = await deploy('AlphaForgeStrategyVault', 'AlphaForgeStrategyReferenceFeed', [
      owner,
      id('TEST_ONLY:' + strategy),
    ]);
    const time = Number((await provider.getBlock('latest'))!.timestamp);
    await execute(feed, 'update', 100n * 10n ** 6n, time, id('local deterministic test reference'));
    await execute(
      feed,
      'updateSession',
      time,
      time + 3600,
      time,
      id('isolated local TEST_ONLY calendar window'),
    );
    const venue = await deploy('AlphaForgeStrategyVault', 'AlphaForgeStockReserve', [
      owner,
      usdc.target,
      stock.target,
      feed.target,
      60,
    ]);
    await execute(stock, 'approve', venue.target, million / 2n);
    await execute(venue, 'fund', stock.target, million / 2n);
    await execute(usdc, 'approve', venue.target, 100_000n * 10n ** 6n);
    await execute(venue, 'fund', usdc.target, 100_000n * 10n ** 6n);
    stocks.push(stock);
    feeds.push(feed);
    venues.push(venue);
  }
  const configs = [tsla, amzn].map((pass, i) => [
    owner,
    pass.target,
    usdc.target,
    stocks[i]!.target,
    stocks[1 - i]!.target,
    venues[i]!.target,
    feeds[i]!.target,
    id('All in ' + (i === 0 ? 'TSLA' : 'AMZN')),
    60,
  ]);
  const vaultFactory = await deploy('AlphaForgeStrategyVault', 'AlphaForgeStrategyVaultFactory', [configs]);
  const amznPool = String(await factory.getFunction('getPool')(amzn.target));
  const contracts = [usdc, tsla, amzn, factory, reserve, router, launch, claim, vaultFactory];
  const runtimeCodeHashes: Record<string, string> = {};
  for (const contract of contracts)
    runtimeCodeHashes[String(contract.target).toLowerCase()] = keccak256(
      await provider.getCode(contract.target),
    );
  runtimeCodeHashes[amznPool.toLowerCase()] = keccak256(await provider.getCode(amznPool));
  const manifest: LaunchMarketManifest = {
    schemaVersion: 1,
    chainId: 46630,
    deploymentBlock: start,
    usdc: String(usdc.target),
    claim: String(claim.target),
    conversionReserve: String(reserve.target),
    router: String(router.target),
    poolFactory: String(factory.target),
    vaultFactory: String(vaultFactory.target),
    runtimeCodeHashes,
    strategies: {
      TSLA: {
        pass: String(tsla.target),
        launch: String(launch.target),
        pool: null,
        lpRecipient: bob.address,
      },
      AMZN: { pass: String(amzn.target), launch: null, pool: amznPool, lpRecipient: bob.address },
    },
  };
  return {
    provider,
    operator,
    alice,
    bob,
    signer,
    a,
    b,
    usdc,
    tsla,
    amzn,
    factory,
    reserve,
    router,
    launch,
    claim,
    vaultFactory,
    stocks,
    feeds,
    venues,
    manifest,
    execute,
  };
}
