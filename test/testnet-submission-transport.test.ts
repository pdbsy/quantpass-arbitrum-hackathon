import assert from 'node:assert/strict';
import test from 'node:test';
import { testnetSubmissionTransport } from '../packages/testnet/src/submission-transport.ts';
test('submission has no RPC fallback, redirects or retries; unknown send responses retain one HTTP attempt', async () => {
  let sends = 0;
  const transport = async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    assert.equal(init!.redirect, 'error');
    assert.ok(init!.signal);
    const request = JSON.parse(String(init!.body));
    if (request.method === 'eth_sendRawTransaction') {
      sends++;
      throw new Error('FIXTURE_RESPONSE_LOST');
    }
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: request.method === 'eth_chainId' ? '0xb626' : '0x7',
      }),
    );
  };
  const rpc = testnetSubmissionTransport('https://fixture.invalid', transport);
  assert.equal(await rpc.chainId(), 46630);
  assert.equal(await rpc.nonce('0x' + '1'.repeat(40), 'pending'), 7);
  await assert.rejects(rpc.send('0x1234'), /FIXTURE_RESPONSE_LOST/);
  assert.equal(sends, 1);
  assert.throws(() => testnetSubmissionTransport('http://fixture.invalid'), /ENDPOINT/);
  const wrong = testnetSubmissionTransport(
    'https://fixture.invalid',
    async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1237' })),
  );
  await assert.rejects(wrong.chainId(), /CHAIN/);
});
