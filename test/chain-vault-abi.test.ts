import test from 'node:test';
import assert from 'node:assert/strict';
import {
  M3_VAULT_REVIEW_ABI,
  decodeM3VaultAddressResult,
  decodeM3VaultBoolResult,
  decodeM3VaultBytes32Result,
  decodeM3VaultCalldata,
  decodeM3VaultEvent,
  decodeM3VaultUintResult,
  encodeM3VaultCall,
} from '../packages/chain-adapter/src/vault-abi.ts';
import {
  decodeM3StrategyPassEvent,
  M3_STRATEGY_PASS_TRANSFER_TOPIC,
} from '../packages/chain-adapter/src/pass-abi.ts';
import {
  asAddress,
  asBlockHash,
  asHexData,
  asTransactionHash,
  type HexData,
} from '../packages/chain-adapter/src/types.ts';

const CONTRACT = asAddress('0x2222222222222222222222222222222222222222');
const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const TOKEN = asAddress('0x3333333333333333333333333333333333333333');

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function addressTopic(value: string): HexData {
  return asHexData(`0x${value.slice(2).padStart(64, '0')}`);
}

function event(topic: HexData, indexed: readonly HexData[], values: readonly bigint[]) {
  return {
    address: CONTRACT,
    blockNumber: 7n,
    blockHash: asBlockHash(`0x${'aa'.repeat(32)}`),
    transactionHash: asTransactionHash(`0x${'bb'.repeat(32)}`),
    transactionIndex: 2,
    logIndex: 3,
    data: asHexData(`0x${values.map(word).join('')}`),
    topics: [topic, ...indexed],
    removed: false,
  };
}

test('compiled review ABI exposes the exact 25 function selectors and seven event topics', () => {
  assert.equal(M3_VAULT_REVIEW_ABI.handoffCommit, '8afb96e4671b2ace5e59c99617c79b4bdca5b627');
  assert.equal(M3_VAULT_REVIEW_ABI.implementationCommit, 'db620d68a635259f53f48c33defff4273237d372');
  assert.equal(
    M3_VAULT_REVIEW_ABI.publishedAbiSha256,
    '7be3e2be3897b634d47d3766f26b088994884a169fb8e39ffbd3b3cf2133669f',
  );
  assert.deepEqual(M3_VAULT_REVIEW_ABI.functionSelectors, {
    'afBtc()': '0xa8d937e9',
    'afEth()': '0xf20173bc',
    'afUsdc()': '0x8b5a851f',
    'close()': '0x43d726d6',
    'closed()': '0x597e1fb5',
    'deposit(uint256)': '0xb6b55f25',
    'openTrackedPositionCount()': '0x34dda870',
    'owner()': '0x8da5cb5b',
    'pass()': '0xa7a1ed72',
    'passLocker()': '0xab88dc4b',
    'passToUsdcRaw(uint256)': '0x18ba7fe2',
    'principalBasis()': '0xad587035',
    'realizedProfit()': '0x738b74f0',
    'rescueNative()': '0xfc82f084',
    'rescueUntrackedToken(address)': '0x45f5030f',
    'reservedTrackedBalance(address)': '0xc0bdb971',
    'strategyCreator()': '0x499bb2ab',
    'strategyId()': '0x492f4e18',
    'strategyRef()': '0xc288f3de',
    'trackedPosition(address)': '0xb31ede63',
    'trackedUsdcBalance()': '0x0510ca51',
    'untrackedExcess(address)': '0x21f38bbd',
    'usdcToPassRaw(uint256)': '0x643456f6',
    'withdraw(uint256)': '0x2e1a7d4d',
    'withdrawableUsdc()': '0x442ad6a0',
  });
  assert.deepEqual(M3_VAULT_REVIEW_ABI.eventTopics, {
    'Closed(address,uint256,uint256)': '0x792b1058d55c02122048f16ecbfdaab6be257e8c903a60a01f220960238aefc7',
    'Deposited(address,uint256,uint256,uint256,uint256)':
      '0xe3b53cd1a44fbf11535e145d80b8ef1ed6d57a73bf5daa7e939b6b01657d6549',
    'NativeRescued(address,uint256)': '0xe3eb98b7fe2a0c1d490b92af73eeae611e9b00ab3c3f70b20bd7bb43f67a0f43',
    'TrackedPositionChanged(address,uint256,uint256)':
      '0xc918adb5da6f1094bf877bef10e664cd7ca5fb1216d89f807c19cdf60e5f1c88',
    'TrackedUsdcBalanceChanged(uint256,uint256)':
      '0x29a4ed269a24b639ce9313072bca1d8d408f35f61108737792b18153b9c5b470',
    'UntrackedTokenRescued(address,address,uint256)':
      '0x204874061edf1b61f01e55eb957ff789bf733451c43d111f54ba6d84122b7160',
    'Withdrawn(address,uint256,uint256,uint256,uint256,uint256,uint256)':
      '0x6b4651e8f4162f82274a25e57a29f7ed9156d17078e76dd4d05f04ba08831aa4',
  });
});

test('core owner calldata uses exact selectors and roundtrips without accepting trailing words', () => {
  const deposited = encodeM3VaultCall('deposit(uint256)', [1_000_000n]);
  const withdrawn = encodeM3VaultCall('withdraw(uint256)', [500_000n]);
  const closed = encodeM3VaultCall('close()', []);
  assert.equal(deposited, `0xb6b55f25${word(1_000_000n)}`);
  assert.equal(withdrawn, `0x2e1a7d4d${word(500_000n)}`);
  assert.equal(closed, '0x43d726d6');
  assert.deepEqual(decodeM3VaultCalldata(deposited), { kind: 'DEPOSIT', usdcAmount: 1_000_000n });
  assert.deepEqual(decodeM3VaultCalldata(withdrawn), { kind: 'WITHDRAW', usdcAmount: 500_000n });
  assert.deepEqual(decodeM3VaultCalldata(closed), { kind: 'CLOSE' });
  assert.equal(decodeM3VaultCalldata(asHexData(`${closed}${word(0n)}`)), null);
  assert.equal(decodeM3VaultCalldata(asHexData('0x12345678')), null);
});

test('Vault ABI rejects invalid amounts, addresses, result words and malformed rescue calldata', () => {
  const overflow = 1n << 256n;
  for (const amount of [-1n, overflow, 1, '1'])
    assert.throws(() => encodeM3VaultCall('deposit(uint256)', [amount]), /INVALID_M3_VAULT_CALL/);
  assert.throws(() => encodeM3VaultCall('close()', [1n]), /INVALID_M3_VAULT_CALL/);
  assert.throws(() => encodeM3VaultCall('rescueUntrackedToken(address)', [1n]), /INVALID_M3_VAULT_CALL/);
  assert.equal(decodeM3VaultCalldata(asHexData(`0x45f5030f${'01'.padEnd(64, '0')}`)), null);
  for (const decode of [decodeM3VaultUintResult, decodeM3VaultAddressResult, decodeM3VaultBytes32Result])
    assert.throws(() => decode(asHexData('0x00') as never), /INVALID_M3_VAULT_CALL_RESULT/);
  assert.throws(
    () => decodeM3VaultAddressResult(asHexData(`0x${'01'.repeat(32)}`)),
    /INVALID_M3_VAULT_CALL_RESULT/,
  );
  assert.equal(decodeM3VaultBoolResult(asHexData(`0x${word(0n)}`)), false);
  assert.equal(decodeM3VaultBoolResult(asHexData(`0x${word(1n)}`)), true);
  assert.throws(() => decodeM3VaultBoolResult(asHexData(`0x${word(2n)}`)), /INVALID_M3_VAULT_CALL_RESULT/);
});

test('all seven compiled Vault events decode indexed addresses and uint256 values exactly', () => {
  const topics = M3_VAULT_REVIEW_ABI.eventTopics;
  const cases = [
    {
      log: event(
        topics['Deposited(address,uint256,uint256,uint256,uint256)'],
        [addressTopic(OWNER)],
        [1n, 2n, 3n, 4n],
      ),
      name: 'Deposited',
      data: { owner: OWNER, usdcAmount: '1', passRaw: '2', principalBasis: '3', trackedUsdcBalance: '4' },
    },
    {
      log: event(
        topics['Withdrawn(address,uint256,uint256,uint256,uint256,uint256,uint256)'],
        [addressTopic(OWNER)],
        [1n, 2n, 3n, 4n, 5n, 6n],
      ),
      name: 'Withdrawn',
      data: {
        owner: OWNER,
        usdcAmount: '1',
        profitAmount: '2',
        principalAmount: '3',
        passRawUnlocked: '4',
        principalBasis: '5',
        trackedUsdcBalance: '6',
      },
    },
    {
      log: event(topics['Closed(address,uint256,uint256)'], [addressTopic(OWNER)], [7n, 8n]),
      name: 'Closed',
      data: { owner: OWNER, usdcReturned: '7', passRawReleased: '8' },
    },
    {
      log: event(topics['TrackedUsdcBalanceChanged(uint256,uint256)'], [], [9n, 10n]),
      name: 'TrackedUsdcBalanceChanged',
      data: { previousBalance: '9', newBalance: '10' },
    },
    {
      log: event(
        topics['TrackedPositionChanged(address,uint256,uint256)'],
        [addressTopic(TOKEN)],
        [11n, 12n],
      ),
      name: 'TrackedPositionChanged',
      data: { token: TOKEN, previousAmount: '11', newAmount: '12' },
    },
    {
      log: event(
        topics['UntrackedTokenRescued(address,address,uint256)'],
        [addressTopic(TOKEN), addressTopic(OWNER)],
        [13n],
      ),
      name: 'UntrackedTokenRescued',
      data: { token: TOKEN, owner: OWNER, amount: '13' },
    },
    {
      log: event(topics['NativeRescued(address,uint256)'], [addressTopic(OWNER)], [14n]),
      name: 'NativeRescued',
      data: { owner: OWNER, amount: '14' },
    },
  ] as const;

  for (const fixture of cases) {
    const decoded = decodeM3VaultEvent(fixture.log);
    assert.equal(decoded?.eventName, fixture.name);
    assert.deepEqual(decoded?.normalizedData, fixture.data);
    assert.equal(decoded?.eventSignature, fixture.log.topics[0]);
  }
});

test('known event topics fail closed on malformed indexed or data words while unknown topics are ignored', () => {
  const deposited = M3_VAULT_REVIEW_ABI.eventTopics['Deposited(address,uint256,uint256,uint256,uint256)'];
  const valid = event(deposited, [addressTopic(OWNER)], [1n, 2n, 3n, 4n]);
  assert.throws(() => decodeM3VaultEvent({ ...valid, topics: [deposited] }), /INVALID_M3_VAULT_EVENT/);
  assert.throws(() => decodeM3VaultEvent({ ...valid, data: asHexData('0x00') }), /INVALID_M3_VAULT_EVENT/);
  assert.throws(
    () => decodeM3VaultEvent({ ...valid, topics: [deposited, asHexData(`0x01${'00'.repeat(31)}`)] }),
    /INVALID_M3_VAULT_EVENT/,
  );
  assert.equal(decodeM3VaultEvent({ ...valid, topics: [asHexData(`0x${'ff'.repeat(32)}`)] }), null);
  assert.equal(decodeM3VaultEvent({ ...valid, topics: [] }), null);
});

test('StrategyPass transfer codec preserves every 18-decimal raw unit and rejects unsafe targets', async () => {
  const adapter = (await import('../packages/chain-adapter/src/index.ts')) as Record<string, unknown>;
  assert.equal(typeof adapter.encodeM3StrategyPassTransfer, 'function');
  assert.equal(typeof adapter.decodeM3StrategyPassCalldata, 'function');
  const encode = adapter.encodeM3StrategyPassTransfer as (recipient: string, amountRaw: bigint) => string;
  const decode = adapter.decodeM3StrategyPassCalldata as (
    data: string,
  ) => { kind: string; recipient: string; amountRaw: bigint } | null;
  const recipient = asAddress('0x9999999999999999999999999999999999999999');
  const calldata = encode(recipient, 1n);
  assert.equal(calldata.slice(0, 10), '0xa9059cbb');
  assert.deepEqual(decode(calldata), { kind: 'TRANSFER', recipient, amountRaw: 1n });
  assert.throws(() => encode(asAddress(`0x${'00'.repeat(20)}`), 1n), /INVALID_M3_PASS_TRANSFER/);
  assert.throws(() => encode(recipient, 0n), /INVALID_M3_PASS_TRANSFER/);
  assert.throws(() => encode(recipient, 1n << 256n), /INVALID_M3_PASS_TRANSFER/);
  assert.throws(() => encode(recipient, 1 as never), /INVALID_M3_PASS_TRANSFER/);
  assert.equal(decode(`${calldata}00`), null);
  assert.equal(decode(`0xa9059cbb${'01'.padEnd(64, '0')}${word(1n)}`), null);
  assert.equal(decode(`0xa9059cbb${'0'.repeat(64)}${word(1n)}`), null);
  assert.equal(decode(`0xa9059cbb${recipient.slice(2).padStart(64, '0')}${word(0n)}`), null);
});

test('StrategyPass event decoder accepts one exact Transfer and rejects malformed evidence', () => {
  const valid = event(M3_STRATEGY_PASS_TRANSFER_TOPIC, [addressTopic(OWNER), addressTopic(TOKEN)], [1n]);
  assert.deepEqual(decodeM3StrategyPassEvent(valid), {
    eventSignature: M3_STRATEGY_PASS_TRANSFER_TOPIC,
    eventName: 'Transfer',
    normalizedData: { from: OWNER, to: TOKEN, amountRaw: '1' },
  });
  assert.equal(decodeM3StrategyPassEvent({ ...valid, topics: [asHexData(`0x${'ff'.repeat(32)}`)] }), null);
  assert.throws(
    () => decodeM3StrategyPassEvent({ ...valid, topics: [M3_STRATEGY_PASS_TRANSFER_TOPIC] }),
    /INVALID_M3_PASS_EVENT/,
  );
  assert.throws(
    () =>
      decodeM3StrategyPassEvent({
        ...valid,
        topics: [M3_STRATEGY_PASS_TRANSFER_TOPIC, asHexData(`0x${'11'.repeat(32)}`), addressTopic(TOKEN)],
      }),
    /INVALID_M3_PASS_EVENT/,
  );
  assert.throws(
    () => decodeM3StrategyPassEvent({ ...valid, data: asHexData('0x00') }),
    /INVALID_M3_PASS_EVENT/,
  );
});
