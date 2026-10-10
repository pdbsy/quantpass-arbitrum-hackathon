import type { DeploymentEntry, DeploymentWalletSession } from './deployment-wallet.ts';

export interface DeploymentSequenceProgress {
  phase: 'VERIFYING' | 'AWAITING_WALLET' | 'WAITING_CONFIRMATIONS' | 'COMPLETED';
  nextIndex: number;
  total: 41;
  currentEntry: DeploymentEntry | null;
}
export interface DeploymentSequenceOptions {
  session: Pick<DeploymentWalletSession, 'nextIndex' | 'journal' | 'reconcile' | 'sendNext'>;
  signal: AbortSignal;
  onProgress?: (progress: DeploymentSequenceProgress) => void | Promise<void>;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  confirmationTimeoutMs?: number;
}

function waitForConfirmation(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

/** The caller holds the wallet lock throughout, including any wallet prompt already in progress. */
export async function runDeploymentSequence(options: DeploymentSequenceOptions): Promise<void> {
  const { session, signal } = options,
    wait = options.wait ?? waitForConfirmation,
    now = options.now ?? (() => performance.now()),
    pollIntervalMs = options.pollIntervalMs ?? 2000,
    confirmationTimeoutMs = options.confirmationTimeoutMs ?? 5 * 60 * 1000;
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 1 ||
    pollIntervalMs > 30000 ||
    !Number.isSafeInteger(confirmationTimeoutMs) ||
    confirmationTimeoutMs < pollIntervalMs ||
    confirmationTimeoutMs > 30 * 60 * 1000
  )
    throw new Error('DEPLOYMENT_SEQUENCE_INVALID_TIMING');
  const clock = () => {
    const value = now();
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
      throw new Error('DEPLOYMENT_SEQUENCE_INVALID_TIMING');
    return value;
  };
  const progress = async (phase: DeploymentSequenceProgress['phase']) => {
    await options.onProgress?.({
      phase,
      nextIndex: session.nextIndex,
      total: 41,
      currentEntry: session.journal.entries[session.nextIndex] ?? null,
    });
    // Progress can await a paint before the next prompt; a stop during it still prevents sending.
    signal.throwIfAborted();
  };
  signal.throwIfAborted();
  await progress('VERIFYING');
  await session.reconcile();
  signal.throwIfAborted();
  let waitingHash: string | null = null,
    waitingSince = 0;
  for (;;) {
    signal.throwIfAborted();
    const journal = session.journal,
      index = session.nextIndex;
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index > 41 ||
      journal.entries.length > 41 ||
      journal.entries.slice(0, index).some((entry) => entry.state !== 'CONFIRMED')
    )
      throw new Error('DEPLOYMENT_SEQUENCE_RECOVERY_REQUIRED');
    if (index === 41) {
      if (journal.entries.length !== 41) throw new Error('DEPLOYMENT_SEQUENCE_RECOVERY_REQUIRED');
      await progress('COMPLETED');
      return;
    }
    const entry = journal.entries[index];
    if (entry) {
      if (
        !['SUBMITTED', 'INCLUDED'].includes(entry.state) ||
        !entry.transactionHash ||
        !/^0x[0-9a-fA-F]{64}$/.test(entry.transactionHash)
      )
        throw new Error('DEPLOYMENT_SEQUENCE_RECOVERY_REQUIRED');
      if (waitingHash !== entry.transactionHash) {
        waitingHash = entry.transactionHash;
        waitingSince = clock();
      }
      if (clock() - waitingSince >= confirmationTimeoutMs)
        throw new Error('DEPLOYMENT_SEQUENCE_CONFIRMATION_TIMEOUT');
      await progress('WAITING_CONFIRMATIONS');
      await wait(pollIntervalMs, signal);
      signal.throwIfAborted();
      await session.reconcile();
      signal.throwIfAborted();
      if (clock() - waitingSince >= confirmationTimeoutMs)
        throw new Error('DEPLOYMENT_SEQUENCE_CONFIRMATION_TIMEOUT');
      continue;
    }
    if (index !== journal.entries.length) throw new Error('DEPLOYMENT_SEQUENCE_RECOVERY_REQUIRED');
    waitingHash = null;
    await progress('AWAITING_WALLET');
    // Cancellation before the intent is enforced again inside sendNext after its asynchronous preflight.
    await session.sendNext(signal);
    // Do not race an already opened wallet prompt with Stop: sendNext first persists its actual result.
    signal.throwIfAborted();
  }
}
