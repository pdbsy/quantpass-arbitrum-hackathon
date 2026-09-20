import test from 'node:test';
import assert from 'node:assert/strict';
import { readM3VaultLiveSnapshot } from '../apps/web/src/m3-vault-live-reader.ts';
import { asAddress } from '../packages/chain-adapter/src/types.ts';
import type { Eip1193Request } from '../apps/web/src/chain-wallet.ts';

const address = (digit: string) => asAddress(`0x${digit.repeat(40)}`);
const VAULT = address('2');
const OWNER = address('1');
const PASS = address('4');
const HASH = `0x${'aa'.repeat(32)}`;
const STRATEGY = `0x${'11'.repeat(32)}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;
const addressWord = (value: string) => `0x${value.slice(2).padStart(64, '0')}`;

class Provider {
  chain = '0xb626';
  changeChain = false;
  reorg = false;
  malformed = false;
  wrongStrategy = false;
  calls: Eip1193Request[] = [];
  chainReads = 0;
  blockReads = 0;
  on() {}
  removeListener() {}
  async request(input: Eip1193Request): Promise<unknown> {
    this.calls.push(input);
    if (input.method === 'eth_chainId') {
      this.chainReads++;
      return this.changeChain && this.chainReads > 1 ? '0x1' : this.chain;
    }
    if (input.method === 'eth_getBlockByNumber') {
      this.blockReads++;
      assert.deepEqual(input.params, [this.blockReads === 1 ? 'latest' : '0x64', false]);
      return { number: '0x64', hash: this.reorg && this.blockReads > 1 ? `0x${'bb'.repeat(32)}` : HASH };
    }
    assert.equal(input.method, 'eth_call');
    const [call, reference] = input.params as [{ to: string; data: string }, unknown];
    assert.deepEqual(reference, { blockHash: HASH, requireCanonical: true });
    if (call.to === PASS) {
      assert.equal(call.data, '0x492f4e18');
      return this.wrongStrategy ? `0x${'33'.repeat(32)}` : STRATEGY;
    }
    assert.equal(call.to, VAULT);
    const values: Record<string, string> = {
      '0x8da5cb5b': addressWord(OWNER),
      '0x499bb2ab': addressWord(address('3')),
      '0x492f4e18': STRATEGY,
      '0xc288f3de': `0x${'22'.repeat(32)}`,
      '0xa7a1ed72': addressWord(PASS),
      '0x8b5a851f': addressWord(address('5')),
      '0xf20173bc': addressWord(address('6')),
      '0xa8d937e9': addressWord(address('7')),
      '0xab88dc4b': addressWord(address('8')),
      '0xad587035': this.malformed ? '0x01' : word(1_000_001n),
      '0x0510ca51': word(1_500_001n),
      '0x738b74f0': word(500_000n),
      '0x442ad6a0': word(1_500_001n),
      '0x34dda870': word(0n),
      '0x597e1fb5': word(0n),
      [`0xb31ede63${addressWord(address('6')).slice(2)}`]: word(0n),
      [`0xb31ede63${addressWord(address('7')).slice(2)}`]: word(0n),
    };
    assert.ok(Object.hasOwn(values, call.data), call.data);
    return values[call.data];
  }
}
const options = { chainId: 46_630 as const, vaultAddress: VAULT };

test('live Vault reads use one canonical block and exact integers without any indexer or wallet identity', async () => {
  const provider = new Provider();
  const snapshot = await readM3VaultLiveSnapshot(provider, options);
  assert.equal(snapshot.owner, OWNER);
  assert.equal(snapshot.state.owner, OWNER);
  assert.equal(snapshot.state.principalBasis, '1000001');
  assert.equal(snapshot.state.trackedUsdcBalance, '1500001');
  assert.equal(snapshot.state.passStrategyId, STRATEGY);
  assert.equal(snapshot.blockNumber, '100');
  assert.equal(snapshot.blockHash, HASH);
  assert.equal(snapshot.state.closed, false);
  assert.equal(provider.calls.filter((entry) => entry.method === 'eth_call').length, 18);
  assert.ok(
    provider.calls.every((entry) =>
      ['eth_chainId', 'eth_call', 'eth_getBlockByNumber'].includes(entry.method),
    ),
  );
});

test('live reads reject wrong network initially and network changes during the snapshot', async () => {
  const wrong = new Provider();
  wrong.chain = '0x1';
  await assert.rejects(readM3VaultLiveSnapshot(wrong, options), /M3_LIVE_WRONG_CHAIN/);
  assert.equal(wrong.calls.length, 1);
  const changed = new Provider();
  changed.changeChain = true;
  await assert.rejects(readM3VaultLiveSnapshot(changed, options), /M3_LIVE_WRONG_CHAIN/);
});

test('live reads reject a reorg during collection rather than publishing a mixed snapshot', async () => {
  const provider = new Provider();
  provider.reorg = true;
  await assert.rejects(readM3VaultLiveSnapshot(provider, options), /M3_LIVE_CANONICAL_CHANGED/);
});

test('malformed ABI values and mismatched Pass strategy cannot become current Vault rights', async () => {
  for (const setting of ['malformed', 'wrongStrategy'] as const) {
    const provider = new Provider();
    provider[setting] = true;
    await assert.rejects(readM3VaultLiveSnapshot(provider, options), /M3_LIVE_READ_FAILED/);
  }
});

test('provider errors are reported as sanitized connectivity failures and never use a fallback projection', async () => {
  const provider = new Provider();
  provider.request = () => Promise.reject(new Error('untrusted provider detail'));
  await assert.rejects(readM3VaultLiveSnapshot(provider, options), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'M3_LIVE_READ_FAILED');
    return true;
  });
});

test('live reads reject malformed quantities, block identities and deployment options', async () => {
  for (const chain of ['not-hex', '0x01']) {
    const provider = new Provider();
    provider.chain = chain;
    await assert.rejects(readM3VaultLiveSnapshot(provider, options), /M3_LIVE_READ_FAILED/);
  }
  const zeroChain = new Provider();
  zeroChain.chain = '0x0';
  await assert.rejects(readM3VaultLiveSnapshot(zeroChain, options), /M3_LIVE_WRONG_CHAIN/);

  const malformedBlock = new Provider();
  const request = malformedBlock.request.bind(malformedBlock);
  malformedBlock.request = (input) =>
    input.method === 'eth_getBlockByNumber' ? Promise.resolve(null) : request(input);
  await assert.rejects(readM3VaultLiveSnapshot(malformedBlock, options), /M3_LIVE_READ_FAILED/);

  await assert.rejects(
    readM3VaultLiveSnapshot(new Provider(), { ...options, chainId: 1 as 46_630 }),
    /M3_LIVE_READ_FAILED/,
  );
  await assert.rejects(
    readM3VaultLiveSnapshot(new Provider(), {
      ...options,
      vaultAddress: asAddress('0x0000000000000000000000000000000000000000'),
    }),
    /M3_LIVE_READ_FAILED/,
  );
});
