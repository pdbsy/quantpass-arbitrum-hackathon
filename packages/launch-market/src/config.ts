import { getAddress, ZeroAddress } from 'ethers';
import { LaunchMarketError, type LaunchMarketManifest, type MarketConfiguration } from './types.ts';

export const LAUNCH_CHAIN_ID = 46630;
export const PASS_UNIT = 10n ** 18n;
export const USDC_UNIT = 10n ** 6n;
export const TOTAL_PASS = 1_000_000n * PASS_UNIT;
export const PUBLIC_PASS = 500_000n * PASS_UNIT;
export const LP_USDC = 250_000n * USDC_UNIT;
export const CLAIM_USDC = 1_000n * USDC_UNIT;
export const MINT_PRICE_USDC = 500_000n;
export function address(value: string): string {
  try {
    const result = getAddress(value);
    if (result === ZeroAddress) throw new Error();
    return result.toLowerCase();
  } catch {
    throw new LaunchMarketError('INVALID_ADDRESS', 400);
  }
}
export function uint(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    throw new LaunchMarketError('INVALID_AMOUNT', 400);
  const parsed = BigInt(value);
  if (parsed >= 2n ** 256n) throw new LaunchMarketError('INVALID_AMOUNT', 400);
  return parsed;
}
export function hash(value: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new LaunchMarketError('INVALID_HASH', 400);
  return value.toLowerCase();
}
export function configuration(manifest: LaunchMarketManifest | null): MarketConfiguration {
  if (manifest) validateManifest(manifest);
  return Object.freeze({
    mode: 'ONCHAIN_TESTNET',
    deployment: manifest ? 'CONFIGURED' : 'NOT_DEPLOYED',
    chainId: manifest?.chainId ?? LAUNCH_CHAIN_ID,
    confirmations: 3,
    manifest,
  });
}
export function validateManifest(manifest: LaunchMarketManifest): void {
  if (manifest.schemaVersion !== 1 || manifest.chainId !== LAUNCH_CHAIN_ID)
    throw new LaunchMarketError('WRONG_CHAIN', 400);
  uint(manifest.deploymentBlock);
  const contracts = [
    manifest.usdc,
    manifest.claim,
    manifest.conversionReserve,
    manifest.router,
    manifest.poolFactory,
    ...Object.values(manifest.strategies).flatMap((s) => [
      s.pass,
      ...(s.pool ? [s.pool] : []),
      ...(s.launch ? [s.launch] : []),
    ]),
    ...(manifest.vaultFactory ? [manifest.vaultFactory] : []),
  ];
  [...contracts, ...Object.values(manifest.strategies).map((s) => s.lpRecipient)].forEach(address);
  if (
    !manifest.strategies.TSLA.launch ||
    manifest.strategies.AMZN.launch !== null ||
    !manifest.strategies.AMZN.pool
  )
    throw new LaunchMarketError('INVALID_STRATEGY_MANIFEST', 400);
  if (address(manifest.strategies.TSLA.pass) === address(manifest.strategies.AMZN.pass))
    throw new LaunchMarketError('DUPLICATE_PASS', 400);
  for (const item of contracts) {
    const runtimeHash = manifest.runtimeCodeHashes[address(item)];
    if (!runtimeHash) throw new LaunchMarketError('MISSING_RUNTIME_HASH', 400);
    hash(runtimeHash);
  }
}
