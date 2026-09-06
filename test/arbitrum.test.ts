import test from 'node:test';
import assert from 'node:assert/strict';
import { ARBITRUM_SEPOLIA, readArbitrumConfig } from '../packages/arbitrum/src/network.ts';

const valid = {
  QP_CHAIN: 'arbitrum-sepolia',
  QP_CHAIN_ID: '421614',
  QP_RPC_URL: 'https://sepolia-rollup.arbitrum.io/rpc',
  QP_EXPLORER_URL: 'https://sepolia.arbiscan.io',
};

test('Arbitrum Sepolia constants match the competition target', () => {
  assert.deepEqual(ARBITRUM_SEPOLIA, {
    key: 'arbitrum-sepolia',
    name: 'Arbitrum Sepolia',
    chainId: 421_614,
    nativeCurrency: 'ETH',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    explorerUrl: 'https://sepolia.arbiscan.io',
  });
  assert.ok(Object.isFrozen(ARBITRUM_SEPOLIA));
});

test('Arbitrum config accepts explicit HTTPS testnet endpoints', () => {
  const config = readArbitrumConfig(valid);
  assert.equal(config.network.chainId, 421_614);
  assert.equal(config.rpcUrl, valid.QP_RPC_URL);
  assert.equal(config.explorerUrl, valid.QP_EXPLORER_URL);
  assert.ok(Object.isFrozen(config));
});

test('Arbitrum config rejects wrong networks, insecure URLs and embedded credentials', () => {
  for (const env of [
    {},
    { ...valid, QP_CHAIN: 'arbitrum-one' },
    { ...valid, QP_CHAIN_ID: '42161' },
    { ...valid, QP_RPC_URL: 'http://sepolia-rollup.arbitrum.io/rpc' },
    { ...valid, QP_RPC_URL: 'https://user:secret@example.com/rpc' },
    { ...valid, QP_EXPLORER_URL: 'not-a-url' },
  ]) {
    assert.throws(() => readArbitrumConfig(env));
  }
});
