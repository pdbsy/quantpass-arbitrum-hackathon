import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrderJournal } from '../packages/testnet/src/order-journal.ts';
import { submitRestrictedIntent } from '../packages/testnet/src/restricted-submission.ts';
const hash = '0x' + 'ab'.repeat(32),
  intent = {
    id: 'bounded-intent',
    chainId: 46630,
    owner: '0x' + '1'.repeat(40),
    executor: '0x' + '2'.repeat(40),
    vault: '0x' + '3'.repeat(40),
    manifestDigest: hash,
    sourceDigest: hash,
    grantVersion: '1',
    stateVersion: '4',
    snapshotHash: hash,
    calldata: '0x12345678',
    createdAt: 1000,
  };
const policy = {
  gasLimit: '100000',
  maxFeePerGas: '1000',
  maxPriorityFeePerGas: '1',
  maxGasCostWei: '100000000',
};
test('bad network, nonce, gas, or changed authorization fail before signer; failed signer remains durably reserved', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'alphaforge-restricted-'));
  const journal = new OrderJournal(join(folder, 'orders.sqlite'), hash);
  let signs = 0,
    sends = 0,
    chain = 46630,
    pending = 7,
    gas = 99999n,
    changed = false;
  const signer = {
    address: intent.executor,
    sign: async () => {
      signs++;
      assert.equal(journal.get(intent.id)!.state, 'RESERVED');
      throw new Error('TEST_NO_SIGNING');
    },
  };
  const transport = {
    chainId: async () => chain,
    nonce: async (_a: string, b: 'pending' | 'latest') => (b === 'pending' ? pending : 7),
    balance: async () => 1000000000n,
    estimate: async () => gas,
    send: async () => {
      sends++;
      return hash;
    },
  };
  const revalidate = async () => {
    if (changed) throw new Error('CHANGED_AUTHORITY');
  };
  try {
    chain = 4663;
    await assert.rejects(
      submitRestrictedIntent(journal, intent, policy, signer, transport, revalidate),
      /AUTHORITY/,
    );
    chain = 46630;
    pending = 8;
    await assert.rejects(
      submitRestrictedIntent(journal, intent, policy, signer, transport, revalidate),
      /NONCE/,
    );
    pending = 7;
    gas = 100001n;
    await assert.rejects(
      submitRestrictedIntent(journal, intent, policy, signer, transport, revalidate),
      /GAS_LIMIT/,
    );
    gas = 99999n;
    changed = true;
    await assert.rejects(
      submitRestrictedIntent(journal, intent, policy, signer, transport, revalidate),
      /CHANGED_AUTHORITY/,
    );
    assert.equal(signs, 0);
    changed = false;
    await assert.rejects(
      submitRestrictedIntent(journal, intent, policy, signer, transport, revalidate),
      /TEST_NO_SIGNING/,
    );
    assert.equal(signs, 1);
    assert.equal(sends, 0);
    assert.equal(journal.blocked(intent.executor), true);
    await assert.rejects(
      submitRestrictedIntent(journal, intent, policy, signer, transport, revalidate),
      /AUTHORITY/,
    );
    assert.equal(signs, 1);
  } finally {
    journal.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
