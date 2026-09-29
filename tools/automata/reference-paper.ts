import { BatchJournal } from '../../packages/market-data/src/batch-journal.ts';
import { PaperJournal } from '../../packages/automata/src/reference-paper-journal.ts';
import {
  parsePaperConfig,
  paperAmount,
  paperNav,
  paperReturn,
} from '../../packages/automata/src/reference-paper.ts';
import { consumePaper, validateConsumerOptions } from '../../packages/automata/src/reference-paper-worker.ts';
import { readCollectionInput } from './collection-input.ts';
import { resolve } from 'node:path';
const usage =
  'REFERENCE_PAPER only: reference-paper.ts run CONFIG SOURCE_DB PAPER_DB INPUT_COUNT_OR_continuous POLL_MS | status CONFIG SOURCE_DB PAPER_DB | stop CONFIG SOURCE_DB PAPER_DB | fund-in|fund-out CONFIG SOURCE_DB PAPER_DB AMOUNT6';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log(usage);
else {
  let config: ReturnType<typeof parsePaperConfig> | undefined,
    options: { pollMs: number; maxInputs: number | null } | undefined,
    amount: string | undefined;
  try {
    const command = args[0];
    if (!(
      (['run'].includes(command!) && args.length === 6) ||
      (['status', 'stop'].includes(command!) && args.length === 4) ||
      (['fund-in', 'fund-out'].includes(command!) && args.length === 5)
    ))
      throw new Error('INVALID_INPUT');
    if (resolve(args[2]!) === resolve(args[3]!)) throw new Error('INVALID_INPUT');
    config = parsePaperConfig(readCollectionInput(args[1]!));
    if (command === 'run') {
      const count = args[4]!;
      if (
        (count !== 'continuous' && !/^[1-9][0-9]{0,15}$/.test(count)) ||
        !/^[1-9][0-9]{0,9}$/.test(args[5]!)
      )
        throw new Error('INVALID_INPUT');
      options = { maxInputs: count === 'continuous' ? null : Number(count), pollMs: Number(args[5]) };
      validateConsumerOptions(options);
    } else if (command === 'fund-in' || command === 'fund-out') {
      amount = args[4];
      paperAmount(amount, true);
    }
  } catch {
    config = undefined;
    console.error('INVALID_PAPER_INPUT');
    process.exitCode = 2;
  }
  if (config) {
    let source: BatchJournal | undefined,
      journal: PaperJournal | undefined,
      stoppedBy: 'SIGINT' | 'SIGTERM' | undefined;
    const controller = new AbortController();
    const interrupt = () => {
      stoppedBy ??= 'SIGINT';
      controller.abort();
    };
    const terminate = () => {
      stoppedBy ??= 'SIGTERM';
      controller.abort();
    };
    try {
      source = new BatchJournal(args[2]!, { readOnly: true });
      journal = new PaperJournal(args[3]!, config, source);
      if (args[0] === 'run') {
        process.on('SIGINT', interrupt);
        process.on('SIGTERM', terminate);
        const summary = await consumePaper(source, journal, options!, controller.signal);
        console.log(JSON.stringify({ mode: 'REFERENCE_PAPER', summary, snapshot: journal.snapshot() }));
        process.exitCode =
          stoppedBy === 'SIGINT' ? 130 : stoppedBy === 'SIGTERM' ? 143 : summary.rejected === 0 ? 0 : 1;
      } else {
        if (args[0] === 'stop') journal.stop(Date.now());
        if (args[0] === 'fund-in' || args[0] === 'fund-out')
          journal.fund(args[0] === 'fund-in' ? 'in' : 'out', amount!, Date.now());
        const snapshot = journal.snapshot(),
          at = Math.max(Date.now(), snapshot.state.clock);
        console.log(
          JSON.stringify({
            mode: 'REFERENCE_PAPER',
            snapshot,
            currentNav6: paperNav(snapshot.state, at),
            currentUnitValue: paperReturn(snapshot.state, at),
          }),
        );
      }
    } catch (error) {
      const code =
        error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
          ? error.message
          : 'PAPER_OR_JOURNAL_FAILED';
      console.error(
        JSON.stringify({
          error: code,
          ...(code === 'INSUFFICIENT_CASH' && journal
            ? { maxWithdraw6: journal.snapshot().state.cash6 }
            : {}),
        }),
      );
      process.exitCode = 1;
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      journal?.close();
      source?.close();
    }
  }
}
