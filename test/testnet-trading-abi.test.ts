import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers';
import { tradingInterface, quoterInterface } from '../packages/testnet/src/trading-abi.ts';
test('new trading ABI retains typed bounded execution and the upstream Quoter tuple order', () => {
  const data = tradingInterface.encodeFunctionData('execute', [
    ['0x' + '11'.repeat(20), '0x' + '22'.repeat(20), 10n, 9n, 123n, 4n],
  ]);
  const decoded = tradingInterface.decodeFunctionData('execute', data)[0];
  assert.equal(decoded.tokenIn, '0x' + '11'.repeat(20));
  assert.equal(decoded.deadline, 123n);
  assert.equal(decoded.expectedVersion, 4n);
  assert.equal(
    tradingInterface.getFunction('execute')?.format(),
    'execute((address,address,uint256,uint256,uint64,uint256))',
  );
  assert.equal(
    quoterInterface.getFunction('quoteExactInputSingle')?.format(),
    'quoteExactInputSingle((address,address,uint256,uint24,uint160))',
  );
  assert.equal(
    new Interface([
      'function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) returns(uint256)',
    ]).getFunction('exactInputSingle')?.selector,
    '0x04e45aaf',
  );
});
