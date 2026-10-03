import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createReleaseSession, OWNER_A, OWNER_B } from '../tools/testing/alphaforge-release-mock/session.mjs';
import { digest } from '../tools/testing/alphaforge-release-mock/evidence.mjs';
import { FIXTURE_IDENTITY, canonicalHash } from './fixtures/release-mock/scenario.mjs';
import { privateServerStorage } from '../packages/testnet/src/private-storage.ts';
import { OrderJournal } from '../packages/testnet/src/order-journal.ts';
import { verifyServerBackup } from '../packages/testnet/src/server-backups.ts';

// These are required integrated W2 interfaces. A pinned pre-W2 source cannot
// qualify them; the collector records this phase NOT_RUN until they exist.
const { claimNonceOwnership } = await import('../packages/testnet/src/nonce-ownership.ts');
const { testnetNetworkIdentity } = await import('../packages/testnet/src/network-identity.ts');
const { syncPublicRuntimes } = await import('../apps/server/src/testnet-startup.ts');

async function withSession(run, options = {}) {
  const s = await createReleaseSession({ now: 1000000, ...options });
  try {
    await run(s);
  } finally {
    await s.close();
  }
}
const rpcRequest = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });
const source = {
  schemaVersion: 1,
  sourceCommit: '1'.repeat(40),
  sourceTree: '2'.repeat(40),
  lockSha256: '3'.repeat(64),
  releaseDigest: '0x' + '4'.repeat(64),
};
const runtimeStatus = {
  configurationDigest: FIXTURE_IDENTITY,
  networkDigest: FIXTURE_IDENTITY,
  releaseIdentity: source,
  archivedTestResults: {
    schemaVersion: 1,
    sourceCommit: '5'.repeat(40),
    observedAt: 900000,
    tests: 10,
    pass: 7,
    fail: 1,
    skipped: 2,
    rawLogSha256: '6'.repeat(64),
  },
};

test('integrated status, readiness and archive authenticate each request and isolate/sanitize owner views', async () =>
  withSession(
    async (s) => {
      const a = await s.login(OWNER_A),
        b = await s.login(OWNER_B);
      for (const name of ['status', 'readiness', 'test-results']) {
        const path = '/api/testnet/' + name;
        assert.equal((await s.request(path)).statusCode, 401);
        assert.equal(
          (await s.request(path, undefined, '', { authorization: 'Bearer ' + a.split('=')[1] })).statusCode,
          401,
        );
        assert.equal((await s.request(path, undefined, a)).statusCode, 200);
      }
      const status = (await s.request('/api/testnet/status', undefined, a)).json();
      assert.equal(status.process, 'RUNNING');
      assert.equal(status.signingEnabled, false);
      assert.equal(status.vaults.length, 1);
      assert.equal(status.vaults[0].chain.state, 'CANONICAL_SNAPSHOT_QUALIFIED');
      assert.equal((await s.request('/api/testnet/status', undefined, b)).json().vaults.length, 0);
      assert.equal(status.provenance.releaseIdentityVerification, 'OPERATOR_SUPPLIED_DESCRIPTOR');
      assert.equal(status.mainnet, 'DISABLED_UNCONFIGURED');
      assert.equal(JSON.stringify(status).includes(OWNER_B), false);
      assert.equal(JSON.stringify(status).includes('SENTINEL_DO_NOT_PROJECT'), false);
      assert.equal(JSON.stringify(status).includes('https://fixture.invalid'), false);
      assert.equal(JSON.stringify(status).includes(s.directory), false);
      assert.equal('lastBackupId' in status.backups, false);
      const readiness = (await s.request('/api/testnet/readiness', undefined, a)).json();
      assert.equal(readiness.state, 'BLOCKED_FOR_PERSISTENT_TESTNET');
      assert.equal(readiness.heartbeatProves, 'PROCESS_LIVENESS_ONLY');
      assert.equal(readiness.externalChainAcceptance, 'NOT_RUN');
      assert.equal(readiness.sustainedWindow, 'NOT_RUN');
      const archive = (await s.request('/api/testnet/test-results', undefined, a)).json();
      assert.equal(archive.liveTestExecution, false);
      assert.equal(archive.provenance.kind, 'RECORDED_TEST_SNAPSHOT');
      assert.equal(archive.provenance.verification, 'OPERATOR_SUPPLIED_ARCHIVE');
      assert.equal(archive.provenance.sourceCommit, '5'.repeat(40));
      assert.equal(archive.provenance.ageMs, 100000);
      assert.deepEqual(archive.results, { tests: 10, pass: 7, fail: 1, skipped: 2 });
      await s.request('/api/testnet/auth/logout', {}, a);
      assert.equal((await s.request('/api/testnet/status', undefined, a)).statusCode, 401);
    },
    {
      runtimeStatus,
      executionStatus: () => ({
        state: 'READY',
        signingEnabled: false,
        observedAt: 1000000,
        extra: 'SENTINEL_DO_NOT_PROJECT',
        rpcUrl: 'https://fixture.invalid',
        owner: OWNER_B,
      }),
    },
  ));

test('stateless MCP compatibility remains authenticated/read-only during storage pause and bearer expiry', async () =>
  withSession(
    async (s) => {
      const a = await s.login(OWNER_A),
        b = await s.login(OWNER_B);
      const path = '/api/testnet/mcp';
      assert.equal((await s.request(path, rpcRequest('tools/list'))).statusCode, 401);
      assert.equal(
        (await s.request(path, rpcRequest('initialize', { protocolVersion: '2025-06-18' }), a)).json().result
          .protocolVersion,
        '2025-06-18',
      );
      assert.equal(
        (await s.request(path, { jsonrpc: '2.0', method: 'notifications/initialized' }, a)).statusCode,
        202,
      );
      const tools = (await s.request(path, rpcRequest('tools/list'), a)).json().result.tools;
      assert.deepEqual(
        tools.map((tool) => tool.name),
        ['alphaforge_status', 'alphaforge_test_results', 'alphaforge_readiness'],
      );
      assert.ok(tools.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
      const before = s.orders.db.prepare('SELECT count(*) AS n FROM orders').get().n;
      s.setWritable(false);
      for (const tool of tools) {
        const response = await s.request(
          path,
          rpcRequest('tools/call', { name: tool.name, arguments: {} }),
          a,
        );
        assert.equal(response.statusCode, 200);
        assert.equal(response.json().result.isError, false);
      }
      const bearer = { authorization: 'Bearer ' + a.split('=')[1] };
      assert.equal((await s.request(path, rpcRequest('tools/list'), '', bearer)).statusCode, 200);
      assert.equal(
        (
          await s.request(
            path,
            rpcRequest('tools/call', { name: 'alphaforge_status', arguments: { owner: OWNER_A } }),
            b,
          )
        ).json().error.code,
        -32602,
      );
      assert.equal(
        (
          await s.request(path, rpcRequest('tools/call', { name: 'broadcast_transaction', arguments: {} }), a)
        ).json().error.code,
        -32602,
      );
      assert.equal(
        (await s.request(path, rpcRequest('tools/call', { name: 'alphaforge_status' }), b)).json().result
          .structuredContent.vaults.length,
        0,
      );
      assert.equal(s.orders.db.prepare('SELECT count(*) AS n FROM orders').get().n, before);
      s.advance(3600001);
      assert.equal((await s.request(path, rpcRequest('tools/list'), '', bearer)).statusCode, 401);
      assert.equal(s.broadcasts, 0);
    },
    { runtimeStatus },
  ));

test('90-second projection deadline withholds cached publication and prepares until qualified resync', async () =>
  withSession(async (s) => {
    const cookie = await s.login(OWNER_A);
    s.advance(90000);
    assert.equal(s.runtime.ownedView(OWNER_A).status, 'HEALTHY');
    s.advance(1);
    assert.equal(s.runtime.ownedView(OWNER_A).status, 'STALE');
    assert.equal(s.runtime.ownedView(OWNER_A).snapshot, null);
    assert.equal(s.runtime.ownedView(OWNER_A).performance, null);
    assert.notEqual(
      (
        await s.request(
          '/api/testnet/vaults/mock-owner-a/prepare',
          { action: { kind: 'DEPOSIT', amountUsdc: '1' } },
          cookie,
        )
      ).statusCode,
      200,
    );
    await s.runtime.syncToHead();
    assert.equal(s.runtime.observation().observedAt, s.now);
    assert.equal(s.runtime.ownedView(OWNER_A).status, 'HEALTHY');
    assert.equal(
      (
        await s.request(
          '/api/testnet/vaults/mock-owner-a/prepare',
          { action: { kind: 'DEPOSIT', amountUsdc: '1' } },
          cookie,
        )
      ).statusCode,
      200,
    );
  }));

test('every successful Vault response atomically binds its own authenticated owner, including empty and null views', async () =>
  withSession(async (s) => {
    const a = await s.login(OWNER_A),
      b = await s.login(OWNER_B);
    const read = async (cookie) => {
      const response = await s.request('/api/testnet/vaults', undefined, cookie);
      assert.equal(response.statusCode, 200);
      return response.json();
    };
    const owned = await read(a),
      empty = await read(b);
    assert.equal(owned.owner, OWNER_A);
    assert.equal(owned.chainId, 46630);
    assert.ok(owned.vaults.every((vault) => vault.snapshot === null || vault.snapshot.owner === owned.owner));
    assert.equal(empty.owner, OWNER_B);
    assert.deepEqual(empty.vaults, []);
    s.setFault('DISCONNECTED');
    await assert.rejects(s.runtime.syncToHead());
    const degraded = await read(a);
    assert.equal(degraded.owner, OWNER_A);
    assert.equal(degraded.vaults[0].snapshot, null);
    assert.notEqual((await s.request('/api/testnet/vaults')).statusCode, 200);
  }));

test('30-second market deadline checks each asset even with a fresh process and canonical sync', async () => {
  await withSession(async (s) => {
    const cookie = await s.login(OWNER_A);
    assert.equal(
      (await s.request('/api/testnet/status', undefined, cookie)).json().vaults[0].marketData.state,
      'VALID',
    );
    s.advance(30001);
    await s.runtime.syncToHead();
    const view = (await s.request('/api/testnet/status', undefined, cookie)).json();
    assert.equal(view.process, 'RUNNING');
    assert.equal(view.vaults[0].chain.state, 'CANONICAL_SNAPSHOT_QUALIFIED');
    assert.equal(view.vaults[0].marketData.state, 'STALE_REFERENCE');
  });
  for (let i = 0; i < 3; i++)
    await withSession(
      async (s) => {
        const cookie = await s.login(OWNER_A);
        const stocks = s.runtime.ownedView(OWNER_A).snapshot.stocks;
        assert.equal(Number(stocks[i].observedAt), 969);
        assert.equal(stocks.filter((stock) => Number(stock.observedAt) === 1000).length, 2);
        assert.equal(
          (await s.request('/api/testnet/status', undefined, cookie)).json().vaults[0].marketData.state,
          'STALE_REFERENCE',
        );
      },
      { referenceObservedAt: { ['0x' + (20 + i).toString(16).padStart(40, '0')]: 969 } },
    );
});

test('a real isolated failing runtime cannot starve another runtime and recovery preserves both databases', async () => {
  const a = await createReleaseSession({ now: 1000000 }),
    b = await createReleaseSession({ now: 1000000, owner: OWNER_B });
  try {
    a.setFault('DISCONNECTED');
    b.advance(1000);
    await assert.rejects(
      syncPublicRuntimes([a.runtime, b.runtime], () => true),
      /SYNC_INCOMPLETE/,
    );
    assert.equal(a.runtime.status(), 'DEGRADED');
    assert.equal(b.runtime.observation().observedAt, b.now);
    assert.equal(b.runtime.ownedView(OWNER_B).status, 'HEALTHY');
    const cookie = await b.login(OWNER_B);
    const response = await b.request('/api/testnet/vaults', undefined, cookie);
    assert.equal(response.json().owner, OWNER_B);
    assert.equal(response.json().vaults[0].snapshot.owner, OWNER_B);
    a.setFault('NONE');
    await syncPublicRuntimes([a.runtime, b.runtime], () => true);
    assert.equal(a.runtime.ownedView(OWNER_A).status, 'HEALTHY');
    await assert.rejects(
      syncPublicRuntimes([a.runtime, b.runtime], () => false),
      /STORAGE_BLOCKED/,
    );
    assert.notEqual(a.storage.folder, b.storage.folder);
  } finally {
    await a.close();
    await b.close();
  }
});

test('full mock recovery includes namespace and nonce identity metadata alongside verified SQLite backup', async () =>
  withSession(async (s) => {
    const sidecar = join(s.storage.folder, 'network-identity.json');
    const sidecarBytes = readFileSync(sidecar);
    assert.throws(() => s.storage.bindIdentity('PUBLIC_TESTNET', '0x' + '7'.repeat(64)), /NAMESPACE/);
    assert.deepEqual(readFileSync(sidecar), sidecarBytes);
    const nonceRoot = join(s.directory, 'host-nonce');
    mkdirSync(nonceRoot, { mode: 0o700 });
    const lease = claimNonceOwnership(nonceRoot, [s.executor], s.namespaceDigest);
    try {
      assert.throws(() => claimNonceOwnership(nonceRoot, [s.executor], s.namespaceDigest), /LOCKED/);
    } finally {
      lease.close();
    }
    const nonceName = s.executor.slice(2) + '.identity.json';
    const nonceBytes = readFileSync(join(nonceRoot, nonceName));
    s.orders.prepare({
      id: 'integrated-unknown-order',
      chainId: 46630,
      owner: OWNER_A,
      executor: s.executor,
      vault: s.runtime.manifest.contractAddress,
      manifestDigest: s.runtime.manifest.manifestDigest,
      sourceDigest: FIXTURE_IDENTITY,
      grantVersion: '1',
      stateVersion: '4',
      snapshotHash: canonicalHash(16),
      calldata: '0x12345678',
      createdAt: 1000,
    });
    s.orders.reserve('integrated-unknown-order', '7');
    const cookie = await s.login(OWNER_A);
    const backup = await s.request('/api/testnet/backups', {}, cookie);
    assert.equal(backup.json().state, 'VERIFIED');
    const backupRoot = join(s.storage.folder, 'backups', backup.json().id);
    assert.equal((await verifyServerBackup(backupRoot, FIXTURE_IDENTITY)).state, 'VERIFIED');
    const restoreRoot = join(s.directory, 'full-restore');
    mkdirSync(restoreRoot, { mode: 0o700 });
    const restoredStorage = privateServerStorage(restoreRoot, 64 * 1024 * 1024);
    let restoredOrders;
    try {
      copyFileSync(sidecar, join(restoreRoot, 'network-identity.json'));
      chmodSync(join(restoreRoot, 'network-identity.json'), 0o600);
      restoredStorage.bindIdentity('PUBLIC_TESTNET', s.namespaceDigest);
      copyFileSync(join(backupRoot, 'orders.sqlite'), join(restoreRoot, 'orders.sqlite'));
      chmodSync(join(restoreRoot, 'orders.sqlite'), 0o600);
      restoredOrders = new OrderJournal(restoredStorage.databasePath('orders'), FIXTURE_IDENTITY);
      assert.equal(restoredOrders.blocked(s.executor), true);
      assert.equal(restoredOrders.get('integrated-unknown-order').nonce, '7');
      const restoredNonce = join(s.directory, 'restored-host-nonce');
      mkdirSync(restoredNonce, { mode: 0o700 });
      copyFileSync(join(nonceRoot, nonceName), join(restoredNonce, nonceName));
      chmodSync(join(restoredNonce, nonceName), 0o600);
      assert.equal(digest(readFileSync(join(restoreRoot, 'network-identity.json'))), digest(sidecarBytes));
      assert.equal(digest(readFileSync(join(restoredNonce, nonceName))), digest(nonceBytes));
      const restoredLease = claimNonceOwnership(restoredNonce, [s.executor], s.namespaceDigest);
      restoredLease.close();
      assert.throws(
        () => claimNonceOwnership(restoredNonce, [s.executor], '0x' + '8'.repeat(64)),
        /IDENTITY/,
      );
      writeFileSync(
        join(s.directory, 'restore-metadata.json'),
        JSON.stringify({
          mode: 'MOCK',
          namespaceSha256: digest(sidecarBytes),
          nonceIdentitySha256: digest(nonceBytes),
          databaseBackupVerified: true,
          operationalRelocationQualified: false,
        }) + '\n',
      );
    } finally {
      restoredOrders?.close();
      restoredStorage.close();
    }
    const dbOnlyRoot = join(s.directory, 'db-only-restore');
    mkdirSync(dbOnlyRoot, { mode: 0o700 });
    const dbOnly = privateServerStorage(dbOnlyRoot, 64 * 1024 * 1024);
    try {
      const file = join(dbOnlyRoot, 'orders.sqlite');
      copyFileSync(join(backupRoot, 'orders.sqlite'), file);
      chmodSync(file, 0o600);
      const bytes = readFileSync(file);
      assert.throws(() => dbOnly.bindIdentity('PUBLIC_TESTNET', s.namespaceDigest), /MIGRATION_REQUIRED/);
      assert.deepEqual(readFileSync(file), bytes);
    } finally {
      dbOnly.close();
    }
    assert.throws(
      () =>
        testnetNetworkIdentity({
          chainId: 1,
          profile: 'PUBLIC_TESTNET',
          configurationDigest: FIXTURE_IDENTITY,
          deployments: [],
        }),
      /NETWORK_IDENTITY/,
    );
    assert.equal(s.orders.blocked(s.executor), true);
  }));
