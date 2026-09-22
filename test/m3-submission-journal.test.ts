import assert from 'node:assert/strict';
import test from 'node:test';
import { M3SubmissionJournal, type PendingWalletSubmission } from '../apps/web/src/m3-submission-journal.ts';
import { asAddress, asHexData, asTransactionHash } from '../packages/chain-adapter/src/types.ts';
import { encodeM3VaultCall } from '../packages/chain-adapter/src/vault-abi.ts';

const owner = asAddress(`0x${'11'.repeat(20)}`);
const vault = asAddress(`0x${'22'.repeat(20)}`);
const pass = asAddress(`0x${'44'.repeat(20)}`);
const context = {
  chainId: 46_630 as const,
  vaultAddress: vault,
  strategyPassAddress: pass,
  manifestDigest: `0x${'aa'.repeat(32)}`,
};
const input: PendingWalletSubmission = {
  operationId: 'known-wallet-send',
  chainId: 46_630,
  owner,
  target: vault,
  calldata: encodeM3VaultCall('deposit(uint256)', [1n]),
  txHash: asTransactionHash(`0x${'bb'.repeat(32)}`),
};
function fixture() {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  return { saved, storage, journal: new M3SubmissionJournal(context, storage) };
}

test('journal preserves exact public registration identity across reconstruction and separates deployment scopes', () => {
  const { saved, storage, journal } = fixture();
  journal.record(input);
  assert.deepEqual(new M3SubmissionJournal(context, storage).read(owner), [input]);
  assert.deepEqual(new M3SubmissionJournal(context, storage).read(pass), []);
  assert.deepEqual(new M3SubmissionJournal({ ...context, vaultAddress: pass }, storage).read(owner), []);
  assert.deepEqual(
    new M3SubmissionJournal({ ...context, manifestDigest: `0x${'cc'.repeat(32)}` }, storage).read(owner),
    [],
  );
  assert.equal(saved.size, 1);
  journal.record(input);
  assert.equal(journal.read(owner).length, 1);
  assert.throws(
    () => journal.record({ ...input, calldata: encodeM3VaultCall('deposit(uint256)', [2n]) }),
    /M3_SUBMISSION_RECOVERY_INVALID/,
  );
  assert.deepEqual(journal.read(owner), [input]);
});

test('journal rejects corrupted and context-rebound storage without changing its bytes', () => {
  const { saved, journal } = fixture();
  journal.record(input);
  const key = [...saved.keys()][0]!;
  const invalid = [
    '{',
    '{}',
    'x'.repeat(65_537),
    JSON.stringify([null]),
    JSON.stringify([[]]),
    JSON.stringify([input, input]),
    JSON.stringify(Array.from({ length: 33 }, (_, n) => ({ ...input, operationId: `pending-${n}` }))),
    ...[
      { operationId: '../operation' },
      { owner: pass },
      { target: owner },
      { chainId: 1 },
      { txHash: '0x1234' },
      { calldata: '0x12345678' },
      { calldata: '0x' + '00'.repeat(70) },
      { calldata: 123 },
      { target: null },
      { approved: true },
    ].map((change) => JSON.stringify([{ ...input, ...change }])),
  ];
  for (const raw of invalid) {
    saved.set(key, raw);
    assert.throws(() => journal.read(owner), /M3_SUBMISSION_RECOVERY_INVALID/);
    assert.equal(saved.get(key), raw);
  }
});

test('an unresolved identical intent blocks resend while a different owner exit remains available', () => {
  const { journal } = fixture();
  journal.record(input);
  assert.throws(
    () => journal.assertWritable(owner, vault, input.calldata),
    /M3_SUBMISSION_RECOVERY_REQUIRED/,
  );
  assert.doesNotThrow(() => journal.assertWritable(owner, vault, encodeM3VaultCall('close()', [])));
  journal.remove(input);
  assert.deepEqual(journal.read(owner), []);
  assert.doesNotThrow(() => journal.assertWritable(owner, vault, input.calldata));
});

test('journal bounds unresolved records without discarding older known hashes', () => {
  const { saved, journal } = fixture();
  for (let index = 0; index < 32; index++) journal.record({ ...input, operationId: `pending-${index}` });
  const before = [...saved.values()][0];
  assert.throws(() => journal.record({ ...input, operationId: 'overflow' }), /M3_SUBMISSION_RECOVERY_FULL/);
  assert.throws(
    () => journal.assertWritable(owner, vault, encodeM3VaultCall('close()', [])),
    /M3_SUBMISSION_RECOVERY_FULL/,
  );
  assert.equal([...saved.values()][0], before);
  assert.equal(journal.read(owner).length, 32);
});

test('journal detects a storage write that silently drops recovery data', () => {
  const journal = new M3SubmissionJournal(context, { getItem: () => null, setItem: () => {} });
  assert.throws(
    () => journal.assertWritable(owner, vault, input.calldata),
    /M3_SUBMISSION_RECOVERY_UNAVAILABLE/,
  );
  assert.throws(() => journal.record(input), /M3_SUBMISSION_RECOVERY_UNAVAILABLE/);
});

test('journal accepts only the configured Pass contract and exact transfer calldata', () => {
  const { journal } = fixture();
  const transfer = {
    ...input,
    target: pass,
    calldata: asHexData(`0xa9059cbb${vault.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}`),
  };
  journal.record(transfer);
  assert.deepEqual(journal.read(owner), [transfer]);
});
