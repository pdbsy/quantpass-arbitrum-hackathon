import { testnetNetworkIdentity } from '../../../packages/testnet/src/network-identity.ts';
import { evidenceHash } from '../../../packages/testnet/src/executor-plan.ts';
import {
  parseReleaseIdentity,
  parseArchivedTestResults,
  type ReleaseIdentity,
  type ArchivedTestResults,
} from '../../../packages/testnet/src/runtime-status.ts';
import { join, resolve } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { validateDeploymentManifest } from '../../../packages/chain-adapter/src/manifest.ts';
import { JsonRpcClient, type ReadonlyRpc } from '../../../packages/chain-adapter/src/rpc.ts';
import { parsePublicTestnetConfig } from '../../../packages/testnet/src/public-config.ts';
import { validateTradingInventory } from '../../../packages/testnet/src/trading-inventory.ts';
import { WalletAuthStore } from '../../../packages/testnet/src/wallet-auth.ts';
import { createWalletVerifier } from '../../../packages/testnet/src/wallet-verifier.ts';
import { privateServerStorage } from '../../../packages/testnet/src/private-storage.ts';
import { tradingAbiHash, tradingAbiVersion } from '../../../packages/testnet/src/trading-abi.ts';
import { M3_STRATEGY_PASS_ABI_HASH } from '../../../packages/chain-adapter/src/pass-abi.ts';
import { TradingChainRuntime } from './trading-chain-runtime.ts';
import { buildPublicTestnetApp } from './testnet-app.ts';
import { createHash } from 'node:crypto';
import { ServerBackups } from '../../../packages/testnet/src/server-backups.ts';
import { readTradingSnapshot } from '../../../packages/testnet/src/trading-reader.ts';
import { readExecutionStatus } from '../../../packages/testnet/src/execution-status.ts';

/** A broken deployment cannot starve other owners' indexes; shared storage remains a global gate. */
export async function syncPublicRuntimes(runtimes: readonly TradingChainRuntime[], canWrite: () => boolean) {
  let failed = false;
  for (const runtime of runtimes) {
    if (!canWrite()) throw new Error('PUBLIC_TESTNET_STORAGE_BLOCKED');
    try {
      await runtime.syncToHead();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('PUBLIC_TESTNET_SYNC_INCOMPLETE');
}

export interface TestnetStartupOptions {
  readonly configuration: unknown;
  readonly now?: () => number;
  readonly releaseIdentity?: ReleaseIdentity;
  readonly archivedTestResults?: ArchivedTestResults;
  readonly manifestReader: (file: string) => Promise<unknown>;
  readonly rpcEndpoint?: string;
  readonly webRoot?: string;
  readonly port?: number;
  readonly periodicSync?: boolean;
  readonly createRpc?: (endpoint: string) => ReadonlyRpc;
}
/** Explicit operational entry. Bootstrap, doctor and offline preflight never invoke it. */
export async function startPublicTestnetServer(options: TestnetStartupOptions) {
  const config = parsePublicTestnetConfig(options.configuration);
  const now = options.now ?? Date.now;
  const releaseIdentity = options.releaseIdentity ? parseReleaseIdentity(options.releaseIdentity) : undefined;
  const archivedTestResults = options.archivedTestResults
    ? parseArchivedTestResults(options.archivedTestResults, now())
    : undefined;
  if (options.webRoot) {
    const root = resolve(options.webRoot),
      entry = join(root, 'testnet.html');
    const stat = lstatSync(entry);
    if (
      realpathSync(root) !== root ||
      !stat.isFile() ||
      stat.nlink !== 1 ||
      realpathSync(entry) !== entry ||
      stat.size < 1 ||
      stat.size > 1024 * 1024
    )
      throw new Error('PUBLIC_TESTNET_WEB_BUILD');
  }
  if (
    options.port !== undefined &&
    (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535)
  )
    throw new Error('PUBLIC_TESTNET_PORT');
  let rpc: ReadonlyRpc | undefined;
  if (options.rpcEndpoint) {
    const url = new URL(options.rpcEndpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('PUBLIC_TESTNET_RPC');
    rpc = options.createRpc
      ? options.createRpc(options.rpcEndpoint)
      : new JsonRpcClient([options.rpcEndpoint]);
  }
  if (config.vaults.length && !rpc) throw new Error('PUBLIC_TESTNET_RPC_REQUIRED');
  const deployments = [];
  for (const binding of config.vaults) {
    const manifest = validateDeploymentManifest(await options.manifestReader(binding.manifestFile), {
      environment: 'robinhood-chain-testnet',
      chainId: 46630,
      manifestDigest: binding.manifestDigest,
      contractAddress: binding.vaultAddress,
    });
    if (
      manifest.contractName !== 'AlphaForgeTradingVault' ||
      manifest.contractType !== 'vault' ||
      manifest.abiVersion !== tradingAbiVersion ||
      manifest.abiHash.toLowerCase() !== tradingAbiHash.toLowerCase() ||
      manifest.strategyPassAbiHash.toLowerCase() !== M3_STRATEGY_PASS_ABI_HASH.toLowerCase()
    )
      throw new Error('PUBLIC_TESTNET_TRADING_ABI');
    const inventory = validateTradingInventory(
      await options.manifestReader(binding.inventoryFile),
      binding.inventoryDigest,
      binding.manifestDigest,
    );
    deployments.push({ binding, manifest, inventory });
  }
  const configurationDigest = evidenceHash(config);
  const network = testnetNetworkIdentity({
    chainId: config.chainId,
    profile: config.profile,
    configurationDigest,
    deployments,
  });
  for (const d of deployments) await readTradingSnapshot(rpc!, d.manifest, d.inventory);
  // All operator inputs qualify before any directory, database, listener or timer is created.
  const storage = privateServerStorage(config.dataDirectory, config.maxStorageBytes);
  const runtimes: Array<{ id: string; runtime: TradingChainRuntime }> = [];
  let app: FastifyInstance | undefined,
    auth: WalletAuthStore | undefined,
    timer: NodeJS.Timeout | undefined,
    closed = false,
    maintenance = false,
    backups: ServerBackups | undefined;
  let tail: Promise<void> = Promise.resolve();
  const syncNow = () => {
    if (closed) return Promise.reject(new Error('PUBLIC_TESTNET_CLOSED'));
    if (maintenance) return Promise.reject(new Error('PUBLIC_TESTNET_MAINTENANCE'));
    const next = tail.then(async () => {
      if (!storage.canWrite()) throw new Error('PUBLIC_TESTNET_STORAGE_BLOCKED');
      await syncPublicRuntimes(
        runtimes.map((entry) => entry.runtime),
        () => storage.canWrite(64 * 1024 * 1024),
      );
    });
    tail = next.catch(() => {});
    return next;
  };
  const backupNow = (kind: 'MANUAL' | 'AUTOMATIC') => {
    if (closed || maintenance || !backups)
      return Promise.reject(new Error('PUBLIC_TESTNET_BACKUP_UNAVAILABLE'));
    maintenance = true;
    const releases: Array<() => void> = [];
    try {
      for (const entry of runtimes) releases.push(entry.runtime.pauseWrites());
    } catch (error) {
      for (const release of releases) release();
      maintenance = false;
      return Promise.reject(error);
    }
    const next = tail
      .then(() => backups!.create(now(), kind))
      .finally(() => {
        for (const release of releases) release();
        maintenance = false;
      });
    tail = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    await tail;
    const results = await Promise.allSettled([
      Promise.resolve().then(() => app?.close()),
      ...runtimes.map((entry) => entry.runtime.close()),
    ]);
    try {
      auth?.close();
    } finally {
      storage.close();
    }
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('PUBLIC_TESTNET_CLOSE_FAILED');
  };
  try {
    storage.bindIdentity(config.profile, network.digest);
    auth = new WalletAuthStore(storage.databasePath('wallet-auth'), config.origin, {
      challengeTtlMs: config.challengeTtlMs,
      sessionTtlMs: config.sessionTtlMs,
      maxRows: config.maxAuthRows,
    });
    for (const deployment of deployments)
      runtimes.push({
        id: deployment.binding.id,
        runtime: new TradingChainRuntime({
          dbPath: storage.databasePath('vault-' + deployment.binding.id),
          evidencePath: storage.databasePath('evidence-' + deployment.binding.id),
          rpc: rpc!,
          now,
          manifest: deployment.manifest,
          inventory: deployment.inventory,
        }),
      });
    if (runtimes.length) {
      backups = new ServerBackups(
        storage,
        '0x' + createHash('sha256').update(JSON.stringify(config)).digest('hex'),
        runtimes.flatMap(({ id, runtime }) => [
          { name: 'vault-' + id, db: runtime.store.db },
          { name: 'evidence-' + id, db: runtime.evidence.db, evidenceIdentity: runtime.evidence.identity },
        ]),
      );
      await backups.verifyLatest();
    }
    app = await buildPublicTestnetApp({
      now,
      runtimeStatus: {
        configurationDigest,
        networkDigest: network.digest,
        ...(releaseIdentity ? { releaseIdentity } : {}),
        ...(archivedTestResults ? { archivedTestResults } : {}),
      },
      executionStatus: (owner, vault) => readExecutionStatus(config.executorStatus, owner, vault, now()),
      origin: config.origin,
      auth,
      runtimes,
      canWrite: () => !maintenance && storage.canWrite(),
      verifyOwner: createWalletVerifier(rpc),
      ...(backups ? { backupStatus: () => backups!.status(), backup: () => backupNow('MANUAL') } : {}),
      ...(options.webRoot ? { webRoot: join(options.webRoot) } : {}),
    });
    if (options.port !== undefined) await app.listen({ host: '127.0.0.1', port: options.port });
    const cycle = async () => {
      await syncNow().catch(() => {});
      if (backups?.due(now()) && storage.canWrite()) await backupNow('AUTOMATIC').catch(() => {});
    };
    const schedule = () => {
      if (closed) return;
      timer = setTimeout(() => {
        void cycle().finally(schedule);
      }, config.syncIntervalMs);
      timer.unref();
    };
    if (options.periodicSync) {
      await syncNow().catch(() => {});
      schedule();
    }
    return Object.freeze({ app, runtimes: Object.freeze(runtimes), storage, syncNow, backupNow, close });
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
