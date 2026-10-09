import { lstatSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet, id } from 'ethers';
import { readRegularBytes } from '../../packages/testnet/src/bounded-file.ts';
import { privateServerStorage } from '../../packages/testnet/src/private-storage.ts';
import { LaunchMarketStore } from '../../packages/launch-market/src/store.ts';
import { LaunchMarketService } from '../../packages/launch-market/src/service.ts';
import type { LaunchMarketManifest } from '../../packages/launch-market/src/types.ts';
import { AccessIdentityBridge } from '../../apps/server/src/launch-market-adapters/access-identity.ts';
import { VerifiedEthReference } from '../../apps/server/src/launch-market-adapters/eth-reference.ts';
import { RpcMarketChain } from '../../apps/server/src/launch-market-adapters/rpc-chain.ts';
import { buildVaultQuote } from '../../apps/server/src/launch-market-adapters/vault-quotes.ts';
import { MarketEventIndexer } from '../../apps/server/src/launch-market/indexer.ts';
import { buildLaunchMarketServer } from '../../apps/server/src/launch-market/server.ts';

function signer(path: string | undefined): Wallet | null {
  if (!path) return null;
  const absolute = resolve(path),
    stat = lstatSync(absolute);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.() ||
    realpathSync(absolute) !== absolute
  )
    throw new Error('PRIVATE_SIGNER_FILE_REQUIRED');
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(absolute, 256)).trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('INVALID_SIGNER_FILE');
  // Offline EIP-712 signer only: never attached to a provider or used for transaction broadcasting.
  return new Wallet(raw);
}

export async function startMarketServer(env: Readonly<Record<string, string | undefined>>) {
  const origin = env.AF_MARKET_ORIGIN;
  if (!origin || !env.AF_MARKET_DATA_DIR) throw new Error('MARKET_ORIGIN_AND_PRIVATE_STORAGE_REQUIRED');
  const folder = resolve(env.AF_MARKET_DATA_DIR),
    storage = privateServerStorage(folder, 512 * 1024 * 1024);
  let chain: RpcMarketChain | null = null,
    store: LaunchMarketStore | null = null,
    bridge: AccessIdentityBridge | null = null,
    indexer: MarketEventIndexer | null = null;
  try {
    const manifest = env.AF_MARKET_MANIFEST
      ? (JSON.parse(
          new TextDecoder().decode(readRegularBytes(resolve(env.AF_MARKET_MANIFEST))),
        ) as LaunchMarketManifest)
      : null;
    storage.bindIdentity('PUBLIC_TESTNET', id('FairLaunchV3:' + origin + ':' + JSON.stringify(manifest)));
    store = new LaunchMarketStore(storage.databasePath('market', 1095126347), origin);
    if (manifest) {
      if (!env.AF_MARKET_RPC_URL) throw new Error('RPC_REQUIRED');
      chain = new RpcMarketChain(manifest, env.AF_MARKET_RPC_URL);
      await chain.initialize();
    }
    if (env.AF_ACCESS_IDENTITY_DB) bridge = new AccessIdentityBridge(resolve(env.AF_ACCESS_IDENTITY_DB));
    const quoteSigner = signer(env.AF_MARKET_QUOTE_SIGNER_FILE),
      claimSigner = signer(env.AF_MARKET_CLAIM_SIGNER_FILE);
    const feed = new VerifiedEthReference();
    const reader = chain;
    const service = new LaunchMarketService({
      manifest,
      store,
      chain,
      quoteSigner,
      claimSigner,
      ethReference: {
        read: async () => {
          const reference = await feed.read();
          return { ethUsdPriceRaw: reference.priceRaw, observedAt: reference.observedAt };
        },
      },
      ...(reader
        ? {
            vaultQuote: (request, account, snapshot, expiry) =>
              buildVaultQuote(reader, request, account, snapshot, expiry),
          }
        : {}),
    });
    if (manifest && chain)
      indexer = new MarketEventIndexer({
        path: storage.databasePath('market-events', 1095126348),
        manifest,
        provider: chain.provider,
        service,
        pollIntervalMs: 1500,
      });
    const server = await buildLaunchMarketServer({
      service,
      origin,
      ...(indexer ? { indexer } : {}),
      webRoot: env.AF_MARKET_WEB_ROOT
        ? resolve(env.AF_MARKET_WEB_ROOT)
        : resolve(new URL('../../apps/web/dist', import.meta.url).pathname),
      trustedIdentity: (request) => {
        const identity = bridge?.identity(request);
        return identity ? { email: identity.email, subject: identity.subject, emailVerified: true } : null;
      },
      dispose: async () => {
        bridge?.close();
        chain?.close();
        storage.close();
      },
    });
    const port = Number(env.AF_MARKET_PORT ?? '4101');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
    await server.start('127.0.0.1', port);
    return server;
  } catch (error) {
    await indexer?.close();
    bridge?.close();
    store?.close();
    chain?.close();
    storage.close();
    throw error;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startMarketServer(process.env);
    const shutdown = () => {
      void server.stop().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    console.log(
      'Fair Launch reader ready on loopback. Wallets submit transactions; server signs bounded vouchers only.',
    );
  } catch {
    console.error('FAIR_LAUNCH_STARTUP_REJECTED');
    process.exitCode = 1;
  }
}
