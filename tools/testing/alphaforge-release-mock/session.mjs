import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { buildPublicTestnetApp } from '../../../apps/server/src/testnet-app.ts';
import { TradingChainRuntime } from '../../../apps/server/src/trading-chain-runtime.ts';
import { WalletAuthStore } from '../../../packages/testnet/src/wallet-auth.ts';
import { OrderJournal } from '../../../packages/testnet/src/order-journal.ts';
import { privateServerStorage } from '../../../packages/testnet/src/private-storage.ts';
import { ServerBackups } from '../../../packages/testnet/src/server-backups.ts';
import { asHexData } from '../../../packages/chain-adapter/src/types.ts';
import { feedInterface } from '../../../packages/testnet/src/trading-abi.ts';
import {
  tradingRpcFixture,
  tradingFixtureAddress as address,
} from '../../../test/helpers/testnet-trading-rpc.ts';
import {
  releaseScenario,
  OWNER_A,
  OWNER_B,
  FIXTURE_IDENTITY,
} from '../../../test/fixtures/release-mock/scenario.mjs';
export { OWNER_A, OWNER_B };

// Fixture digest bytes, deliberately not a valid Ethereum signature. Only this
// dedicated composition accepts them; no key, signer or remote transport exists.
export const mockSignature = (message, owner) =>
  '0x' +
  createHash('sha256')
    .update('MOCK\0' + owner + '\0' + message)
    .digest('hex');
const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        ['signature', 'nonce', 'message', 'token'].includes(k) ? '[MOCK_REDACTED]' : redact(v),
      ]),
    );
  return value;
};

export async function createReleaseSession({
  directory,
  webRoot,
  now = Date.parse('2026-10-03T00:00:00Z'),
  blockTimestamp,
  referenceObservedAt = {},
  runtimeStatus,
  executionStatus,
} = {}) {
  assert.equal(process.versions.node, '24.21.0', 'release mock requires approved Node');
  const root = resolve('.checks/release-mock');
  mkdirSync(root, { recursive: true });
  const folder = directory ? resolve(directory) : mkdtempSync(join(root, 'session-'));
  assert.ok(folder.startsWith(root + '/') && folder !== root, 'MOCK_SESSION_DIRECTORY');
  mkdirSync(folder, { recursive: true });
  const storage = privateServerStorage(join(folder, 'data'), 64 * 1024 * 1024);
  // Additive W2 interface. Baseline lacks it; the dedicated integrated phase
  // requires and verifies the sidecar rather than silently qualifying its absence.
  storage.bindIdentity?.('PUBLIC_TESTNET', FIXTURE_IDENTITY);
  const scenario = releaseScenario(),
    fixture = tradingRpcFixture('NONE', scenario.options);
  let clock = now,
    fault = 'NONE',
    writable = true,
    app,
    auth,
    runtime,
    orders,
    backups,
    closed = false;
  const origin = 'https://release.mock.invalid';
  const headers = {
    host: 'release.mock.invalid',
    origin,
    'x-forwarded-proto': 'https',
    'x-alphaforge-client': '1',
  };
  const rpcRequests = [],
    walletRequests = [];
  const guard = async (name, fn) => {
    rpcRequests.push({ mode: 'MOCK', name, fault });
    if (fault === 'DISCONNECTED' || fault === 'TIMEOUT') throw new Error('MOCK_RPC_' + fault);
    return fn();
  };
  const rpc = {
    chainId: () => guard('chainId', () => (fault === 'CHAIN' ? 4663 : fixture.client.chainId())),
    block: (n) =>
      guard('block', async () => {
        const block = await fixture.client.block(n);
        return blockTimestamp === undefined ? block : { ...block, timestamp: BigInt(blockTimestamp) };
      }),
    code: (a, b) => guard('code', () => fixture.client.code(a, b)),
    receipt: (h) => guard('receipt', () => fixture.client.receipt(h)),
    transaction: (h) => guard('transaction', () => fixture.client.transaction(h)),
    logs: (f) => guard('logs', () => fixture.client.logs(f)),
    call: (request, block) =>
      guard('call', async () => {
        if (
          request.data.slice(0, 10) === feedInterface.getFunction('price').selector &&
          referenceObservedAt[request.to] !== undefined
        )
          return asHexData(
            feedInterface.encodeFunctionResult('price', [
              100000000n,
              BigInt(referenceObservedAt[request.to]),
              '0x' + 'ab'.repeat(32),
            ]),
          );
        if (fault === 'STALE' && request.data.slice(0, 10) === feedInterface.getFunction('price').selector)
          return asHexData(
            feedInterface.encodeFunctionResult('price', [100000000n, 960n, '0x' + 'ab'.repeat(32)]),
          );
        return fixture.client.call(request, block);
      }),
  };
  async function open() {
    auth = new WalletAuthStore(storage.databasePath('auth'), origin, {
      challengeTtlMs: 60000,
      sessionTtlMs: 3600000,
      maxRows: 1000,
    });
    runtime = new TradingChainRuntime({
      dbPath: storage.databasePath('chain'),
      evidencePath: storage.databasePath('evidence'),
      manifest: fixture.manifest,
      inventory: fixture.inventory,
      rpc,
      now: () => clock,
    });
    orders = new OrderJournal(storage.databasePath('orders'), FIXTURE_IDENTITY);
    backups = new ServerBackups(storage, FIXTURE_IDENTITY, [
      { name: 'chain', db: runtime.store.db },
      { name: 'evidence', db: runtime.evidence.db, evidenceIdentity: runtime.evidence.identity },
      { name: 'orders', db: orders.db },
    ]);
    await runtime.syncToHead();
    app = await buildPublicTestnetApp({
      origin,
      auth,
      now: () => clock,
      ...(runtimeStatus ? { runtimeStatus } : {}),
      ...(executionStatus ? { executionStatus } : {}),
      verifyOwner: async (message, signature, owner) => signature === mockSignature(message, owner),
      runtimes: [{ id: 'mock-owner-a', runtime }],
      canWrite: () => writable,
      ...(webRoot ? { webRoot } : {}),
      backup: async () => {
        const release = runtime.pauseWrites();
        try {
          return await backups.create(clock, 'MANUAL');
        } finally {
          release();
        }
      },
      backupStatus: () => backups.status(),
    });
  }
  try {
    await open();
  } catch (error) {
    auth?.close();
    await runtime?.close();
    orders?.close();
    storage.close();
    throw error;
  }
  if (existsSync(join(folder, 'fixture.json'))) {
    const retained = JSON.parse(readFileSync(join(folder, 'fixture.json')));
    assert.equal(retained.mode, 'MOCK');
    assert.equal(retained.identity, FIXTURE_IDENTITY);
  } else
    writeFileSync(
      join(folder, 'fixture.json'),
      JSON.stringify(
        {
          mode: 'MOCK',
          identity: FIXTURE_IDENTITY,
          origin,
          clock,
          ownerA: OWNER_A,
          ownerB: OWNER_B,
          manifest: fixture.manifest,
          inventory: fixture.inventory,
          noRealSigner: true,
          broadcastTransport: false,
          sharedD1: false,
        },
        (_key, value) => (typeof value === 'bigint' ? String(value) : value),
        2,
      ) + '\n',
      { flag: 'wx' },
    );
  async function request(url, payload, cookie = '', override = {}) {
    const response = await app.inject({
      method: payload === undefined ? 'GET' : 'POST',
      url,
      headers: { ...headers, ...(cookie ? { cookie } : {}), ...override },
      ...(payload === undefined ? {} : { payload }),
    });
    let body;
    try {
      body = redact(response.json());
    } catch {
      body = { sha256: createHash('sha256').update(response.body).digest('hex') };
    }
    appendFileSync(
      join(folder, 'api.jsonl'),
      JSON.stringify({
        mode: 'MOCK',
        clock,
        method: payload === undefined ? 'GET' : 'POST',
        url,
        request: redact(payload ?? null),
        status: response.statusCode,
        response: body,
      }) + '\n',
    );
    return response;
  }
  async function login(owner) {
    const c = await request('/api/testnet/auth/challenge', { owner });
    assert.equal(c.statusCode, 200, c.body);
    const challenge = c.json();
    const response = await request('/api/testnet/auth/verify', {
      owner,
      nonce: challenge.nonce,
      signature: mockSignature(challenge.message, owner),
    });
    assert.equal(response.statusCode, 200, response.body);
    return String(response.headers['set-cookie']).split(';')[0];
  }
  return {
    mode: 'MOCK',
    directory: folder,
    origin,
    headers,
    fixture: scenario.options,
    scenario,
    rpc,
    rpcRequests,
    walletRequests,
    executor: address(40),
    storage,
    broadcasts: 0,
    get now() {
      return clock;
    },
    get app() {
      return app;
    },
    get auth() {
      return auth;
    },
    get runtime() {
      return runtime;
    },
    get orders() {
      return orders;
    },
    get backups() {
      return backups;
    },
    request,
    login,
    advance(ms) {
      assert.ok(Number.isSafeInteger(ms) && ms >= 0);
      clock += ms;
    },
    setWritable(value) {
      writable = value;
    },
    setFault(value) {
      assert.ok(['NONE', 'DISCONNECTED', 'TIMEOUT', 'CHAIN', 'STALE'].includes(value));
      fault = value;
    },
    async restart() {
      await app.close();
      await runtime.close();
      orders.close();
      await open();
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await app.close();
        await runtime.close();
        orders.close();
      } finally {
        storage.close();
        writeFileSync(join(folder, 'rpc.json'), JSON.stringify(rpcRequests, null, 2) + '\n');
      }
    },
  };
}
