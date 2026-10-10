import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runDeploymentSequence, type DeploymentSequenceProgress } from '../apps/web/src/deployment-runner.ts';
import {
  DEPLOYMENT_ADMIN,
  type DeploymentEntry,
  type DeploymentJournal,
  type DeploymentState,
} from '../apps/web/src/deployment-wallet.ts';

// Deterministic orchestration fixtures only. No RPC, wallet connection, signature, or broadcast is made.
const hash = (index: number) =>
  '0x' +
  BigInt(index + 1000)
    .toString(16)
    .padStart(64, '0');
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function entry(index: number, state: DeploymentState = 'CONFIRMED'): DeploymentEntry {
  return {
    index,
    state,
    gasLimitRaw: '12000000',
    maxFeePerGasRaw: '20000000',
    maxPriorityFeePerGasRaw: '0',
    transactionHash: state === 'INTENT' ? null : hash(index),
    blockNumber: '100',
    blockHash: hash(100),
    gasUsedRaw: '1',
    effectiveGasPriceRaw: '1',
  };
}
class SequenceFixture {
  entries: DeploymentEntry[];
  trace: string[] = [];
  sends: number[] = [];
  reconciliations = 0;
  onReconcile: (() => void | Promise<void>) | null = null;
  onSend: ((index: number) => Promise<void>) | null = null;
  constructor(completed: number) {
    this.entries = Array.from({ length: completed }, (_, index) => entry(index));
  }
  get journal(): DeploymentJournal {
    return copy({
      schemaVersion: 1,
      payloadSha256: 'a'.repeat(64),
      chainId: 46630,
      wallet: DEPLOYMENT_ADMIN,
      entries: this.entries,
    });
  }
  get nextIndex() {
    const index = this.entries.findIndex((current) => current.state !== 'CONFIRMED');
    return index < 0 ? this.entries.length : index;
  }
  async reconcile() {
    this.reconciliations++;
    this.trace.push('reconcile');
    await this.onReconcile?.();
    return this.journal;
  }
  async sendNext(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const index = this.nextIndex;
    assert.equal(index, this.entries.length);
    this.entries.push(entry(index, 'INTENT'));
    this.sends.push(index);
    this.trace.push('send:' + index);
    await this.onSend?.(index);
    // An open prompt's outcome is durably recorded before its operation settles, even after Stop.
    this.entries[index] = entry(index);
    return this.journal;
  }
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('one explicit sequence start reconciles existing history and exposes each remaining action before sending it once', async () => {
  const session = new SequenceFixture(38),
    progress: DeploymentSequenceProgress[] = [];
  await runDeploymentSequence({
    session,
    signal: new AbortController().signal,
    onProgress: async (value) => {
      progress.push(value);
      session.trace.push('progress:' + value.phase + ':' + value.nextIndex);
      await Promise.resolve();
    },
  });
  assert.deepEqual(session.sends, [38, 39, 40]);
  assert.equal(session.reconciliations, 1);
  assert.equal(session.trace[0], 'progress:VERIFYING:38');
  assert.equal(session.trace[1], 'reconcile');
  for (const index of session.sends)
    assert.ok(
      session.trace.indexOf('progress:AWAITING_WALLET:' + index) < session.trace.indexOf('send:' + index),
    );
  assert.equal(progress.at(-1)!.phase, 'COMPLETED');
  assert.equal(progress.at(-1)!.nextIndex, 41);
  assert.equal(progress.at(-1)!.total, 41);
});

test('a known included hash only polls reconciliation until the fixture chain reaches three inclusive blocks', async () => {
  const session = new SequenceFixture(40);
  session.entries.push(entry(40, 'INCLUDED'));
  let head = 100,
    waits = 0;
  session.onReconcile = () => {
    if (head >= 102) session.entries[40]!.state = 'CONFIRMED';
  };
  await runDeploymentSequence({
    session,
    signal: new AbortController().signal,
    now: () => head,
    pollIntervalMs: 1,
    confirmationTimeoutMs: 10,
    wait: async (_milliseconds, signal) => {
      signal.throwIfAborted();
      waits++;
      head++;
    },
  });
  assert.equal(waits, 2);
  assert.equal(session.reconciliations, 3);
  assert.deepEqual(session.sends, []);
  assert.equal(session.nextIndex, 41);
});

test('unknown, reverted, reorged, intent and missing-hash states stop instead of requesting a new signature', async () => {
  for (const state of ['UNKNOWN', 'REVERTED', 'REORGED', 'INTENT', 'SUBMITTED', 'INCLUDED'] as const) {
    const session = new SequenceFixture(7),
      current = entry(7, state);
    if (state === 'SUBMITTED') current.transactionHash = null;
    if (state === 'INCLUDED') current.transactionHash = DEPLOYMENT_ADMIN;
    session.entries.push(current);
    await assert.rejects(
      runDeploymentSequence({ session, signal: new AbortController().signal }),
      /SEQUENCE_RECOVERY_REQUIRED/,
    );
    assert.equal(session.reconciliations, 1);
    assert.deepEqual(session.sends, []);
    assert.equal(session.entries[7]!.state, state);
  }
});

test('Stop while painting the next action creates no intent or signature request', async () => {
  const session = new SequenceFixture(40),
    controller = new AbortController(),
    reason = new Error('USER_STOPPED');
  await assert.rejects(
    runDeploymentSequence({
      session,
      signal: controller.signal,
      onProgress: (value) => {
        if (value.phase === 'AWAITING_WALLET') controller.abort(reason);
      },
    }),
    (error) => error === reason,
  );
  assert.deepEqual(session.sends, []);
  assert.equal(session.entries.length, 40);
});

test('Stop during an open wallet prompt waits for its stored outcome before the sequence settles or its caller releases the lock', async () => {
  const session = new SequenceFixture(39),
    controller = new AbortController(),
    reason = new Error('USER_STOPPED'),
    opened = gate(),
    result = gate();
  let lockReleased = false;
  session.onSend = async () => {
    opened.resolve();
    await result.promise;
  };
  const run = runDeploymentSequence({ session, signal: controller.signal }).finally(() => {
    lockReleased = true;
  });
  await opened.promise;
  controller.abort(reason);
  await Promise.resolve();
  assert.equal(lockReleased, false);
  assert.equal(session.entries[39]!.state, 'INTENT');
  result.resolve();
  await assert.rejects(run, (error) => error === reason);
  assert.equal(lockReleased, true);
  assert.equal(session.entries[39]!.state, 'CONFIRMED');
  assert.equal(session.entries[39]!.transactionHash, hash(39));
  assert.deepEqual(session.sends, [39]);
});

test('pending confirmation timeout and failed preflight stop without an automatic retry', async () => {
  const pending = new SequenceFixture(40);
  pending.entries.push(entry(40, 'SUBMITTED'));
  let now = 0;
  await assert.rejects(
    runDeploymentSequence({
      session: pending,
      signal: new AbortController().signal,
      now: () => now,
      pollIntervalMs: 1,
      confirmationTimeoutMs: 2,
      wait: async () => {
        now++;
      },
    }),
    /SEQUENCE_CONFIRMATION_TIMEOUT/,
  );
  assert.deepEqual(pending.sends, []);
  for (const reason of [
    'DEPLOYMENT_APPROVAL_EXPIRED',
    'DEPLOYMENT_WRONG_NETWORK',
    'DEPLOYMENT_NONCE_COMPETITION',
    'DEPLOYMENT_READ_RPC_UNAVAILABLE',
  ]) {
    const session = new SequenceFixture(40);
    session.onSend = async () => {
      throw new Error(reason);
    };
    await assert.rejects(
      runDeploymentSequence({ session, signal: new AbortController().signal }),
      new RegExp(reason),
    );
    assert.deepEqual(session.sends, [40]);
  }
});

test('default confirmation wait responds to Stop and an aborted start never reconciles or sends', async () => {
  const session = new SequenceFixture(40),
    controller = new AbortController(),
    reason = new Error('USER_STOPPED');
  session.entries.push(entry(40, 'SUBMITTED'));
  await assert.rejects(
    runDeploymentSequence({
      session,
      signal: controller.signal,
      pollIntervalMs: 30,
      confirmationTimeoutMs: 100,
      onProgress: (value) => {
        if (value.phase === 'WAITING_CONFIRMATIONS') setTimeout(() => controller.abort(reason), 1);
      },
    }),
    (error) => error === reason,
  );
  assert.equal(session.reconciliations, 1);
  assert.deepEqual(session.sends, []);
  const fresh = new SequenceFixture(7);
  await assert.rejects(
    runDeploymentSequence({ session: fresh, signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(fresh.reconciliations, 0);
  assert.deepEqual(fresh.sends, []);
});
