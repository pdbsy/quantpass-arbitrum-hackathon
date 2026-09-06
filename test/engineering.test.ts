import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../packages/config/src/index.ts';

test('configuration accepts only an explicitly selected local mock environment', () => {
  const config = readConfig({ QP_MODE: 'local', QP_ADAPTER: 'mock' });
  assert.deepEqual(config, { mode: 'local', adapter: 'mock', realFundsEnabled: false });
  assert.ok(Object.isFrozen(config));
});

test('missing configuration and production/testnet paths fail closed', () => {
  for (const env of [
    {},
    { QP_MODE: 'local' },
    { QP_MODE: 'production', QP_ADAPTER: 'mock' },
    { QP_MODE: 'production', QP_ADAPTER: 'real', QP_APPROVED: 'true' },
    { QP_MODE: 'testnet', QP_ADAPTER: 'mock' },
    { QP_MODE: 'local', QP_ADAPTER: 'real' },
    { QP_MODE: 'local', QP_ADAPTER: 'mock', NODE_ENV: 'production' },
  ])
    assert.throws(() => readConfig(env));
});
