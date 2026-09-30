import { setTimeout as delay } from 'node:timers/promises';
import { batchInteger, captureReferenceBatch, exactFields, parseBatchPolicy } from './batch.ts';
import type { BatchPolicy } from './batch.ts';
import type { ReadTransport } from './capture.ts';
import type { BatchJournal } from './batch-journal.ts';
import { requireValue } from './robinhood.ts';
export interface BatchCollectionConfig extends BatchPolicy {
  intervalMs: number;
  maxBatches: number | null;
  maxConsecutiveRejections: number | null;
}
export interface BatchCollectionSummary {
  status: 'COMPLETED' | 'STOPPED' | 'REJECTED' | 'FAILED';
  reason: string | null;
  batches: number;
  accepted: number;
  rejected: number;
  lastBatchId: number | null;
}
export function parseBatchCollectionConfig(input: unknown): BatchCollectionConfig {
  const row = exactFields(input, [
    'selections',
    'maxAgeMs',
    'maxQuoteSkewMs',
    'maxCaptureSpanMs',
    'intervalMs',
    'maxBatches',
    'maxConsecutiveRejections',
  ]);
  const policy = parseBatchPolicy({
    selections: row.selections,
    maxAgeMs: row.maxAgeMs,
    maxQuoteSkewMs: row.maxQuoteSkewMs,
    maxCaptureSpanMs: row.maxCaptureSpanMs,
  });
  const intervalMs = batchInteger(row.intervalMs);
  requireValue(intervalMs <= 2147483647, 'INVALID_BATCH_INTERVAL');
  return {
    ...policy,
    intervalMs,
    maxBatches: row.maxBatches === null ? null : batchInteger(row.maxBatches),
    maxConsecutiveRejections:
      row.maxConsecutiveRejections === null ? null : batchInteger(row.maxConsecutiveRejections),
  };
}
export async function collectReferenceBatches(
  input: unknown,
  journal: Pick<BatchJournal, 'append'>,
  transport: ReadTransport = fetch,
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<BatchCollectionSummary> {
  const config = parseBatchCollectionConfig(input);
  const policy = parseBatchPolicy({
    selections: config.selections,
    maxAgeMs: config.maxAgeMs,
    maxQuoteSkewMs: config.maxQuoteSkewMs,
    maxCaptureSpanMs: config.maxCaptureSpanMs,
  });
  const summary: BatchCollectionSummary = {
    status: 'COMPLETED',
    reason: null,
    batches: 0,
    accepted: 0,
    rejected: 0,
    lastBatchId: null,
  };
  const finish = (status: BatchCollectionSummary['status'], reason: string): BatchCollectionSummary => ({
    ...summary,
    status,
    reason,
  });
  let consecutive = 0;
  for (;;) {
    if (signal?.aborted) return finish('STOPPED', 'OPERATOR_STOPPED');
    let captured;
    try {
      captured = await captureReferenceBatch(policy, transport, now, signal);
    } catch {
      return finish('FAILED', 'BATCH_CAPTURE_FAILED');
    }
    try {
      const id = journal.append(captured);
      requireValue(Number.isSafeInteger(id) && id > 0, 'INVALID_BATCH_ID');
      summary.lastBatchId = id;
    } catch {
      return finish('FAILED', 'JOURNAL_APPEND_FAILED');
    }
    summary.batches++;
    if (captured.status === 'ACCEPTED') {
      summary.accepted++;
      consecutive = 0;
    } else {
      summary.rejected++;
      consecutive++;
    }
    if (signal?.aborted) return finish('STOPPED', 'OPERATOR_STOPPED');
    if (captured.reason === 'HTTP_ACCESS_DENIED') return finish('REJECTED', 'HTTP_ACCESS_DENIED');
    if (config.maxConsecutiveRejections !== null && consecutive >= config.maxConsecutiveRejections)
      return finish('REJECTED', 'CONSECUTIVE_REJECTION_LIMIT');
    if (config.maxBatches !== null && summary.batches >= config.maxBatches) return summary;
    if (summary.batches === Number.MAX_SAFE_INTEGER) return finish('FAILED', 'COLLECTION_COUNTER_LIMIT');
    try {
      await delay(config.intervalMs, undefined, signal ? { signal } : undefined);
    } catch {
      return signal?.aborted
        ? finish('STOPPED', 'OPERATOR_STOPPED')
        : finish('FAILED', 'COLLECTION_WAIT_FAILED');
    }
  }
}
