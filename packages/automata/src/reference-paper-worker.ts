import { setTimeout as delay } from 'node:timers/promises';
import type { BatchJournal } from '../../market-data/src/batch-journal.ts';
import { requireValue } from '../../market-data/src/robinhood.ts';
import type { PaperJournal } from './reference-paper-journal.ts';
export interface PaperConsumerOptions {
  pollMs: number;
  maxInputs: number | null;
}
export function validateConsumerOptions(input: PaperConsumerOptions): void {
  requireValue(
    Number.isSafeInteger(input.pollMs) && input.pollMs > 0 && input.pollMs <= 2147483647,
    'INVALID_PAPER_POLL',
  );
  requireValue(
    input.maxInputs === null || (Number.isSafeInteger(input.maxInputs) && input.maxInputs > 0),
    'INVALID_PAPER_COUNT',
  );
}
export interface PaperConsumerSummary {
  status: 'COMPLETED' | 'STOPPED';
  inputs: number;
  accepted: number;
  rejected: number;
  fills: number;
  cursor: number;
}
/** Durable virtual execution only. Replaying input never authorizes chain orders. */
export async function consumePaper(
  source: BatchJournal,
  journal: PaperJournal,
  input: PaperConsumerOptions,
  signal: AbortSignal,
): Promise<PaperConsumerSummary> {
  validateConsumerOptions(input);
  const options = { ...input };
  let inputs = 0,
    accepted = 0,
    rejected = 0,
    fills = 0;
  const summary = (status: PaperConsumerSummary['status']): PaperConsumerSummary => ({
    status,
    inputs,
    accepted,
    rejected,
    fills,
    cursor: journal.snapshot().cursor,
  });
  for (;;) {
    if (signal.aborted) return summary('STOPPED');
    journal.refresh();
    const row = source.next(journal.snapshot().cursor);
    if (row) {
      if (signal.aborted) continue;
      let result;
      try {
        result = journal.consume(row);
      } catch (error) {
        if (error instanceof Error && error.message === 'PAPER_REVISION_CONFLICT') continue;
        throw error;
      }
      inputs++;
      if (result.events.some((e) => e.kind === 'REFERENCE_REJECTED')) rejected++;
      else accepted++;
      fills += result.events.filter((e) => e.kind === 'FILL').length;
      requireValue(Number.isSafeInteger(inputs) && Number.isSafeInteger(fills), 'PAPER_COUNTER_LIMIT');
      if (options.maxInputs !== null && inputs >= options.maxInputs) return summary('COMPLETED');
    } else {
      try {
        await delay(options.pollMs, undefined, { signal });
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    }
  }
}
