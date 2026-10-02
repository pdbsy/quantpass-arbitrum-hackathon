import assert from 'node:assert/strict';
import test from 'node:test';
import { JsonRpcClient } from '../packages/chain-adapter/src/rpc.ts';
import { asTransactionHash } from '../packages/chain-adapter/src/types.ts';
const hash = asTransactionHash('0x' + 'ab'.repeat(32));
const transaction = {
  hash,
  chainId: '0xb626',
  from: '0x' + '11'.repeat(20),
  to: '0x' + '22'.repeat(20),
  input: '0x12345678',
  value: '0x0',
  nonce: '0x7',
  blockHash: '0x' + 'cd'.repeat(32),
  blockNumber: '0x10',
  transactionIndex: '0x0',
};
const rpc = (result: unknown) =>
  new JsonRpcClient(['https://fixture.invalid'], {
    maxAttempts: 1,
    transport: async (_endpoint, r) => {
      assert.equal(r.method, 'eth_getTransactionByHash');
      assert.deepEqual(r.params, [hash]);
      return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) };
    },
  });
test('read-only transaction lookup binds hash, chain, sender, calldata and canonical inclusion coordinates', async () => {
  const result = await rpc(transaction).transaction(hash);
  assert.ok(result);
  assert.equal(result.chainId, 46630);
  assert.equal(result.nonce, 7n);
  assert.equal(result.data, '0x12345678');
  assert.equal(await rpc(null).transaction(hash), null);
  for (const bad of [
    { ...transaction, hash: '0x' + 'ef'.repeat(32) },
    { ...transaction, input: 'bad' },
    { ...transaction, nonce: '0x00' },
    { ...transaction, blockHash: null },
    { ...transaction, chainId: '0x20000000000000' },
  ])
    await assert.rejects(rpc(bad).transaction(hash), /RPC_INVALID_RESPONSE/);
});
