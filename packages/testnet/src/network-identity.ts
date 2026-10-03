import type { DeploymentManifest } from '../../chain-adapter/src/manifest.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../../chain-adapter/src/pass-abi.ts';
import { m3ChainSyncPolicy } from '../../chain-adapter/src/policy.ts';
import type { TradingInventory } from './trading-inventory.ts';
import type { TradingVaultBinding } from './public-config.ts';
import { tradingAbiHash, tradingAbiVersion } from './trading-abi.ts';
import { evidenceHash } from './executor-plan.ts';

/** Reviewed Testnet descriptor. Mainnet requires a separately implemented/admitted network definition. */
export function testnetNetworkIdentity(input: {
  chainId: number;
  profile: string;
  configurationDigest: string;
  deployments: readonly {
    manifest: DeploymentManifest;
    inventory: TradingInventory;
    binding: Pick<TradingVaultBinding, 'id' | 'manifestDigest' | 'inventoryDigest' | 'vaultAddress'>;
  }[];
}) {
  if (
    input.chainId !== 46630 ||
    !['PUBLIC_TESTNET', 'RESTRICTED_TESTNET_EXECUTOR'].includes(input.profile) ||
    !/^0x[0-9a-f]{64}$/.test(input.configurationDigest) ||
    /^0x0+$/.test(input.configurationDigest) ||
    input.deployments.length > 16 ||
    (input.profile === 'RESTRICTED_TESTNET_EXECUTOR' && !input.deployments.length)
  )
    throw new Error('NETWORK_IDENTITY');
  const deployments = input.deployments.map(({ binding, manifest, inventory }) => {
    if (
      manifest.chainId !== 46630 ||
      manifest.environment !== 'robinhood-chain-testnet' ||
      manifest.contractName !== 'AlphaForgeTradingVault' ||
      manifest.abiVersion !== tradingAbiVersion ||
      manifest.abiHash !== tradingAbiHash ||
      manifest.strategyPassAbiHash !== M3_STRATEGY_PASS_ABI_HASH ||
      manifest.contractAddress !== binding.vaultAddress ||
      manifest.manifestDigest !== binding.manifestDigest ||
      inventory.chainId !== 46630 ||
      inventory.deploymentManifestDigest !== binding.manifestDigest ||
      !/^0x[0-9a-f]{64}$/.test(binding.inventoryDigest) ||
      /^0x0+$/.test(binding.inventoryDigest)
    )
      throw new Error('NETWORK_IDENTITY');
    return {
      id: binding.id,
      vault: manifest.contractAddress,
      manifestDigest: manifest.manifestDigest,
      inventoryDigest: binding.inventoryDigest,
      normalizedInventoryDigest: evidenceHash(inventory),
      abiVersion: manifest.abiVersion,
      abiHash: manifest.abiHash,
      runtimeBytecodeHash: manifest.runtimeBytecodeHash,
      pass: manifest.strategyPassAddress,
      passAbiHash: manifest.strategyPassAbiHash,
      passRuntimeBytecodeHash: manifest.strategyPassRuntimeBytecodeHash,
    };
  });
  const descriptor = Object.freeze({
    schemaVersion: 1,
    environment: 'robinhood-chain-testnet',
    chainId: 46630,
    profile: input.profile,
    configurationDigest: input.configurationDigest,
    assetKind: 'TEST_SUBSTITUTES',
    units: {
      usdcDecimals: 6,
      passDecimals: 18,
      stockDecimals: 18,
      passRawPerUsdcRaw: '1000000000000',
      stockUnit: 'ONE_OFFICIAL_TOKEN_UNIT_TIMES_REVIEWED_MULTIPLIER',
    },
    rpcRequirements: [
      'CHAIN_ID_46630',
      'EIP1898_REQUIRE_CANONICAL',
      'HISTORICAL_STATE',
      'CANONICAL_RECEIPTS_AND_LOGS',
    ],
    policy: m3ChainSyncPolicy(),
    l1Finality: 'UNKNOWN',
    mainnet: 'DISABLED_UNCONFIGURED',
    deployments,
  });
  return Object.freeze({ descriptor, digest: evidenceHash(descriptor) });
}
