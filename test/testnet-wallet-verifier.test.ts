import assert from 'node:assert/strict';
import test from 'node:test';
import { hashMessage, Interface } from 'ethers';
import { JsonRpcClient } from '../packages/chain-adapter/src/rpc.ts';
import { createWalletVerifier } from '../packages/testnet/src/wallet-verifier.ts';
import { verifyWalletMessage } from '../packages/testnet/src/wallet-auth.ts';

// Existing public signature from https://docs.ethers.org/v5/api/signer/#Wallet (no key is imported).
const signature =
  '0x14280e5885a19f60e536de50097e96e3738c7acae4e9e62d67272d794b8127d31c03d9cd59781d4ee31fb4e1b893bd9b020ec67dfa65cfb51e2bdadbb1de26d91c';
const eoa = '0x71CB05EE1b1F506fF321Da3dac38f25c0c9ce6E1';
const contract = '0x1111111111111111111111111111111111111111';
const blockHash = '0x' + 'ab'.repeat(32);
test('existing public EIP-191 signature recovers only its owner and original message without signing', () => {
  assert.equal(verifyWalletMessage('Hello World', signature, eoa), true);
  assert.equal(verifyWalletMessage('Hello world', signature, eoa), false);
  assert.equal(verifyWalletMessage('Hello World', signature, contract), false);
});
function rpc(chain = 46630, magic = '0x1626ba7e' + '00'.repeat(28), reorg = false) {
  const methods: string[] = [];
  const client = new JsonRpcClient(['https://fixture.invalid'], {
    maxAttempts: 1,
    transport: async (_endpoint, request) => {
      methods.push(request.method);
      let result: unknown;
      switch (request.method) {
        case 'eth_chainId':
          result = '0x' + chain.toString(16);
          break;
        case 'eth_getBlockByNumber':
          result = {
            number: '0x10',
            hash:
              reorg && methods.filter((m) => m === 'eth_getBlockByNumber').length > 1
                ? '0x' + 'cd'.repeat(32)
                : blockHash,
            parentHash: '0x' + '12'.repeat(32),
            timestamp: '0x100',
          };
          break;
        case 'eth_getCode':
          assert.deepEqual(request.params, [contract, { blockHash, requireCanonical: true }]);
          result = '0x6000';
          break;
        case 'eth_call': {
          const call = request.params[0] as { to: string; data: string };
          assert.equal(call.to, contract);
          assert.ok(call.data.startsWith('0x1626ba7e'));
          const decoded = new Interface([
            'function isValidSignature(bytes32,bytes) view returns(bytes4)',
          ]).decodeFunctionData('isValidSignature', call.data);
          assert.equal(decoded[0], hashMessage('Testnet login'));
          assert.equal(decoded[1], signature);
          assert.deepEqual(request.params[1], { blockHash, requireCanonical: true });
          result = magic;
          break;
        }
        default:
          throw new Error('unapproved RPC method');
      }
      return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) };
    },
  });
  return { client, methods };
}
test('ERC-1271 verification uses only a checked Testnet canonical block and exact magic return', async () => {
  const f = rpc();
  assert.equal(await createWalletVerifier(f.client)('Testnet login', signature, contract), true);
  assert.deepEqual(f.methods, [
    'eth_chainId',
    'eth_getBlockByNumber',
    'eth_getCode',
    'eth_call',
    'eth_getBlockByNumber',
  ]);
  for (const invalid of [
    rpc(4663),
    rpc(46630, '0xffffffff' + '00'.repeat(28)),
    rpc(46630, '0x1626ba7e'),
    rpc(46630, undefined, true),
  ])
    assert.equal(await createWalletVerifier(invalid.client)('Testnet login', signature, contract), false);
});
test('an offline verifier permits EOAs and rejects unsupported contract login without transport fallback', async () => {
  const verify = createWalletVerifier();
  assert.equal(await verify('Hello World', signature, eoa), true);
  assert.equal(await verify('Hello World', signature, contract), false);
});
