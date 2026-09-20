import type { FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import { buildM3App } from './m3-app.ts';
import {
  composeM3ChainRuntime,
  type M3ChainRuntime,
  type M3ChainRuntimeDependencies,
  type M3ChainRuntimeDeployment,
  type M3RuntimeSyncResult,
} from './m3-chain-runtime.ts';

interface M3ServerStartupBaseOptions {
  readonly app: {
    readonly dbPath: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly origin: string;
    readonly webRoot?: string;
  };
  readonly listen?: {
    readonly host: '127.0.0.1' | 'localhost';
    readonly port: number;
  };
  readonly syncIntervalMs?: number | null;
}

export type M3ServerStartupOptions = M3ServerStartupBaseOptions &
  (
    | {
        readonly deployment: M3ChainRuntimeDeployment;
        readonly deployments?: never;
      }
    | {
        readonly deployment?: never;
        readonly deployments: readonly M3ChainRuntimeDeployment[];
      }
  );

export interface M3ServerHandle {
  readonly app: FastifyInstance;
  readonly runtime: M3ChainRuntime | null;
  readonly runtimes: readonly M3ChainRuntime[];
  syncNow(): Promise<M3RuntimeSyncResult | null>;
  close(): Promise<void>;
}

function deploymentSet(options: M3ServerStartupOptions): readonly M3ChainRuntimeDeployment[] {
  const hasSingle = options.deployment !== undefined;
  const hasMultiple = options.deployments !== undefined;
  if (hasSingle === hasMultiple) throw new Error('INVALID_M3_DEPLOYMENT_SET');
  const deployments = hasMultiple ? options.deployments! : [options.deployment!];
  if (
    deployments.length === 0 ||
    (deployments.length > 1 && deployments.some((item) => item.deploymentStatus === 'NOT_DEPLOYED'))
  )
    throw new Error('INVALID_M3_DEPLOYMENT_SET');
  const paths = deployments.flatMap((item) =>
    item.deploymentStatus === 'DEPLOYED' ? [resolve(item.dbPath)] : [],
  );
  if (new Set(paths).size !== paths.length || paths.includes(resolve(options.app.dbPath)))
    throw new Error('INVALID_M3_DEPLOYMENT_SET');
  return Object.freeze([...deployments]);
}

function aggregateSync(results: readonly M3RuntimeSyncResult[]): M3RuntimeSyncResult {
  return Object.freeze(
    results.reduce(
      (total, result) => ({
        scannedBlocks: total.scannedBlocks + result.scannedBlocks,
        insertedEvents: total.insertedEvents + result.insertedEvents,
        reorgedBlocks: total.reorgedBlocks + result.reorgedBlocks,
        trackedOperations: total.trackedOperations + result.trackedOperations,
        trackingFailures: total.trackingFailures + result.trackingFailures,
      }),
      {
        scannedBlocks: 0,
        insertedEvents: 0,
        reorgedBlocks: 0,
        trackedOperations: 0,
        trackingFailures: 0,
      },
    ),
  );
}

export async function startM3Server(
  options: M3ServerStartupOptions,
  dependencies: M3ChainRuntimeDependencies = {},
): Promise<M3ServerHandle> {
  const deployments = deploymentSet(options);
  const interval =
    options.syncIntervalMs === undefined && deployments.some((item) => item.deploymentStatus === 'DEPLOYED')
      ? 5_000
      : options.syncIntervalMs;
  if (
    interval !== null &&
    interval !== undefined &&
    (!Number.isSafeInteger(interval) || interval < 1_000 || interval > 300_000)
  )
    throw new Error('INVALID_M3_SYNC_INTERVAL');
  if (
    options.listen &&
    (!['127.0.0.1', 'localhost'].includes(options.listen.host) ||
      !Number.isSafeInteger(options.listen.port) ||
      options.listen.port < 0 ||
      options.listen.port > 65_535)
  )
    throw new Error('INVALID_M3_LISTEN_ADDRESS');

  const runtimes: M3ChainRuntime[] = [];
  try {
    for (const deployment of deployments) {
      const runtime = composeM3ChainRuntime(deployment, dependencies);
      if (runtime) runtimes.push(runtime);
    }
  } catch (error) {
    for (const runtime of runtimes) runtime.close();
    throw error;
  }
  const runtime = runtimes.length === 1 ? runtimes[0]! : null;
  let app: FastifyInstance | null = null;
  let closed = false;
  let timer: NodeJS.Timeout | null = null;
  let syncTail: Promise<M3RuntimeSyncResult | null> = Promise.resolve(null);
  const syncNow = (): Promise<M3RuntimeSyncResult | null> => {
    if (closed) return Promise.reject(new Error('M3_SERVER_CLOSED'));
    const next = syncTail.then(async () => {
      if (runtimes.length === 0) return null;
      const settled = await Promise.allSettled(runtimes.map((item) => item.syncToHead()));
      if (settled.some((result) => result.status === 'rejected')) throw new Error('M3_RUNTIME_SYNC_FAILED');
      return aggregateSync(
        settled.map((result) => (result as PromiseFulfilledResult<M3RuntimeSyncResult>).value),
      );
    });
    syncTail = next.catch(() => null);
    return next;
  };

  try {
    app = (
      await buildM3App({
        ...options.app,
        ...(runtimes.length ? { chainRuntimes: runtimes } : {}),
      })
    ).app;
    app.addHook('onClose', async () => {
      closed = true;
      if (timer) clearTimeout(timer);
    });
    // Configuration and storage construction above remain fatal. A failed chain read or
    // durable reorg fault must still leave the UI accessible and its stale API reads closed.
    await syncNow().catch(() => undefined);
    if (options.listen) await app.listen(options.listen);
  } catch (error) {
    if (app) await app.close();
    else for (const item of runtimes) item.close();
    throw error;
  }

  if (runtimes.length && interval) {
    const schedule = () => {
      timer = setTimeout(() => {
        void syncNow()
          .catch(() => undefined)
          .finally(() => {
            if (!closed) schedule();
          });
      }, interval);
      timer.unref();
    };
    schedule();
  }

  let closePromise: Promise<void> | null = null;
  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    if (timer) clearTimeout(timer);
    closePromise = syncTail
      .catch(() => null)
      .then(async () => {
        await app!.close();
      });
    return closePromise;
  };
  return Object.freeze({ app, runtime, runtimes: Object.freeze([...runtimes]), syncNow, close });
}
