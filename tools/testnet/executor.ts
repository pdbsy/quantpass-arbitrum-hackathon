import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet, type TransactionRequest } from 'ethers';
import { readJson, readRegularBytes, loadReferenceAdmission } from './preflight.ts';
import { testnetSubmissionTransport } from '../../packages/testnet/src/submission-transport.ts';
import { parseExecutorConfig } from '../../packages/testnet/src/execution-config.ts';
import { loadTradingDeployments } from '../../packages/testnet/src/deployments.ts';
import { JsonRpcClient } from '../../packages/chain-adapter/src/rpc.ts';
import { readTradingSnapshot } from '../../packages/testnet/src/trading-reader.ts';
import { privateServerStorage } from '../../packages/testnet/src/private-storage.ts';
import { OrderJournal } from '../../packages/testnet/src/order-journal.ts';
import { BatchJournal } from '../../packages/market-data/src/batch-journal.ts';
import { evidenceHash } from '../../packages/testnet/src/executor-plan.ts';
import {
  TestnetExecutorService,
  qualifyExecutorDeployments,
} from '../../apps/server/src/testnet-executor-service.ts';
import { restrictedOrderReconciler } from '../../apps/server/src/testnet-order-reconciler.ts';
import { ServerBackups } from '../../packages/testnet/src/server-backups.ts';

function secret(path: string, max = 1024 * 1024) {
  if (process.platform === 'win32') throw new Error('EXECUTOR_ACL_NOT_QUALIFIED');
  const bytes = readRegularBytes(path, max),
    stat = lstatSync(path);
  if (stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0)
    throw new Error('EXECUTOR_SECRET_PERMISSIONS');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function unlock(address: string, file: string, passwordFile: string) {
  const raw = secret(file),
    v = JSON.parse(raw),
    crypto = v.crypto ?? v.Crypto;
  if (
    v.version !== 3 ||
    typeof v.address !== 'string' ||
    ('0x' + v.address).toLowerCase() !== address ||
    crypto?.cipher !== 'aes-128-ctr' ||
    crypto?.kdf !== 'scrypt' ||
    ![16384, 32768, 65536, 131072, 262144].includes(crypto.kdfparams?.n) ||
    crypto.kdfparams?.r !== 8 ||
    crypto.kdfparams?.p !== 1 ||
    crypto.kdfparams?.dklen !== 32
  )
    throw new Error('EXECUTOR_KEYSTORE');
  const password = secret(passwordFile, 1024).replace(/\r?\n$/, '');
  if (!password || password.includes('\n') || password.includes('\r'))
    throw new Error('EXECUTOR_PASSWORD_INPUT');
  const wallet = await Wallet.fromEncryptedJson(raw, password);
  if (wallet.address.toLowerCase() !== address) throw new Error('EXECUTOR_KEY_IDENTITY');
  return {
    address,
    sign: (transaction: Readonly<Record<string, string>>) =>
      wallet.signTransaction({
        ...transaction,
        nonce: Number(transaction.nonce),
        type: 2,
      } as TransactionRequest),
  };
}
export async function executorCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'AlphaForge private Testnet executor: --watch <operator.json> or --run-testnet --enable-signing <operator.json>. Never started by bootstrap/doctor/CI.',
    );
    return 0;
  }
  const enabled = args.length === 3 && args[0] === '--run-testnet' && args[1] === '--enable-signing';
  const watch = args.length === 2 && args[0] === '--watch';
  if (
    (!enabled && !watch) ||
    args.at(-1)!.startsWith('--') ||
    (enabled &&
      (env.CI !== undefined ||
        env.GITHUB_ACTIONS !== undefined ||
        env.AF_TESTNET_EXECUTION_ACK !== 'I_AUTHORIZE_TESTNET_SIGNING_46630'))
  ) {
    console.error('EXECUTOR_USAGE_OR_AUTHORIZATION');
    return 2;
  }
  let storage: ReturnType<typeof privateServerStorage> | undefined,
    orders: OrderJournal | undefined,
    batches: BatchJournal | undefined,
    service: TestnetExecutorService | undefined,
    timer: NodeJS.Timeout | undefined;
  let stopped = false,
    tail: Promise<void> = Promise.resolve();
  const close = async () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    await service?.close();
    await tail;
    orders?.close();
    batches?.close();
    storage?.close();
  };
  try {
    const file = resolve(args.at(-1)!),
      config = parseExecutorConfig(readJson(file)),
      directory = dirname(file),
      identity = evidenceHash(config);
    const admission = loadReferenceAdmission(join(directory, config.referenceFile), config.referenceDigest);
    const statusExport = env.AF_EXECUTOR_STATUS_EXPORT_FILE;
    if (statusExport) {
      const parent = dirname(statusExport),
        stat = lstatSync(parent);
      if (
        !statusExport.endsWith('/execution-status.json') ||
        resolve(statusExport) !== statusExport ||
        realpathSync(parent) !== parent ||
        !stat.isDirectory() ||
        stat.uid !== process.getuid!() ||
        (stat.mode & 0o002) !== 0
      )
        throw new Error('EXECUTOR_STATUS_DIRECTORY');
    }
    const deployments = await loadTradingDeployments(config.vaults, async (name) =>
      readJson(join(directory, name)),
    );
    qualifyExecutorDeployments({ config, terms: admission.terms, deployments });
    const endpoint = env.AF_TESTNET_RPC_URL;
    if (!endpoint) throw new Error('EXECUTOR_RPC_REQUIRED');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('EXECUTOR_RPC');
    const rpc = new JsonRpcClient([endpoint]);
    // Full real-chain identity qualification precedes private storage and any key unlock.
    for (const d of deployments) await readTradingSnapshot(rpc, d.manifest, d.inventory);
    let submission;
    if (enabled) {
      for (const d of deployments)
        if (d.inventory.owner === config.executor || d.inventory.owner === config.keeper)
          throw new Error('EXECUTOR_OWNER_KEY_FORBIDDEN');
      if (
        !env.AF_EXECUTOR_KEYSTORE_FILE ||
        !env.AF_EXECUTOR_PASSWORD_FILE ||
        !env.AF_KEEPER_KEYSTORE_FILE ||
        !env.AF_KEEPER_PASSWORD_FILE
      )
        throw new Error('EXECUTOR_PRIVATE_FILES_REQUIRED');
      const executor = await unlock(
          config.executor,
          env.AF_EXECUTOR_KEYSTORE_FILE,
          env.AF_EXECUTOR_PASSWORD_FILE,
        ),
        keeper = await unlock(config.keeper, env.AF_KEEPER_KEYSTORE_FILE, env.AF_KEEPER_PASSWORD_FILE);
      const transport = testnetSubmissionTransport(endpoint);
      submission = { executor, keeper, transport };
    }
    storage = privateServerStorage(config.dataDirectory, config.maxStorageBytes);
    orders = new OrderJournal(storage.databasePath('orders'), identity);
    batches = new BatchJournal(storage.databasePath('reference-batches'));
    batches.database.exec('PRAGMA synchronous=FULL');
    const ledger = orders,
      capture = batches,
      privateStorage = storage;
    service = new TestnetExecutorService({
      config,
      terms: admission.terms,
      rpc,
      deployments,
      orders: ledger,
      batches: capture,
      canWrite: () => privateStorage.bytes() + 64 * 1024 * 1024 < privateStorage.maxBytes,
      reviewValid: () => {
        try {
          loadReferenceAdmission(join(directory, config.referenceFile), config.referenceDigest);
          return true;
        } catch {
          return false;
        }
      },
      reconcile: restrictedOrderReconciler(ledger, rpc, deployments, capture, admission.terms, config.gas),
      ...(submission ? { submission } : {}),
    });
    const backups = new ServerBackups(storage, identity, [
      { name: 'orders', db: orders.db },
      { name: 'reference-batches', db: batches.database, referenceTerms: admission.terms },
    ]);
    await backups.verifyLatest();
    const current = service;
    const cycle = async () => {
      try {
        await current.tick();
      } catch {
        /* Public status contains a code only; RPC/key errors stay private. */
      }
      if (stopped) return;
      if (backups.due(Date.now()) && privateStorage.canWrite())
        await backups.create(Date.now(), 'AUTOMATIC').catch(() => {});
      if (privateStorage.canWrite()) {
        const report = {
          schemaVersion: 1,
          chainId: 46630,
          configurationDigest: identity,
          observedAt: Date.now(),
          state: current.status,
          signingEnabled: enabled,
          referencePaused: current.engine.paused,
          lastMinute: current.engine.lastMinute,
          backups: backups.status(),
          vaults: deployments.map((d) => ({
            owner: d.inventory.owner,
            vault: d.manifest.contractAddress,
            state: current.status,
          })),
          scope: 'TEST_SUBSTITUTES_ONLY',
        };
        const temporary = join(privateStorage.folder, '.status-' + randomUUID() + '.json');
        writeFileSync(temporary, JSON.stringify(report) + '\n', { flag: 'wx', mode: 0o600 });
        renameSync(temporary, join(privateStorage.folder, 'status.json'));
        if (statusExport) {
          const output = join(dirname(statusExport), '.status-' + randomUUID() + '.json');
          writeFileSync(
            output,
            JSON.stringify({
              schemaVersion: report.schemaVersion,
              chainId: 46630,
              configurationDigest: identity,
              observedAt: report.observedAt,
              signingEnabled: enabled,
              vaults: report.vaults,
              scope: report.scope,
            }) + '\n',
            { flag: 'wx', mode: 0o640 },
          );
          renameSync(output, statusExport);
        }
      }
    };
    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(() => {
        tail = cycle()
          .catch(() => {
            current.status = 'PAUSED_STORAGE_OR_BACKUP';
          })
          .finally(schedule);
      }, 5000);
    };
    process.once('SIGINT', () => {
      void close().catch(() => {
        process.exitCode = 1;
      });
    });
    process.once('SIGTERM', () => {
      void close().catch(() => {
        process.exitCode = 1;
      });
    });
    tail = cycle().catch(() => {
      current.status = 'PAUSED_STORAGE_OR_BACKUP';
    });
    await tail;
    schedule();
    console.log(
      enabled ? 'ALPHAFORGE_RESTRICTED_TESTNET_EXECUTOR_RUNNING' : 'ALPHAFORGE_TESTNET_WATCH_ONLY_NO_SIGNING',
    );
    return 0;
  } catch {
    await close().catch(() => {});
    console.error('EXECUTOR_STARTUP_REJECTED');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await executorCli(process.argv.slice(2), process.env);
