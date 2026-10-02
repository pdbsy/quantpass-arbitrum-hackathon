import assert from 'node:assert/strict';
import test from 'node:test';
import { TestnetWalletClient } from '../apps/web/src/testnet-wallet-client.ts';
import { WalletAuthStore } from '../packages/testnet/src/wallet-auth.ts';
const owner = '0x' + '11'.repeat(20),
  other = '0x' + '22'.repeat(20),
  vault = '0x' + '33'.repeat(20),
  pass = '0x' + '44'.repeat(20),
  usdc = '0x' + '55'.repeat(20);
const origin = 'https://test.alphaforge.example';
function challenge() {
  const store = new WalletAuthStore(':memory:', origin, {
    challengeTtlMs: 60000,
    sessionTtlMs: 60000,
    maxRows: 10,
  });
  try {
    return store.issue(owner, Date.now());
  } finally {
    store.close();
  }
}
test('wallet login verifies identity again; account or chain changes prevent an owner transaction request', async () => {
  let current = owner,
    chain = '0xb626';
  const calls: string[] = [];
  const provider = {
    request: async ({ method }: { method: string; params?: readonly unknown[] }) => {
      calls.push(method);
      if (['eth_requestAccounts', 'eth_accounts'].includes(method)) return [current];
      if (method === 'eth_chainId') return chain;
      if (method === 'personal_sign') return '0x' + '01'.repeat(65);
      throw new Error('unexpected wallet side effect');
    },
  };
  const api = async (path: string) =>
    path.endsWith('challenge') ? challenge() : path.endsWith('verify') ? { owner, chainId: 46630 } : {};
  const client = new TestnetWalletClient(provider, api, origin);
  await client.login();
  assert.equal(client.owner, owner);
  const identity = { owner, vault, pass, usdc, blockTimestamp: '1000' };
  current = other;
  await assert.rejects(client.assertOwner(identity), /WALLET_IDENTITY_CHANGED/);
  assert.equal(calls.includes('eth_sendTransaction'), false);
  current = owner;
  chain = '0x1237';
  await assert.rejects(client.assertOwner(identity), /WALLET_WRONG_CHAIN/);
  assert.equal(calls.includes('eth_sendTransaction'), false);
});
test('unsigned preview tampering cannot reach a wallet send or acquire authority from a login', async () => {
  let sends = 0;
  const provider = {
    request: async ({ method }: { method: string; params?: readonly unknown[] }) => {
      if (['eth_requestAccounts', 'eth_accounts'].includes(method)) return [owner];
      if (method === 'eth_chainId') return '0xb626';
      if (method === 'personal_sign') return '0x' + '01'.repeat(65);
      if (method === 'eth_sendTransaction') {
        ++sends;
        throw new Error('not approved in verification');
      }
      throw new Error();
    },
  };
  const api = async (path: string) =>
    path.endsWith('challenge') ? challenge() : path.endsWith('verify') ? { owner, chainId: 46630 } : {};
  const client = new TestnetWalletClient(provider, api, origin);
  await client.login();
  await assert.rejects(
    client.send(
      { owner, vault, pass, usdc, blockTimestamp: '1000' },
      { kind: 'STOP' },
      { from: owner, to: other, data: '0x43d726d6', value: '0x0', chainId: '0xb626', kind: 'STOP' },
    ),
    /WALLET_PREVIEW_MISMATCH/,
  );
  assert.equal(sends, 0);
});
test('a login prompt must bind the current HTTPS domain, chain, account, nonce and login-only statement', async () => {
  let signatures = 0;
  const provider = {
    request: async ({ method }: { method: string; params?: readonly unknown[] }) => {
      if (['eth_requestAccounts', 'eth_accounts'].includes(method)) return [owner];
      if (method === 'eth_chainId') return '0xb626';
      if (method === 'personal_sign') {
        ++signatures;
        throw new Error('unexpected prompt');
      }
      throw new Error();
    },
  };
  for (const mutate of [
    (v: ReturnType<typeof challenge>) => ({ ...v, message: 'Authorize all trades' }),
    (v: ReturnType<typeof challenge>) => ({
      ...v,
      message: v.message.replace('Chain ID: 46630', 'Chain ID: 4663'),
    }),
    (v: ReturnType<typeof challenge>) => ({
      ...v,
      message: v.message.replaceAll(origin, 'https://evil.example'),
    }),
    (v: ReturnType<typeof challenge>) => ({ ...v, message: v.message.replace(owner, other) }),
    (v: ReturnType<typeof challenge>) => ({ ...v, nonce: '12'.repeat(24) }),
    (v: ReturnType<typeof challenge>) => ({ ...v, expiresAt: v.expiresAt + 1 }),
  ]) {
    const api = async () => mutate(challenge());
    const client = new TestnetWalletClient(provider, api, origin);
    await assert.rejects(client.login(), /WALLET_CHALLENGE_INVALID/);
  }
  assert.equal(signatures, 0);
});
