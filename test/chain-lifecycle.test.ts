import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asAddress,
  asBlockHash,
  asTransactionHash,
  sameAddress,
} from '../packages/chain-adapter/src/types.ts';
import { createOperation, transitionOperation } from '../packages/chain-adapter/src/lifecycle.ts';

const OWNER = asAddress('0x1111111111111111111111111111111111111111');
const TARGET = asAddress('0x2222222222222222222222222222222222222222');
const HASH = asTransactionHash(`0x${'33'.repeat(32)}`);
const REPLACEMENT = asTransactionHash(`0x${'44'.repeat(32)}`);
const BLOCK = asBlockHash(`0x${'55'.repeat(32)}`);
const SUBMITTED_AT = '2026-09-14T12:00:00.000Z';
const CONFIRMED_AT = '2026-09-14T12:01:00.000Z';

function awaiting() {
  return createOperation({
    operationId: 'operation-1',
    chainId: 46_630,
    owner: OWNER,
    target: TARGET,
    state: 'AWAITING_SIGNATURE',
  });
}

test('negative reverted block evidence is rejected without changing the submitted operation', () => {
  const submitted = transitionOperation(awaiting(), {
    state: 'SUBMITTED',
    txHash: HASH,
    submittedAt: SUBMITTED_AT,
  });
  const before = structuredClone(submitted);
  const update = {
    state: 'REVERTED',
    blockNumber: -1n,
    blockHash: BLOCK,
    receiptStatus: 'REVERTED',
    errorCode: 'TRANSACTION_REVERTED',
  } as const;
  assert.throws(() => transitionOperation(submitted, update), /INVALID_BLOCK_NUMBER/);
  assert.deepEqual(submitted, before);
  const reverted = transitionOperation(submitted, { ...update, blockNumber: 0n });
  assert.equal(reverted.state, 'REVERTED');
  assert.equal(reverted.blockNumber, 0n);
  assert.equal(reverted.confirmations, 0);
  assert.equal(reverted.reconciled, false);
});

test('chain values reject malformed data and compare addresses without changing identity', () => {
  assert.equal(asAddress(OWNER), OWNER);
  assert.equal(sameAddress(OWNER, asAddress(OWNER.toUpperCase().replace('0X', '0x'))), true);
  for (const value of ['', '0x1', `0x${'gg'.repeat(20)}`, `0x${'11'.repeat(21)}`]) {
    assert.throws(() => asAddress(value), /INVALID_ADDRESS/);
  }
  assert.throws(() => asTransactionHash(`0x${'11'.repeat(31)}`), /INVALID_TRANSACTION_HASH/);
  assert.throws(() => asBlockHash(`0x${'11'.repeat(33)}`), /INVALID_BLOCK_HASH/);
});

test('lifecycle rejects malformed identity, timestamps, evidence and replacement data', () => {
  for (const operationId of ['', '../unsafe', 'x'.repeat(129)])
    assert.throws(
      () =>
        createOperation({
          operationId,
          chainId: 46_630,
          owner: OWNER,
          target: TARGET,
          state: 'AWAITING_SIGNATURE',
        }),
      /INVALID_OPERATION_ID/,
    );
  for (const chainId of [0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5])
    assert.throws(
      () =>
        createOperation({
          operationId: 'invalid-chain',
          chainId,
          owner: OWNER,
          target: TARGET,
          state: 'AWAITING_SIGNATURE',
        }),
      /INVALID_CHAIN_ID/,
    );

  const current = awaiting();
  assert.throws(
    () => transitionOperation(current, { state: 'SUBMITTED', txHash: HASH, submittedAt: 'not-a-time' }),
    /INVALID_SUBMITTED_AT/,
  );
  const submitted = transitionOperation(current, {
    state: 'SUBMITTED',
    txHash: HASH,
    submittedAt: SUBMITTED_AT,
  });
  for (const blockNumber of [-1n])
    assert.throws(
      () =>
        transitionOperation(submitted, {
          state: 'MINED',
          blockNumber,
          blockHash: BLOCK,
          receiptStatus: 'SUCCESS',
        }),
      /INVALID_BLOCK_NUMBER/,
    );
  for (const transactionIndex of [-1, Number.MAX_SAFE_INTEGER + 1, 1.5])
    assert.throws(
      () =>
        transitionOperation(submitted, {
          state: 'MINED',
          blockNumber: 1n,
          blockHash: BLOCK,
          transactionIndex,
          receiptStatus: 'SUCCESS',
        }),
      /INVALID_TRANSACTION_INDEX/,
    );
  assert.throws(
    () =>
      transitionOperation(submitted, {
        state: 'REVERTED',
        blockNumber: 1n,
        blockHash: BLOCK,
        transactionIndex: -1,
        receiptStatus: 'REVERTED',
        errorCode: 'TRANSACTION_REVERTED',
      }),
    /INVALID_TRANSACTION_INDEX/,
  );

  const mined = transitionOperation(submitted, {
    state: 'MINED',
    blockNumber: 1n,
    blockHash: BLOCK,
    receiptStatus: 'SUCCESS',
  });
  assert.throws(
    () => transitionOperation(mined, { state: 'CONFIRMING', confirmations: -1 }),
    /INVALID_CONFIRMATION_COUNT/,
  );
  const confirming = transitionOperation(mined, { state: 'CONFIRMING', confirmations: 2 });
  assert.throws(
    () =>
      transitionOperation(confirming, {
        state: 'CONFIRMED',
        confirmations: 1,
        confirmedAt: CONFIRMED_AT,
        reconciled: true,
      }),
    /INVALID_CONFIRMATION_COUNT/,
  );
  assert.throws(
    () =>
      transitionOperation(confirming, {
        state: 'CONFIRMED',
        confirmations: 2,
        confirmedAt: 'not-a-time',
        reconciled: true,
      }),
    /INVALID_CONFIRMED_AT/,
  );
  assert.throws(
    () => transitionOperation(submitted, { state: 'REPLACED', errorCode: 'TRANSACTION_REPLACED' }),
    /REPLACEMENT_HASH_REQUIRED/,
  );
  assert.throws(
    () =>
      transitionOperation(submitted, {
        state: 'REPLACED',
        replacementTxHash: HASH,
        errorCode: 'TRANSACTION_REPLACED',
      }),
    /REPLACEMENT_HASH_MUST_DIFFER/,
  );
});

test('a transaction hash advances only to submitted and cannot skip canonical reconciliation', () => {
  assert.equal(awaiting().transactionIndex, null);
  const submitted = transitionOperation(awaiting(), {
    state: 'SUBMITTED',
    txHash: HASH,
    submittedAt: SUBMITTED_AT,
  });
  assert.equal(submitted.state, 'SUBMITTED');
  assert.equal(submitted.txHash, HASH);
  assert.equal(submitted.confirmedAt, null);
  assert.throws(
    () =>
      transitionOperation(submitted, {
        state: 'CONFIRMED',
        confirmations: 2,
        confirmedAt: CONFIRMED_AT,
        reconciled: true,
      }),
    /INVALID_OPERATION_TRANSITION/,
  );
});

test('successful receipt remains mined or confirming until reconciliation succeeds', () => {
  const submitted = transitionOperation(awaiting(), {
    state: 'SUBMITTED',
    txHash: HASH,
    submittedAt: SUBMITTED_AT,
  });
  const mined = transitionOperation(submitted, {
    state: 'MINED',
    blockNumber: 120n,
    blockHash: BLOCK,
    transactionIndex: 7,
    receiptStatus: 'SUCCESS',
  });
  assert.equal(mined.transactionIndex, 7);
  assert.throws(
    () =>
      transitionOperation(submitted, {
        state: 'MINED',
        blockNumber: 120n,
        blockHash: BLOCK,
        transactionIndex: -1,
        receiptStatus: 'SUCCESS',
      }),
    /INVALID_TRANSACTION_INDEX/,
  );
  const confirming = transitionOperation(mined, { state: 'CONFIRMING', confirmations: 2 });
  assert.equal(confirming.canonical, true);
  assert.equal(confirming.confirmedAt, null);
  assert.throws(
    () =>
      transitionOperation(confirming, {
        state: 'CONFIRMED',
        confirmations: 3,
        confirmedAt: CONFIRMED_AT,
        reconciled: false,
      }),
    /RECONCILIATION_REQUIRED/,
  );
  const confirmed = transitionOperation(confirming, {
    state: 'CONFIRMED',
    confirmations: 3,
    confirmedAt: CONFIRMED_AT,
    reconciled: true,
  });
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.equal(confirmed.confirmations, 3);
  assert.equal(confirmed.confirmedAt, CONFIRMED_AT);
});

test('wallet rejection is explicit and never creates a transaction hash', () => {
  const rejected = transitionOperation(awaiting(), {
    state: 'REJECTED',
    errorCode: 'WALLET_REJECTED',
  });
  assert.equal(rejected.state, 'REJECTED');
  assert.equal(rejected.txHash, null);
  assert.equal(rejected.errorCode, 'WALLET_REJECTED');
  assert.throws(
    () =>
      transitionOperation(rejected, {
        state: 'SUBMITTED',
        txHash: HASH,
        submittedAt: SUBMITTED_AT,
      }),
    /INVALID_OPERATION_TRANSITION/,
  );
});

test('revert, replacement and dropped states require their own evidence', () => {
  const submitted = transitionOperation(awaiting(), {
    state: 'SUBMITTED',
    txHash: HASH,
    submittedAt: SUBMITTED_AT,
  });
  const reverted = transitionOperation(submitted, {
    state: 'REVERTED',
    blockNumber: 120n,
    blockHash: BLOCK,
    receiptStatus: 'REVERTED',
    errorCode: 'TRANSACTION_REVERTED',
  });
  assert.equal(reverted.receiptStatus, 'REVERTED');
  assert.equal(reverted.canonical, true);

  const replaced = transitionOperation(submitted, {
    state: 'REPLACED',
    replacementTxHash: REPLACEMENT,
    errorCode: 'TRANSACTION_REPLACED',
  });
  assert.equal(replaced.replacementTxHash, REPLACEMENT);

  const dropped = transitionOperation(submitted, {
    state: 'DROPPED',
    errorCode: 'TRANSACTION_DROPPED',
  });
  assert.equal(dropped.state, 'DROPPED');
  assert.throws(
    () => transitionOperation(submitted, { state: 'REPLACED', errorCode: 'TRANSACTION_REPLACED' }),
    /REPLACEMENT_HASH_REQUIRED/,
  );
});

test('canonical mined and confirmed operations can become reorged without erasing evidence', () => {
  const submitted = transitionOperation(awaiting(), {
    state: 'SUBMITTED',
    txHash: HASH,
    submittedAt: SUBMITTED_AT,
  });
  const mined = transitionOperation(submitted, {
    state: 'MINED',
    blockNumber: 120n,
    blockHash: BLOCK,
    transactionIndex: 7,
    receiptStatus: 'SUCCESS',
  });
  const reorged = transitionOperation(mined, { state: 'REORGED', errorCode: 'CHAIN_REORG' });
  assert.equal(reorged.canonical, false);
  assert.equal(reorged.blockHash, BLOCK);
  assert.equal(reorged.txHash, HASH);
  assert.equal(reorged.confirmedAt, null);

  for (const terminal of [
    transitionOperation(reorged, { state: 'DROPPED', errorCode: 'TRANSACTION_DROPPED' }),
    transitionOperation(reorged, {
      state: 'REPLACED',
      replacementTxHash: REPLACEMENT,
      errorCode: 'TRANSACTION_REPLACED',
    }),
  ]) {
    assert.equal(terminal.blockNumber, 120n);
    assert.equal(terminal.blockHash, BLOCK);
    assert.equal(terminal.transactionIndex, 7);
    assert.equal(terminal.receiptStatus, 'SUCCESS');
    assert.equal(terminal.confirmations, 0);
    assert.equal(terminal.canonical, false);
  }
});

test('conflicting contract evidence enters reconciliation failure and remains non-confirmed', () => {
  const submitted = transitionOperation(awaiting(), {
    state: 'SUBMITTED',
    txHash: HASH,
    submittedAt: SUBMITTED_AT,
  });
  const mined = transitionOperation(submitted, {
    state: 'MINED',
    blockNumber: 120n,
    blockHash: BLOCK,
    receiptStatus: 'SUCCESS',
  });
  const failed = transitionOperation(mined, {
    state: 'RECONCILIATION_FAILED',
    errorCode: 'EVENT_EVIDENCE_MISMATCH',
  });
  assert.equal(failed.state, 'RECONCILIATION_FAILED');
  assert.equal(failed.confirmedAt, null);
});
