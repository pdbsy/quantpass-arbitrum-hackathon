import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { toUtf8String, type NonceManager, type HDNodeWallet } from 'ethers';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { JsonRpcProvider } from 'ethers';

export async function localPort(): Promise<number> {
  return new Promise((done, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });
}

export async function startBrowserAnvil(): Promise<{ rpc: string; stop: () => Promise<void> }> {
  const binary = resolve('.checks/af-chain01/toolchain/bin/anvil');
  const lock = JSON.parse(
    await readFile(new URL('../../tools/launch-market/anvil-lock.json', import.meta.url), 'utf8'),
  ) as { binarySha256: string };
  assert.equal(
    createHash('sha256')
      .update(await readFile(binary))
      .digest('hex'),
    lock.binarySha256,
  );
  const port = await localPort(),
    rpc = `http://127.0.0.1:${port}`;
  // Leave room to deploy the local fixture, then the test pins its browser-start block near wall time.
  const anvil = spawn(
    binary,
    [
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--chain-id',
      '46630',
      '--gas-limit',
      '30000000',
      '--timestamp',
      String(Math.floor(Date.now() / 1000) - 600),
      '--silent',
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const stopped = new Promise<void>((done) => anvil.once('exit', () => done()));
  const stop = async () => {
    if (anvil.exitCode === null) anvil.kill('SIGTERM');
    await stopped;
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; ++attempt) {
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
        /* Bounded local startup retry. */
      }
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(ready, 'Pinned isolated Anvil starts on a random loopback port');
    return { rpc, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export interface OfflineBrowserActor {
  readonly name: 'alice' | 'bob';
  readonly actor: HDNodeWallet;
  readonly signer: NonceManager;
  readonly session: string;
  readonly csrf: string;
  readonly sent: { hash: string; to: string; data: string; value: string }[];
  readonly messages: string[];
}
export function offlineActor(
  name: 'alice' | 'bob',
  actor: HDNodeWallet,
  signer: NonceManager,
): OfflineBrowserActor {
  return {
    name,
    actor,
    signer,
    session: randomBytes(24).toString('hex'),
    csrf: randomBytes(24).toString('hex'),
    sent: [],
    messages: [],
  };
}
export function offlineSession(
  request: FastifyRequest,
  actors: readonly OfflineBrowserActor[],
  mutation = true,
): OfflineBrowserActor | null {
  const current = actors.find((actor) => actor.session === request.cookies['offline_verified_session']);
  if (
    !current ||
    (mutation &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers['x-csrf-token'] !== current.csrf)
  )
    return null;
  return current;
}

/** Test only. Random local-wallet keys remain in this process; the page receives signatures and actual hashes. */
export function registerOfflineWallet(
  app: FastifyInstance,
  actors: readonly OfflineBrowserActor[],
  provider: JsonRpcProvider,
  contracts: readonly string[],
  origin: string,
): void {
  app.get('/auth/me', async (request, reply) => {
    const current = offlineSession(request, actors, false);
    if (!current) return reply.code(401).send({ error: { code: 'OFFLINE_VERIFIED_FIXTURE_REQUIRED' } });
    return {
      authKind: 'google',
      csrfToken: current.csrf,
      authentication: 'OFFLINE_VERIFIED_GOOGLE_FIXTURE_ONLY',
    };
  });
  app.get('/api/session', async () => ({ scope: 'TEST_ONLY', user: null }));
  app.post<{ Body: { method: string; params?: unknown[] } }>(
    '/__offline-wallet-rpc',
    async (request, reply) => {
      const current = offlineSession(request, actors);
      if (!current) return reply.code(401).send({ error: { code: 'OFFLINE_CSRF_REQUIRED' } });
      const method = request.body.method,
        params = request.body.params ?? [];
      if (method === 'eth_accounts' || method === 'eth_requestAccounts')
        return { result: [current.actor.address] };
      if (method === 'personal_sign') {
        assert.equal(String(params[1]).toLowerCase(), current.actor.address.toLowerCase());
        const message = toUtf8String(String(params[0]));
        assert.ok(
          message.length < 2048 &&
            message.includes(`URI: ${origin}\n`) &&
            message.includes('account linkage only'),
        );
        current.messages.push(message);
        return { result: await current.actor.signMessage(message) };
      }
      if (method === 'eth_sendTransaction') {
        const transaction = params[0] as { from: string; to: string; data: string; value: string };
        assert.equal(transaction.from.toLowerCase(), current.actor.address.toLowerCase());
        assert.ok(contracts.some((address) => address.toLowerCase() === transaction.to.toLowerCase()));
        const sent = await current.signer.sendTransaction({
          to: transaction.to,
          data: transaction.data,
          value: BigInt(transaction.value),
        });
        current.sent.push({
          hash: sent.hash,
          to: transaction.to,
          data: transaction.data,
          value: String(BigInt(transaction.value)),
        });
        return { result: sent.hash };
      }
      assert.ok(
        [
          'eth_chainId',
          'eth_call',
          'eth_getTransactionReceipt',
          'eth_getBlockByNumber',
          'eth_blockNumber',
          'eth_getCode',
          'eth_estimateGas',
          'eth_getTransactionByHash',
          'eth_getBalance',
        ].includes(method),
        'Read-only wallet RPC allowlist',
      );
      return { result: await provider.send(method, params) };
    },
  );
}

/** Installs actual-wallet transport and a passive observer of the genuine EventSource messages. */
export async function installEvmBrowserWallet(page: {
  addInitScript: (script: () => void) => Promise<void>;
}): Promise<void> {
  await page.addInitScript(() => {
    let csrf: string | null = null;
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const provider = {
      request: async (request: { method: string; params?: unknown[] }) => {
        if (!csrf) {
          const response = await fetch('/auth/me', { credentials: 'same-origin' });
          if (!response.ok) throw new Error('OFFLINE_VERIFIED_FIXTURE_REQUIRED');
          csrf = ((await response.json()) as { csrfToken: string }).csrfToken;
        }
        const response = await fetch('/__offline-wallet-rpc', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify(request),
        });
        const result = (await response.json()) as { result?: unknown; error?: unknown };
        if (!response.ok || result.error) throw result.error ?? new Error('LOCAL_WALLET_RPC_FAILED');
        return result.result;
      },
      on: (event: string, listener: (value: unknown) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      removeListener: (event: string, listener: (value: unknown) => void) =>
        listeners.get(event)?.delete(listener),
    };
    const received: { usdcReserveRaw: string; blockNumber: string }[] = [];
    const NativeEventSource = window.EventSource;
    class ObservedEventSource extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        this.addEventListener('message', (event) => {
          const update = JSON.parse(String(event.data));
          if (update.type === 'SNAPSHOT')
            received.push({
              usdcReserveRaw: update.snapshot.markets.AMZN.reserveUsdcRaw,
              blockNumber: update.location.blockNumber,
            });
        });
      }
    }
    Object.assign(window, {
      ethereum: provider,
      EventSource: ObservedEventSource,
      localEvmSseEvidence: received,
    });
  });
}
