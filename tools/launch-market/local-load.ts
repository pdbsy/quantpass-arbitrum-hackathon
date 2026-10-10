import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, NonceManager, Wallet, parseEther, toBeHex } from 'ethers';
import { deployLocalMarket } from './local-fixture.ts';
import { RpcMarketChain } from '../../apps/server/src/launch-market-adapters/rpc-chain.ts';
import { MarketEventIndexer } from '../../apps/server/src/launch-market/indexer.ts';
import { buildLaunchMarketServer } from '../../apps/server/src/launch-market/server.ts';
import { LaunchMarketStore } from '../../packages/launch-market/src/store.ts';
import { LaunchMarketService } from '../../packages/launch-market/src/service.ts';
import { MarketEventBroker } from '../../packages/launch-market/src/projection.ts';
import type {
  MarketQuote,
  MarketTrackedOperation,
  MarketStreamUpdate,
} from '../../packages/launch-market/src/types.ts';

interface Failure {
  phase: string;
  code: string;
  elapsedMs: number;
}
interface Timing {
  count: number;
  failures: number;
  totalMs: number;
  maxMs: number;
  buckets: Map<number, number>;
}
interface Stream {
  controller: AbortController;
  finished: Promise<void>;
  active: boolean;
  events: number;
  snapshots: number;
  version: bigint;
  block: bigint;
  gaps: number;
  oldUpdates: number;
  reserves: Set<string>;
}
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
async function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const endpoint = server.address();
      if (!endpoint || typeof endpoint === 'string') return reject(new Error('LOCAL_PORT_UNAVAILABLE'));
      server.close((error) => (error ? reject(error) : done(endpoint.port)));
    });
  });
}
function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const selected = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(selected) || selected < min || selected > max)
    throw new Error('INVALID_LOAD_DURATION');
  return selected;
}
function failureCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,96}$/.test(error.code)
  )
    return error.code;
  if (error instanceof Error && /^[A-Z0-9_]{1,96}$/.test(error.message)) return error.message;
  return 'LOCAL_LOAD_OPERATION_FAILED';
}
function percentiles(timing: Timing) {
  const sorted = [...timing.buckets].sort((a, b) => a[0] - b[0]);
  const at = (p: number) => {
    const target = Math.ceil(timing.count * p);
    let count = 0;
    for (const [millis, frequency] of sorted) {
      count += frequency;
      if (count >= target) return millis;
    }
    return null;
  };
  return {
    count: timing.count,
    failures: timing.failures,
    meanMs: timing.count ? Math.round((timing.totalMs / timing.count) * 100) / 100 : null,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    maxMs: timing.count ? Math.round(timing.maxMs * 100) / 100 : null,
    sampled: timing.count,
    percentileResolutionMs: 1,
  };
}

/** Full default run is 30 minutes. Every asset mutation below is an actual transaction on isolated Anvil. */
export async function runLocalMarketLoad(env: Readonly<Record<string, string | undefined>> = process.env) {
  const durationSeconds = integer(env.AF_LOAD_DURATION_SECONDS, 1800, 5, 7200),
    activeSeconds = integer(env.AF_LOAD_ACTIVE_SECONDS, Math.min(300, durationSeconds), 1, durationSeconds);
  const users = 20,
    sseTarget = 100,
    readRps = 10,
    root = resolve(new URL('../..', import.meta.url).pathname);
  const dir = await mkdtemp(join(tmpdir(), 'af-market-load-'));
  const output = env.AF_LOAD_REPORT ? resolve(env.AF_LOAD_REPORT) : join(dir, 'report.json');
  await mkdir(dirname(output), { recursive: true });
  const stop = new AbortController(),
    timings = new Map<string, Timing>(),
    failures: Failure[] = [],
    streams: Stream[] = [],
    requests = new Set<Promise<unknown>>(),
    publishedAt = new Map<string, number>();
  const reportFailures: Record<string, number> = {};
  let started = 0,
    trades = 0,
    claims = 0,
    approvals = 0,
    readRequests = 0,
    activeActors = 0,
    maxActiveActors = 0,
    minStreams = sseTarget,
    setupComplete = false,
    reconnectVerified = false,
    reconnectLatencyMs: number | null = null;
  let timedWindowCompleted = false,
    measuredElapsedSeconds = 0;
  let clock = 0,
    peakRss = 0,
    peakHeap = 0,
    anvil: ReturnType<typeof spawn> | null = null,
    fixture: Awaited<ReturnType<typeof deployLocalMarket>> | null = null,
    chain: RpcMarketChain | null = null,
    runtime: Awaited<ReturnType<typeof buildLaunchMarketServer>> | null = null,
    indexer: MarketEventIndexer | null = null,
    store: LaunchMarketStore | null = null;
  const begin = performance.now();
  const record = (phase: string, error: unknown) => {
    const code = failureCode(error);
    reportFailures[phase + ':' + code] = (reportFailures[phase + ':' + code] ?? 0) + 1;
    if (failures.length < 1000)
      failures.push({ phase, code, elapsedMs: Math.round(performance.now() - (started || begin)) });
    if (failures.length <= 20)
      console.log(
        JSON.stringify({
          type: 'LOAD_FAILURE',
          phase,
          code,
          elapsedMs: Math.round(performance.now() - (started || begin)),
        }),
      );
  };
  const abort = () => stop.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const timing = (name: string, elapsed: number, failed: boolean) => {
    const data = timings.get(name) ?? {
      count: 0,
      failures: 0,
      totalMs: 0,
      maxMs: 0,
      buckets: new Map<number, number>(),
    };
    data.count++;
    data.totalMs += elapsed;
    data.maxMs = Math.max(data.maxMs, elapsed);
    if (failed) data.failures++;
    const millis = Math.ceil(elapsed);
    data.buckets.set(millis, (data.buckets.get(millis) ?? 0) + 1);
    timings.set(name, data);
  };
  let origin = '';
  async function api<T>(user: number, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const time = performance.now();
    let failed = true;
    try {
      const response = await fetch(origin + path, {
        method,
        headers: {
          cookie: 'af_offline_load_user=' + user,
          origin,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = (await response.json()) as T & { error?: { code?: string } };
      if (!response.ok) {
        const error = new Error('HTTP_OPERATION_REJECTED') as Error & { code: string };
        error.code = result.error?.code ?? 'HTTP_' + response.status;
        throw error;
      }
      failed = false;
      return result;
    } finally {
      timing(
        path.split('?')[0]!.replace(/\/operations\/[^/]+$/, '/operations/:id'),
        performance.now() - time,
        failed,
      );
    }
  }
  async function connectStream(): Promise<Stream> {
    const controller = new AbortController(),
      response = await fetch(origin + '/api/launch-market/events', {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal,
      });
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get('content-type')?.includes('text/event-stream')
    ) {
      controller.abort();
      throw new Error('SSE_CONNECT_FAILED');
    }
    const stream: Stream = {
      controller,
      finished: Promise.resolve(),
      active: true,
      events: 0,
      snapshots: 0,
      version: 0n,
      block: 0n,
      gaps: 0,
      oldUpdates: 0,
      reserves: new Set(),
    };
    const reader = response.body.getReader();
    stream.finished = (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) {
            if (!controller.signal.aborted) throw new Error('SSE_CLOSED_EARLY');
            break;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.length > 262_144) throw new Error('SSE_BUFFER_LIMIT');
          let end;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = frame.split('\n').find((line) => line.startsWith('data: '));
            if (!data) continue;
            const event = JSON.parse(data.slice(6)) as MarketStreamUpdate;
            stream.events++;
            if (event.location.chainId !== 46630 || !/^0x[0-9a-f]{64}$/i.test(event.location.blockHash))
              throw new Error('INVALID_SSE_CHAIN_LOCATION');
            if (event.type === 'SNAPSHOT' || event.type === 'REORG') {
              if (!event.snapshot) throw new Error('MISSING_SSE_SNAPSHOT');
              const observed = publishedAt.get(
                event.type + ':' + event.location.version + ':' + event.location.blockHash,
              );
              if (observed !== undefined)
                timing('sse_publish_to_delivery', performance.now() - observed, false);
              const version = BigInt(event.location.version),
                block = BigInt(event.location.blockNumber);
              if (event.type !== 'REORG' && (version < stream.version || block < stream.block)) {
                stream.oldUpdates++;
                throw new Error('OLD_SSE_SNAPSHOT');
              }
              if (stream.version && version > stream.version + 1n) stream.gaps++;
              stream.version = version;
              stream.block = block;
              stream.snapshots++;
              stream.reserves.add(event.snapshot.markets.AMZN.reserveUsdcRaw);
              if (stream.reserves.size > 1000) stream.reserves.delete(stream.reserves.values().next().value!);
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) record('sse', error);
      } finally {
        stream.active = false;
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    })();
    streams.push(stream);
    return stream;
  }
  let confirmation: Promise<unknown> | null = null;
  const mineConfirmations = async () => {
    if (!fixture) throw new Error('FIXTURE_UNAVAILABLE');
    if (confirmation) return confirmation;
    const pending = fixture.provider.send('anvil_mine', ['0x2']);
    confirmation = pending;
    try {
      return await pending;
    } finally {
      if (confirmation === pending) confirmation = null;
    }
  };
  try {
    const binary = resolve(root, '.checks/af-chain01/toolchain/bin/anvil'),
      lock = JSON.parse(await readFile(new URL('./anvil-lock.json', import.meta.url), 'utf8')) as {
        binarySha256: string;
      };
    if (
      createHash('sha256')
        .update(await readFile(binary))
        .digest('hex') !== lock.binarySha256
    )
      throw new Error('ANVIL_BINARY_HASH_MISMATCH');
    const rpcPort = await freePort(),
      rpc = 'http://127.0.0.1:' + rpcPort;
    anvil = spawn(
      binary,
      [
        '--host',
        '127.0.0.1',
        '--port',
        String(rpcPort),
        '--chain-id',
        '46630',
        '--gas-limit',
        '30000000',
        '--silent',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    anvil.once('error', (error) => record('anvil', error));
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(rpc, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
          signal: AbortSignal.timeout(1000),
        });
        ready = BigInt(((await response.json()) as { result: string }).result) === 46630n;
        if (ready) break;
      } catch {
        /* Local child startup only. */
      }
      await sleep(100);
    }
    if (!ready) throw new Error('LOCAL_ANVIL_START_FAILED');
    fixture = await deployLocalMarket(rpc);
    const f = fixture;
    const actors = Array.from({ length: users }, () => Wallet.createRandom().connect(f.provider));
    const signers = actors.map((actor) => new NonceManager(actor));
    for (const actor of actors)
      await f.provider.send('anvil_setBalance', [actor.address, toBeHex(parseEther('10'))]);
    const port = await freePort();
    origin = 'http://127.0.0.1:' + port;
    chain = new RpcMarketChain(f.manifest, rpc);
    await chain.initialize();
    clock = Number((await f.provider.getBlock('latest'))!.timestamp);
    store = new LaunchMarketStore(join(dir, 'accounts.sqlite'), origin);
    // Local timing observer preserves the production 100-listener budget and the exact SSE messages.
    const broker = new (class extends MarketEventBroker {
      override publish(event: MarketStreamUpdate): void {
        if (started && (event.type === 'SNAPSHOT' || event.type === 'REORG')) {
          publishedAt.set(
            event.type + ':' + event.location.version + ':' + event.location.blockHash,
            performance.now(),
          );
          if (publishedAt.size > 4096) publishedAt.delete(publishedAt.keys().next().value!);
        }
        super.publish(event);
      }
    })();
    const service = new LaunchMarketService({
      manifest: f.manifest,
      store,
      chain,
      quoteSigner: f.operator,
      claimSigner: f.operator,
      now: () => clock,
      broker,
      ethReference: { read: async () => ({ ethUsdPriceRaw: '2000000000', observedAt: clock }) },
    });
    indexer = new MarketEventIndexer({
      path: join(dir, 'events.sqlite'),
      manifest: f.manifest,
      provider: chain.provider,
      service,
      pollIntervalMs: 1000,
    });
    runtime = await buildLaunchMarketServer({
      service,
      indexer,
      origin,
      trustedIdentity: (request) => {
        const raw = request.cookies['af_offline_load_user'];
        if (!raw || !/^([0-9]|1[0-9])$/.test(raw)) return null;
        return {
          email: 'offline-load-' + raw + '@example.test',
          subject: 'explicit-offline-load-fixture-' + raw,
          emailVerified: true,
        };
      },
      dispose: async () => chain?.close(),
    });
    await runtime.start('127.0.0.1', port);
    const approval = new Interface(['function approve(address,uint256)']);
    async function quote(
      user: number,
      operation: 'CLAIM' | 'BUY' | 'SELL',
      amountRaw: string,
    ): Promise<MarketQuote> {
      clock = Math.max(clock, Number((await f.provider.getBlock('latest'))!.timestamp));
      return api(user, 'POST', '/api/launch-market/quote', {
        owner: actors[user]!.address,
        strategyId: 'AMZN',
        operation,
        asset: 'AF_USDC',
        amountRaw,
        slippageBps: 100,
      });
    }
    async function act(user: number, operation: 'CLAIM' | 'BUY' | 'SELL', amountRaw: string) {
      const signer = signers[user]!;
      let q = await quote(user, operation, amountRaw);
      for (let count = 0; q.simulation === 'APPROVAL_REQUIRED'; count++) {
        if (count >= 2 || !q.allowance) throw new Error('INVALID_APPROVAL_DEFICIT');
        await (
          await signer.sendTransaction({
            to: q.allowance.token,
            data: approval.encodeFunctionData('approve', [q.allowance.spender, q.allowance.amountRaw]),
          })
        ).wait();
        approvals++;
        await mineConfirmations();
        q = await quote(user, operation, amountRaw);
      }
      if (!q.gasEstimateRaw || q.simulation !== 'READY') throw new Error('MISSING_REAL_GAS_ESTIMATE');
      const tx = await signer.sendTransaction({
        ...q.transaction,
        value: BigInt(q.transaction.value),
        gasLimit: (BigInt(q.gasEstimateRaw) * 12n) / 10n,
      });
      await tx.wait();
      const submitted = await api<MarketTrackedOperation>(user, 'POST', '/api/launch-market/submissions', {
        quoteId: q.id,
        transactionHash: tx.hash,
        owner: q.owner,
      });
      let completed: MarketTrackedOperation | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        await mineConfirmations();
        completed = await api(user, 'GET', '/api/launch-market/operations/' + submitted.id);
        if (completed!.state === 'COMPLETED') break;
      }
      if (completed?.state !== 'COMPLETED' || completed.confirmations < 3)
        throw new Error('TX_CONFIRMATION_FAILED');
      if (operation === 'CLAIM') claims++;
      else trades++;
    }
    // Explicit test credentials are confined to this runner. Real Google sessions remain the production bridge's concern.
    for (let user = 0; user < users; user++) {
      const challenge = await api<{ nonce: string; message: string }>(
        user,
        'POST',
        '/api/launch-market/wallet/challenge',
        { owner: actors[user]!.address },
      );
      await api(user, 'POST', '/api/launch-market/wallet/bind', {
        nonce: challenge.nonce,
        signature: await actors[user]!.signMessage(challenge.message),
      });
      await act(user, 'CLAIM', '0');
      if ((await f.usdc.getFunction('balanceOf')(actors[user]!.address)) !== 1_000_000_000n)
        throw new Error('CLAIM_CHAIN_BALANCE_MISMATCH');
    }
    await indexer.poll();
    for (let batch = 0; batch < sseTarget; batch += 20)
      await Promise.all(Array.from({ length: Math.min(20, sseTarget - batch) }, () => connectStream()));
    if (service.broker.connections !== sseTarget) throw new Error('SSE_CONNECTION_TARGET_NOT_MET');
    setupComplete = true;
    started = performance.now();
    console.log(
      JSON.stringify({
        type: 'LOAD_STARTED',
        durationSeconds,
        activeSeconds,
        users,
        sseConnections: sseTarget,
        readRps,
        report: output,
      }),
    );
    const trading = Array.from({ length: users }, (_, user) =>
      (async () => {
        for (
          let cycle = 0;
          !stop.signal.aborted && performance.now() - started < activeSeconds * 1000;
          cycle++
        ) {
          const deadline = started + cycle * 5000;
          await sleep(Math.max(0, deadline - performance.now()));
          if (stop.signal.aborted || performance.now() - started >= activeSeconds * 1000) break;
          activeActors++;
          maxActiveActors = Math.max(maxActiveActors, activeActors);
          try {
            await act(
              user,
              cycle % 2 === 0 ? 'BUY' : 'SELL',
              cycle % 2 === 0 ? '1000000' : '1000000000000000000',
            );
          } catch (error) {
            record('trade', error);
          } finally {
            activeActors--;
          }
        }
      })(),
    );
    const reading = (async () => {
      for (
        let count = 0;
        !stop.signal.aborted && performance.now() - started < durationSeconds * 1000;
        count++
      ) {
        await sleep(Math.max(0, started + count * 100 - performance.now()));
        if (stop.signal.aborted || performance.now() - started >= durationSeconds * 1000) break;
        if (requests.size >= 100) {
          record('read', new Error('READ_INFLIGHT_LIMIT'));
          continue;
        }
        const user = count % users,
          slot = count % 10;
        readRequests++;
        const request = (
          slot < 5
            ? api(user, 'GET', '/api/launch-market/snapshot')
            : slot < 8
              ? api(user, 'GET', '/api/launch-market/wallet?owner=' + actors[user]!.address)
              : quote(user, 'BUY', '1000000')
        ).catch((error) => record('read', error));
        requests.add(request);
        void request.finally(() => requests.delete(request));
      }
    })();
    let lastProgress = 0;
    while (!stop.signal.aborted && performance.now() - started < durationSeconds * 1000) {
      await sleep(1000);
      const active = streams.filter((stream) => stream.active).length;
      minStreams = Math.min(minStreams, active);
      if (active !== sseTarget) {
        record('sse', new Error('SSE_ACTIVE_TARGET_LOST'));
        stop.abort();
      }
      if (anvil.exitCode !== null) {
        record('anvil', new Error('LOCAL_ANVIL_EXITED'));
        stop.abort();
      }
      const memory = process.memoryUsage();
      peakRss = Math.max(peakRss, memory.rss);
      peakHeap = Math.max(peakHeap, memory.heapUsed);
      const elapsed = Math.floor((performance.now() - started) / 1000);
      if (elapsed - lastProgress >= 30) {
        lastProgress = elapsed;
        console.log(
          JSON.stringify({
            type: 'LOAD_PROGRESS',
            elapsedSeconds: elapsed,
            sseConnections: active,
            trades,
            readRequests,
            failures: Object.values(reportFailures).reduce((sum, n) => sum + n, 0),
            failureCounts: reportFailures,
            rssMiB: Math.round(memory.rss / 1024 / 1024),
          }),
        );
        await writeFile(
          output + '.partial.tmp',
          JSON.stringify(
            {
              type: 'LOAD_PARTIAL',
              elapsedSeconds: elapsed,
              sseConnections: active,
              trades,
              readRequests,
              failureCounts: reportFailures,
              failures,
              latency: Object.fromEntries([...timings].map(([name, value]) => [name, percentiles(value)])),
            },
            null,
            2,
          ) + '\n',
          { mode: 0o600 },
        );
        await rename(output + '.partial.tmp', output + '.partial.json');
      }
    }
    measuredElapsedSeconds = (performance.now() - started) / 1000;
    timedWindowCompleted = !stop.signal.aborted && measuredElapsedSeconds >= durationSeconds;
    await reading;
    await Promise.all(trading);
    await Promise.all(requests);
    // Reconnect after the uninterrupted measurement, keeping its brief gap out of the 30-minute connection count.
    if (!stop.signal.aborted) {
      const reconnectStarted = performance.now();
      const old = streams[0]!;
      old.controller.abort();
      await old.finished;
      const replacement = await connectStream();
      for (let attempt = 0; attempt < 100 && replacement.snapshots === 0; attempt++) await sleep(10);
      const authoritative = await api<{ location: { version: string } }>(
        0,
        'GET',
        '/api/launch-market/snapshot',
      );
      reconnectVerified =
        replacement.snapshots > 0 &&
        replacement.version >= old.version &&
        replacement.version <= BigInt(authoritative.location.version);
      reconnectLatencyMs = Math.round((performance.now() - reconnectStarted) * 100) / 100;
      if (!reconnectVerified) record('reconnect', new Error('SSE_RECONNECT_NOT_AUTHORITATIVE'));
    }
  } catch (error) {
    record(setupComplete ? 'load' : 'setup', error);
  } finally {
    for (const stream of streams) stream.controller.abort();
    await Promise.all(streams.map((stream) => stream.finished));
    await runtime?.stop().catch((error) => record('shutdown', error));
    if (!runtime) {
      await indexer?.close();
      store?.close();
      chain?.close();
    }
    fixture?.provider.destroy();
    if (anvil) {
      const ended =
        anvil.exitCode !== null
          ? Promise.resolve()
          : new Promise<void>((done) => anvil!.once('exit', () => done()));
      anvil.kill('SIGTERM');
      await Promise.race([ended, sleep(3000)]);
      if (anvil.exitCode === null) anvil.kill('SIGKILL');
    }
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
  const elapsedSeconds = measuredElapsedSeconds || (started ? (performance.now() - started) / 1000 : 0);
  const fullRequirementRequested = durationSeconds >= 1800 && activeSeconds >= 300;
  const fullDurationCompleted = timedWindowCompleted;
  const apiNames = ['/api/launch-market/snapshot', '/api/launch-market/wallet', '/api/launch-market/quote'];
  const apiLatencyPassed = apiNames.every((name) => {
    const value = timings.get(name);
    return value !== undefined && (percentiles(value).p95Ms ?? Infinity) <= 1000;
  });
  const delivery = timings.get('sse_publish_to_delivery');
  const deliveryLatencyPassed = delivery !== undefined && (percentiles(delivery).p95Ms ?? Infinity) <= 5000;
  const passed =
    setupComplete &&
    fullDurationCompleted &&
    !stop.signal.aborted &&
    failures.length === 0 &&
    minStreams === sseTarget &&
    claims === users &&
    maxActiveActors === users &&
    trades >= Math.floor(activeSeconds / 5) * users &&
    readRequests >= durationSeconds * readRps - 1 &&
    reconnectVerified &&
    reconnectLatencyMs !== null &&
    reconnectLatencyMs <= 10_000 &&
    apiLatencyPassed &&
    deliveryLatencyPassed;
  const report = {
    schemaVersion: 2,
    mode: 'LOCAL_EVM_ONLY',
    network: 'isolated pinned Anvil 1.5.1 / chain 46630',
    fullRequirementRequested,
    fullDurationCompleted,
    passed,
    interrupted: stop.signal.aborted,
    durationSeconds,
    activeSeconds,
    elapsedSeconds: Math.round(elapsedSeconds * 100) / 100,
    users,
    claims,
    trades,
    approvals,
    maxConcurrentActors: maxActiveActors,
    sse: {
      target: sseTarget,
      minConnected: minStreams,
      events: streams.reduce((sum, stream) => sum + stream.events, 0),
      snapshots: streams.reduce((sum, stream) => sum + stream.snapshots, 0),
      versionGaps: streams.reduce((sum, stream) => sum + stream.gaps, 0),
      oldUpdates: streams.reduce((sum, stream) => sum + stream.oldUpdates, 0),
      distinctObservedAmznReserves: streams[0]?.reserves.size ?? 0,
      reconnectVerified,
      reconnectLatencyMs,
      publishToDelivery: delivery ? percentiles(delivery) : null,
    },
    reads: {
      targetRps: readRps,
      requests: readRequests,
      achievedRps: Math.round((readRequests / durationSeconds) * 100) / 100,
    },
    latency: Object.fromEntries([...timings].map(([name, value]) => [name, percentiles(value)])),
    thresholds: {
      apiP95LimitMs: 1000,
      apiLatencyPassed,
      sseDeliveryP95LimitMs: 5000,
      deliveryLatencyPassed,
      reconnectLimitMs: 10_000,
    },
    memory: {
      peakRssMiB: Math.round(peakRss / 1024 / 1024),
      peakHeapMiB: Math.round(peakHeap / 1024 / 1024),
    },
    failureCounts: reportFailures,
    failures,
    failureDetailsTruncated: Object.values(reportFailures).reduce((sum, n) => sum + n, 0) > failures.length,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output + '.tmp', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await rename(output + '.tmp', output);
  console.log(
    JSON.stringify({
      type: 'LOAD_RESULT',
      passed,
      fullRequirementRequested,
      fullDurationCompleted,
      report: output,
      trades,
      reads: readRequests,
      failures: Object.values(reportFailures).reduce((sum, n) => sum + n, 0),
    }),
  );
  if (env.AF_LOAD_KEEP_DATABASES !== '1' && env.AF_LOAD_REPORT)
    await rm(dir, { recursive: true, force: true });
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runLocalMarketLoad();
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(failureCode(error));
    process.exitCode = 1;
  }
}
