import { validateDeploymentManifest } from '../../chain-adapter/src/manifest.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../../chain-adapter/src/pass-abi.ts';
import { tradingAbiHash, tradingAbiVersion } from './trading-abi.ts';
import { validateTradingInventory } from './trading-inventory.ts';
import type { TradingVaultBinding } from './public-config.ts';

export async function loadTradingDeployments(
  bindings: readonly TradingVaultBinding[],
  read: (file: string) => Promise<unknown>,
) {
  const deployments = [];
  for (const binding of bindings) {
    const manifest = validateDeploymentManifest(await read(binding.manifestFile), {
      environment: 'robinhood-chain-testnet',
      chainId: 46630,
      manifestDigest: binding.manifestDigest,
      contractAddress: binding.vaultAddress,
    });
    if (
      manifest.contractName !== 'AlphaForgeTradingVault' ||
      manifest.contractType !== 'vault' ||
      manifest.abiVersion !== tradingAbiVersion ||
      manifest.abiHash !== tradingAbiHash ||
      manifest.strategyPassAbiHash !== M3_STRATEGY_PASS_ABI_HASH
    )
      throw new Error('TRADING_DEPLOYMENT_ABI');
    const inventory = validateTradingInventory(
      await read(binding.inventoryFile),
      binding.inventoryDigest,
      binding.manifestDigest,
    );
    deployments.push(Object.freeze({ id: binding.id, binding, manifest, inventory }));
  }
  return Object.freeze(deployments);
}
