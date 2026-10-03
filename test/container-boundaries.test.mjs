import test from 'node:test';
import assert from 'node:assert/strict';
import { servicePlan, checkEnvironment, proxyHeaders } from '../deploy/container/boundary.mjs';
const publicConfig = {
  chainId: 46630,
  profile: 'PUBLIC_TESTNET',
  origin: 'https://testnet.example.invalid',
  dataDirectory: '/var/lib/alphaforge/public',
  maxStorageBytes: 3500000000,
  vaults: [{ id: 'one' }],
};
const executor = {
  chainId: 46630,
  profile: 'RESTRICTED_TESTNET_EXECUTOR',
  dataDirectory: '/var/lib/alphaforge/executor',
  maxStorageBytes: 3500000000,
  vaults: [{ id: 'one' }],
};
test('operational package never turns credentials or restart into signing', () => {
  for (const variable of [
    'AF_TESTNET_EXECUTION_ACK',
    'AF_EXECUTOR_KEYSTORE_FILE',
    'NODE_OPTIONS',
    'HTTPS_PROXY',
    'NODE_EXTRA_CA_CERTS',
    'GITHUB_ACTIONS',
    'AF_EXECUTOR_NONCE_DIRECTORY',
  ])
    assert.throws(() => checkEnvironment({ [variable]: 'value' }));
  assert.doesNotThrow(() =>
    checkEnvironment({
      PATH: '/usr/local/bin:/usr/bin:/bin',
      AF_CONTAINER_MODE: 'watch',
      AF_PUBLIC_RPC_FILE: '/run/secrets/public-rpc',
      AF_EXECUTOR_RPC_FILE: '/run/secrets/executor-rpc',
    }),
  );
  assert.throws(() => checkEnvironment({ UV_USE_IO_URING: '1' }));
  assert.throws(() => checkEnvironment({ AF_RELEASE_IDENTITY_FILE: '/tmp/forged.json' }));
  assert.doesNotThrow(() =>
    checkEnvironment({
      AF_RELEASE_IDENTITY_FILE: '/etc/alphaforge/public/release-identity.json',
      AF_TEST_RESULTS_FILE: '/etc/alphaforge/public/test-results.json',
    }),
  );
  assert.deepEqual(servicePlan(publicConfig, executor).executor, [
    'tools/testnet/executor.ts',
    '--watch',
    '/etc/alphaforge/executor/operator.json',
  ]);
});
test('configuration binds storage, HTTPS, chain and deployed watch prerequisites', () => {
  for (const change of [
    { chainId: 1 },
    { dataDirectory: '/tmp/data' },
    { vaults: [] },
    { maxStorageBytes: 6000000000 },
    { origin: 'http://testnet.example.invalid' },
  ])
    assert.throws(() => servicePlan({ ...publicConfig, ...change }, executor));
  assert.throws(() => servicePlan(publicConfig, { ...executor, vaults: [] }));
  assert.throws(() =>
    servicePlan({ ...publicConfig, executorStatus: { file: '/tmp/private.json' } }, executor),
  );
  assert.equal(servicePlan(publicConfig, executor).origin, 'https://testnet.example.invalid');
});
test('TLS proxy rejects wrong host/origin and overwrites client supplied forwarding', () => {
  const origin = 'https://testnet.example.invalid';
  assert.throws(() => proxyHeaders({ host: 'evil.invalid' }, '127.0.0.1', origin));
  assert.throws(() =>
    proxyHeaders({ host: 'testnet.example.invalid', origin: 'https://evil.invalid' }, '127.0.0.1', origin),
  );
  const h = proxyHeaders(
    {
      host: 'testnet.example.invalid',
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'evil.invalid',
      'x-forwarded-for': 'evil',
      forwarded: 'evil',
      cookie: 'sid=one',
    },
    '192.0.2.1',
    origin,
  );
  assert.equal(h['x-forwarded-proto'], 'https');
  assert.equal(h['x-forwarded-for'], '192.0.2.1');
  assert.equal(h['x-forwarded-host'], undefined);
  assert.equal(h.forwarded, undefined);
  assert.equal(h.cookie, 'sid=one');
});
