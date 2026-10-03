import { createHash } from 'node:crypto';
import { tradingInterface } from '../../../packages/testnet/src/trading-abi.ts';
import { tradingFixtureAddress as address } from '../../helpers/testnet-trading-rpc.ts';

export const OWNER_A = address(1);
export const OWNER_B = address(99);
export const FIXTURE_IDENTITY =
  '0x' + createHash('sha256').update('AlphaForge release MOCK v1').digest('hex');
export const canonicalHash = (n) =>
  n === 16 ? '0x' + 'ab'.repeat(32) : '0x' + n.toString(16).padStart(64, '0');

// Historical deposit/allocation/three actual ABI fill events reconcile the existing
// RPC fixture's measured cash and positions. None of these are external receipts.
export function releaseScenario() {
  const options = {
    historical: true,
    head: 16,
    logs: [],
    transaction: null,
    receipt: null,
    hashAt: canonicalHash,
  };
  function event(name, args, block = 16) {
    const encoded = tradingInterface.encodeEventLog(tradingInterface.getEvent(name), args);
    const index = options.logs.length;
    const log = {
      address: address(50),
      blockNumber: '0x' + block.toString(16),
      blockHash: options.hashAt(block),
      transactionHash: '0x' + String(index + 1).padStart(64, '0'),
      transactionIndex: '0x' + index.toString(16),
      logIndex: '0x' + index.toString(16),
      data: encoded.data,
      topics: encoded.topics,
      removed: false,
    };
    options.logs.push(log);
    return log;
  }
  event('Deposited', [1000000000n, 1000000000n, 1000n * 10n ** 18n], 1);
  event('CapitalChanged', [true, 900000000n, 900n * 10n ** 18n, 1n], 2);
  for (let i = 0; i < 3; i++)
    event('SwapExecuted', [BigInt(i + 2), 1n, address(10 + i), true, 100000000n, 10n ** 18n]);
  return { options, event };
}
