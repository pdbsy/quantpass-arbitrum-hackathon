import { setTimeout as delay } from 'node:timers/promises';
import { captureReference } from './capture.ts';
import type { MarketJournal, ReadTransport } from './capture.ts';
import { requireValue, validateSelection } from './robinhood.ts';
import type { Selection } from './robinhood.ts';
export interface ContinuousConfig {
  selection: Selection;
  maxAgeMs: number;
  intervalMs: number;
  maxCaptures: number | null;
  maxConsecutiveRejections: number;
}
export interface CollectionSummary {
  status: 'COMPLETED' | 'STOPPED' | 'REJECTED' | 'FAILED';
  reason: string | null;
  captures: number;
  accepted: number;
  rejected: number;
  lastCaptureId: number | null;
}
function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  requireValue(
    input !== null && typeof input === 'object' && !Array.isArray(input),
    'INVALID_COLLECTION_CONFIG',
  );
  requireValue(
    Object.keys(input).length === keys.length && keys.every((key) => Object.hasOwn(input, key)),
    'INVALID_COLLECTION_CONFIG',
  );
  return input as Record<string, unknown>;
}
function positive(input: unknown): number {
  requireValue(
    typeof input === 'number' && Number.isSafeInteger(input) && input > 0,
    'INVALID_COLLECTION_POLICY',
  );
  return input;
}
export function parseContinuousConfig(input: unknown): ContinuousConfig {
  const row = fields(input, [
    'selection',
    'maxAgeMs',
    'intervalMs',
    'maxCaptures',
    'maxConsecutiveRejections',
  ]);
  const selection = fields(row.selection, ['chainId', 'contractAddress', 'symbol']);
  const maxAgeMs = positive(row.maxAgeMs),
    intervalMs = positive(row.intervalMs),
    maxConsecutiveRejections = positive(row.maxConsecutiveRejections);
  requireValue(intervalMs <= 2147483647, 'INVALID_COLLECTION_INTERVAL');
  return {
    selection: validateSelection(selection as unknown as Selection),
    maxAgeMs,
    intervalMs,
    maxCaptures: row.maxCaptures === null ? null : positive(row.maxCaptures),
    maxConsecutiveRejections,
  };
}
/** Append-only market input collection; no paper trades, strategy authority or order submission. */
export async function collectReferences(
  input: unknown,
  journal: Pick<MarketJournal, 'append'>,
  transport: ReadTransport = fetch,
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<CollectionSummary> {
  const config = parseContinuousConfig(input);
  const summary: CollectionSummary = {
    status: 'COMPLETED',
    reason: null,
    captures: 0,
    accepted: 0,
    rejected: 0,
    lastCaptureId: null,
  };
  const finish = (status: CollectionSummary['status'], reason: string): CollectionSummary => ({
    ...summary,
    status,
    reason,
  });
  let consecutive = 0;
  for (;;) {
    if (signal?.aborted) return finish('STOPPED', 'OPERATOR_STOPPED');
    const captured = await captureReference(config.selection, config.maxAgeMs, transport, now, signal);
    try {
      const id = journal.append(captured);
      requireValue(Number.isSafeInteger(id) && id > 0, 'INVALID_JOURNAL_ID');
      summary.lastCaptureId = id;
    } catch {
      return finish('FAILED', 'JOURNAL_APPEND_FAILED');
    }
    summary.captures++;
    if (captured.status === 'ACCEPTED') {
      summary.accepted++;
      consecutive = 0;
    } else {
      summary.rejected++;
      consecutive++;
    }
    if (signal?.aborted) return finish('STOPPED', 'OPERATOR_STOPPED');
    if (captured.reason === 'HTTP_ACCESS_DENIED') return finish('REJECTED', 'HTTP_ACCESS_DENIED');
    if (consecutive >= config.maxConsecutiveRejections)
      return finish('REJECTED', 'CONSECUTIVE_REJECTION_LIMIT');
    if (config.maxCaptures !== null && summary.captures >= config.maxCaptures) return summary;
    if (summary.captures === Number.MAX_SAFE_INTEGER) return finish('FAILED', 'COLLECTION_COUNTER_LIMIT');
    // Completion-relative interval: slow upstream reads never trigger catch-up bursts.
    try {
      await delay(config.intervalMs, undefined, signal ? { signal } : undefined);
    } catch {
      return signal?.aborted
        ? finish('STOPPED', 'OPERATOR_STOPPED')
        : finish('FAILED', 'COLLECTION_WAIT_FAILED');
    }
  }
}
