import assert from 'node:assert/strict';
import test from 'node:test';
import { deploymentCli, compiledArtifacts } from '../tools/testnet/deployment.ts';
import {
  parseDeploymentWorksheet,
  qualifyTradingArtifact,
  initialPoolSqrtPrice,
} from '../packages/testnet/src/deployment-plan.ts';
import { tradingAbi } from '../packages/testnet/src/trading-abi.ts';
import { tradingFixtureAddress as address } from './helpers/testnet-trading-rpc.ts';
test('deployment misuse and unfilled worksheet remain blocked without RPC, credentials or output', async () => {
  assert.equal(await deploymentCli(['--help']), 0);
  for (const args of [[], ['--broadcast'], ['--prepare', 'a', 'b', 'c', 'd', '--force']])
    assert.equal(await deploymentCli(args), 2);
  const w = {
    schemaVersion: 1,
    chainId: 46630,
    kind: 'UNSIGNED_TESTNET_DEPLOYMENT',
    deployer: address(1),
    creator: address(1),
    executor: address(40),
    keeper: address(40),
    nonce: 0,
    owners: [address(2)],
    strategyId: '0x' + 'ab'.repeat(32),
    strategyRef: '0x' + 'cd'.repeat(32),
    usdcSupply: '1000000000',
    passSupply: '1000000000000000000000',
    stockSupplies: ['1000000000000000000', '1000000000000000000', '1000000000000000000'],
    maxPriceAge: 30,
    weth: address(90),
    factoryV2: '0x' + '0'.repeat(40),
    positionManager: '0x' + '0'.repeat(40),
  };
  assert.equal(parseDeploymentWorksheet(w).owners[0], address(2));
  for (const changed of [
    { chainId: 4663 },
    { owners: [address(40)] },
    { passSupply: '1000000000001' },
    { weth: '' },
    { nonce: -1 },
    { owners: [address(2), address(2)] },
  ])
    assert.throws(() => parseDeploymentWorksheet({ ...w, ...changed }));
  const a = { abi: tradingAbi, bytecode: '0x6000', runtimeBytes: 24074, sha256: 'ab'.repeat(32) };
  qualifyTradingArtifact(a);
  assert.throws(() => qualifyTradingArtifact({ ...a, runtimeBytes: 24577 }), /CODE_SIZE/);
  assert.throws(
    () => qualifyTradingArtifact({ ...a, abi: tradingAbi.filter((v) => !v.startsWith('function execute')) }),
    /ABI/,
  );
});
test('six/eighteen decimal pool initialization respects canonical token ordering without float arithmetic', () => {
  assert.equal(initialPoolSqrtPrice(address(3), address(10), '100000000'), String((1n << 96n) * 100000n));
  assert.equal(initialPoolSqrtPrice(address(10), address(3), '100000000'), String((1n << 96n) / 100000n));
  assert.throws(() => initialPoolSqrtPrice(address(3), address(3), '100000000'), /POOL_PRICE/);
});
test('compiled trading ABI qualification requires actual artifacts when available; never substitutes mock bytecode', (t) => {
  // Developer contract preparation gate supplies these; generic Node-only CI reports NOT_RUN.
  const root = process.cwd();
  let artifacts;
  try {
    artifacts = compiledArtifacts(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      t.skip('NOT_RUN: qualified contract artifacts unavailable');
      return;
    }
    throw error;
  }
  qualifyTradingArtifact(artifacts.AlphaForgeTradingVault!);
});
