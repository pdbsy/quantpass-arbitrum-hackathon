import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { checkEnvironment } from '../deploy/container/boundary.mjs';
test('actual rendered Compose environment admits exact watch/RPC/descriptor paths and rejects activation/injection', () => {
  const r = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AF_PUBLIC_CONFIG_DIR: '/tmp/af-public',
      AF_EXECUTOR_CONFIG_DIR: '/tmp/af-executor',
      AF_TLS_DIR: '/tmp/af-tls',
      AF_PUBLIC_RPC_FILE: '/tmp/af-public-rpc',
      AF_EXECUTOR_RPC_FILE: '/tmp/af-executor-rpc',
      AF_RELEASE_IDENTITY_FILE: '/etc/alphaforge/public/release-identity.json',
      AF_TEST_RESULTS_FILE: '/etc/alphaforge/public/test-results.json',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const config = JSON.parse(r.stdout),
    env = config.services.application.environment;
  assert.equal(Object.keys(config.services).length, 1);
  assert.equal(Object.keys(config.volumes).length, 1);
  assert.equal(config.services.application.build.target, 'runtime');
  assert.doesNotThrow(() => checkEnvironment(env));
  for (const changed of [
    { AF_CONTAINER_MODE: 'run-testnet' },
    { AF_TESTNET_EXECUTION_ACK: 'I_AUTHORIZE_TESTNET_SIGNING_46630' },
    { AF_EXECUTOR_NONCE_DIRECTORY: '/var/lib/alphaforge/executor/nonces' },
    { AF_EXECUTOR_RPC_FILE: '/tmp/wrong' },
    { AF_RELEASE_IDENTITY_FILE: '/tmp/forged.json' },
    { AF_TEST_RESULTS_FILE: '/tmp/forged.json' },
    { NODE_EXTRA_CA_CERTS: '/tmp/ca' },
    { HTTPS_PROXY: 'https://proxy.invalid' },
  ])
    assert.throws(() => checkEnvironment({ ...env, ...changed }));
});
