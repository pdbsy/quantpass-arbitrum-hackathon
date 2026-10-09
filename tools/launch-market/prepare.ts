import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ContractFactory, Interface, getAddress, getCreateAddress, id } from 'ethers';
import { artifact } from './local-fixture.ts';

export interface DeploymentInputs {
  chainId: 46630;
  deployer: string;
  nonce: number;
  administrator: string;
  quoteSigner: string;
  claimSigner: string;
  tslaLpRecipient: string;
  amznLpRecipient: string;
  usdcSupplyRaw: string;
  conversionUsdcRaw: string;
  conversionEthRaw: string;
  stockReserveUsdcRaw: string;
  stockReserveUnitsRaw: string;
  ethPerTransactionRaw: string;
  ethPerAccountDailyRaw: string;
  ethGlobalDailyRaw: string;
  ethMinimumReserveRaw: string;
}
/** Generates unsigned transactions only. It has no RPC, private key, signer or broadcast path. */
export async function prepareDeployment(input: DeploymentInputs) {
  if (input.chainId !== 46630 || !Number.isSafeInteger(input.nonce) || input.nonce < 0)
    throw new Error('INVALID_TESTNET_INPUT');
  for (const key of [
    'deployer',
    'administrator',
    'quoteSigner',
    'claimSigner',
    'tslaLpRecipient',
    'amznLpRecipient',
  ] as const) {
    if (getAddress(input[key]) === '0x0000000000000000000000000000000000000000')
      throw new Error('EXPLICIT_IDENTITY_REQUIRED');
  }
  // Every identity is an explicit input. Neither LP recipient defaults to the proceeds EOA or deployer.
  for (const key of Object.keys(input).filter((k) => k.endsWith('Raw')) as (keyof DeploymentInputs)[]) {
    if (!/^(0|[1-9][0-9]{0,77})$/.test(String(input[key]))) throw new Error('INTEGER_BASE_UNITS_REQUIRED');
  }
  const per = BigInt(input.ethPerTransactionRaw),
    daily = BigInt(input.ethPerAccountDailyRaw),
    global = BigInt(input.ethGlobalDailyRaw);
  if (
    per === 0n ||
    per > daily ||
    daily > global ||
    BigInt(input.conversionEthRaw) < BigInt(input.ethMinimumReserveRaw) + per ||
    BigInt(input.conversionUsdcRaw) === 0n
  )
    throw new Error('CONVERSION_READINESS_REQUIRED');
  const requiredUsdc =
    600_000n * 10n ** 6n + BigInt(input.conversionUsdcRaw) + 2n * BigInt(input.stockReserveUsdcRaw);
  if (
    BigInt(input.usdcSupplyRaw) < requiredUsdc ||
    BigInt(input.stockReserveUnitsRaw) === 0n ||
    BigInt(input.stockReserveUnitsRaw) > 1_000_000n * 10n ** 18n
  )
    throw new Error('SEPARATE_FUNDING_REQUIRED');
  const actions: object[] = [],
    configurationActions: object[] = [],
    addresses: Record<string, string> = {};
  let nonce = input.nonce;
  const admin = getAddress(input.administrator),
    deployer = getAddress(input.deployer);
  async function deploy(label: string, file: string, name: string, args: unknown[]) {
    const compiled = await artifact(file, name),
      address = getCreateAddress({ from: deployer, nonce: nonce++ });
    const unsigned = await new ContractFactory(compiled.abi, compiled.bytecode.object).getDeployTransaction(
      ...args,
    );
    addresses[label] = address;
    actions.push({
      operation: 'DEPLOY_' + label,
      chainId: 46630,
      contractAddress: address,
      function: 'constructor',
      caller: deployer,
      constructorArguments: args,
      inputAssets: [],
      inputAmounts: [],
      recipient: address,
      unsigned: { to: null, data: unsigned.data, value: '0' },
      permissionsRequired: 'EXPLICIT_TESTNET_DEPLOYMENT_APPROVAL',
      estimatedGas: null,
      gasStatus: 'NOT_RUN_TARGET_NETWORK',
      recovery:
        'A mined deployment cannot be rolled back. Stop on any address, supply or code mismatch; retain receipts and do not rerun deployment transactions.',
      verification:
        'Receipt canonical at 3 inclusive L2 blocks, expected CREATE address, runtime compiler artifact identity and constructor configuration.',
    });
    return new Interface(compiled.abi);
  }
  function call(
    label: string,
    iface: Interface,
    method: string,
    args: unknown[],
    caller = admin,
    value = '0',
    assets: object[] = [],
  ) {
    configurationActions.push({
      operation: label + ':' + method,
      chainId: 46630,
      contractAddress: addresses[label],
      function: method,
      caller,
      inputAssets: assets,
      inputAmounts: assets,
      recipient: addresses[label],
      unsigned: { to: addresses[label], data: iface.encodeFunctionData(method, args), value },
      permissionsRequired: 'EXPLICIT_TESTNET_FUNDING_OR_CONFIGURATION_APPROVAL',
      estimatedGas: null,
      gasStatus: 'NOT_RUN_TARGET_NETWORK',
      recovery:
        'Read receipts and exact chain state before retry. Configuration is one-shot; never replay a successful initialization. Funding transfers are irreversible; only documented owner reserve-withdraw paths recover eligible funds.',
      verification:
        'Verify caller, token balances, events, LP recipient, nonce, expected storage and 3 inclusive L2 confirmations.',
    });
  }
  const million = '1000000000000000000000000',
    half = '500000000000000000000000',
    lpCash = '250000000000';
  const usdc = await deploy('usdc', 'AlphaForgeTestAsset', 'AlphaForgeTestUSDC', [
    input.usdcSupplyRaw,
    admin,
  ]);
  const tsla = await deploy('tslaPass', 'StrategyPass', 'StrategyPass', [
    'TSLA PASS',
    'TSLA-PASS',
    id('TSLA'),
    million,
    admin,
  ]);
  const amzn = await deploy('amznPass', 'StrategyPass', 'StrategyPass', [
    'AMZN PASS',
    'AMZN-PASS',
    id('AMZN'),
    million,
    admin,
  ]);
  const factory = await deploy('poolFactory', 'AlphaForgePassFactory', 'AlphaForgePassFactory', [
    admin,
    addresses.usdc,
  ]);
  const reserve = await deploy('conversionReserve', 'AlphaForgeNativeReserve', 'AlphaForgeNativeReserve', [
    admin,
    addresses.usdc,
    input.quoteSigner,
    0,
    [
      input.ethPerTransactionRaw,
      input.ethPerAccountDailyRaw,
      input.ethGlobalDailyRaw,
      input.ethMinimumReserveRaw,
    ],
  ]);
  await deploy('router', 'AlphaForgeMarketRouter', 'AlphaForgeMarketRouter', [
    addresses.poolFactory,
    addresses.conversionReserve,
  ]);
  const launch = await deploy('tslaLaunch', 'AlphaForgeFairLaunch', 'AlphaForgeFairLaunch', [
    [
      admin,
      addresses.tslaPass,
      addresses.usdc,
      addresses.poolFactory,
      addresses.conversionReserve,
      input.tslaLpRecipient,
    ],
  ]);
  const claim = await deploy('claim', 'AlphaForgeClaimReserve', 'AlphaForgeClaimReserve', [
    admin,
    addresses.usdc,
    input.claimSigner,
  ]);
  const configs: unknown[][] = [];
  for (const [index, strategy] of ['TSLA', 'AMZN'].entries()) {
    const stock = await deploy(strategy + 'Stock', 'AlphaForgeStrategyVault', 'AlphaForgeStrategyTestStock', [
      index === 0,
      million,
      admin,
    ]);
    const feed = await deploy(strategy + 'Feed', 'AlphaForgeTestStock', 'AlphaForgeTestReferenceFeed', [
      admin,
      id('TEST_ONLY:' + strategy),
    ]);
    const venue = await deploy(
      strategy + 'StockReserve',
      'AlphaForgeStrategyVault',
      'AlphaForgeStockReserve',
      [admin, addresses.usdc, addresses[strategy + 'Stock'], addresses[strategy + 'Feed'], 300],
    );
    call(strategy + 'Stock', stock, 'approve', [
      addresses[strategy + 'StockReserve'],
      input.stockReserveUnitsRaw,
    ]);
    call(strategy + 'StockReserve', venue, 'fund', [
      addresses[strategy + 'Stock'],
      input.stockReserveUnitsRaw,
    ]);
    call('usdc', usdc, 'approve', [addresses[strategy + 'StockReserve'], input.stockReserveUsdcRaw]);
    call(strategy + 'StockReserve', venue, 'fund', [addresses.usdc, input.stockReserveUsdcRaw]);
    // A reference timestamp cannot be safely pre-signed. This dependency is explicitly unresolved in the plan.
    configurationActions.push({
      operation: strategy + ':UPDATE_TEST_REFERENCE',
      contractAddress: addresses[strategy + 'Feed'],
      chainId: 46630,
      function: 'update',
      caller: admin,
      unsigned: null,
      status: 'REQUIRES_FRESH_TEST_REFERENCE',
      permissionsRequired: 'EXPLICIT_ORACLE_CONFIGURATION_APPROVAL',
      verification:
        'Explicit test reference, source digest and current onchain timestamp; never derive a stock price from PASS reserves.',
    });
    void feed;
    configs.push([
      admin,
      addresses[index === 0 ? 'tslaPass' : 'amznPass'],
      addresses.usdc,
      addresses[strategy + 'Stock'],
      null,
      addresses[strategy + 'StockReserve'],
      addresses[strategy + 'Feed'],
      id('All in ' + strategy),
      300,
    ]);
  }
  configs[0]![4] = addresses.AMZNStock;
  configs[1]![4] = addresses.TSLAStock;
  await deploy('vaultFactory', 'AlphaForgeStrategyVault', 'AlphaForgeStrategyVaultFactory', [configs]);
  call('poolFactory', factory, 'configureInitializer', [addresses.tslaPass, addresses.tslaLaunch]);
  call('poolFactory', factory, 'configureInitializer', [addresses.amznPass, admin]);
  call('conversionReserve', reserve, 'authorizeRouter', [addresses.tslaLaunch]);
  call('conversionReserve', reserve, 'authorizeRouter', [addresses.router]);
  call('conversionReserve', reserve, 'configureTradingRouter', [addresses.router]);
  call('conversionReserve', reserve, 'fundNative', [], admin, input.conversionEthRaw, [
    { asset: 'native ETH', amountRaw: input.conversionEthRaw },
  ]);
  call('usdc', usdc, 'approve', [addresses.conversionReserve, input.conversionUsdcRaw]);
  call('conversionReserve', reserve, 'fundUsdc', [input.conversionUsdcRaw]);
  call('usdc', usdc, 'approve', [addresses.claim, '100000000000']);
  call('claim', claim, 'fund', ['100000000000']);
  call('claim', claim, 'openClaims', []);
  call('tslaPass', tsla, 'transfer', [addresses.tslaLaunch, million]);
  call('usdc', usdc, 'transfer', [addresses.tslaLaunch, lpCash]);
  call('amznPass', amzn, 'approve', [addresses.poolFactory, half]);
  call('usdc', usdc, 'approve', [addresses.poolFactory, lpCash]);
  call('poolFactory', factory, 'createPool', [addresses.amznPass, input.amznLpRecipient]);
  call('amznPass', amzn, 'transfer', ['0x86767116cd40bf6b4f8cf88e08d11e38b04364cf', half]);
  call('tslaLaunch', launch, 'openMint', []);
  // CREATE address predictions assume exactly this reviewed deployment order. Funding calls have no predicted nonce.
  return {
    status: 'UNSIGNED_REQUIRES_USER_APPROVAL',
    schemaVersion: 1,
    chainId: 46630,
    deploymentOrderMustBePreserved: true,
    inputs: input,
    addresses,
    requiredInitialUsdcRaw: requiredUsdc.toString(),
    proceedsRecipient: '0x86767116cd40bf6b4f8cf88e08d11e38b04364cf',
    actions: [...actions, ...configurationActions],
    manifestStatus:
      'Populate actual deploymentBlock, pools and verified runtimeCodeHashes from receipts before activating the reader.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [configPath, outputPath] = process.argv.slice(2);
  if (!configPath || !outputPath)
    throw new Error('Usage: node tools/launch-market/prepare.ts INPUT.json OUTPUT.json (unsigned, offline)');
  const plan = await prepareDeployment(JSON.parse(await readFile(configPath, 'utf8')));
  await mkdir(resolve(outputPath, '..'), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, JSON.stringify(plan, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log('Unsigned deployment plan prepared. No RPC, signature, broadcast or funding was performed.');
}
