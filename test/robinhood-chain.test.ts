import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROBINHOOD_CHAIN_TESTNET,
  readRobinhoodChainConfig,
} from '../packages/robinhood-chain/src/network.ts';

const valid = {
  QP_CHAIN: 'robinhood-chain-testnet',
  QP_CHAIN_ID: '46630',
  QP_RPC_URL: 'https://rpc.testnet.chain.robinhood.com',
  QP_EXPLORER_URL: 'https://explorer.testnet.chain.robinhood.com',
};

test('Robinhood Chain Testnet constants match the competition target', () => {
  assert.deepEqual(ROBINHOOD_CHAIN_TESTNET, {
    key: 'robinhood-chain-testnet',
    name: 'Robinhood Chain Testnet',
    chainId: 46_630,
    nativeCurrency: 'ETH',
    rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
    explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
  });
  assert.ok(Object.isFrozen(ROBINHOOD_CHAIN_TESTNET));
});

test('Robinhood Chain config accepts explicit HTTPS testnet endpoints', () => {
  const config = readRobinhoodChainConfig(valid);
  assert.equal(config.network.chainId, 46_630);
  assert.equal(config.rpcUrl, valid.QP_RPC_URL);
  assert.equal(config.explorerUrl, valid.QP_EXPLORER_URL);
  assert.ok(Object.isFrozen(config));
});

test('Robinhood Chain config rejects wrong networks, insecure URLs and embedded credentials', () => {
  for (const env of [
    {},
    { ...valid, QP_CHAIN: 'robinhood-chain-mainnet' },
    { ...valid, QP_CHAIN_ID: '4663' },
    { ...valid, QP_RPC_URL: 'http://rpc.testnet.chain.robinhood.com' },
    { ...valid, QP_RPC_URL: 'https://user:secret@example.com/rpc' },
    { ...valid, QP_EXPLORER_URL: 'not-a-url' },
  ]) {
    assert.throws(() => readRobinhoodChainConfig(env));
  }
});
