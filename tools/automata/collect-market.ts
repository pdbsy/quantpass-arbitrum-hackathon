import { readCollectionInput } from './collection-input.ts';
import { MarketJournal } from '../../packages/market-data/src/capture.ts';
import { collectReferences, parseContinuousConfig } from '../../packages/market-data/src/continuous.ts';
const usage =
  'REFERENCE_ONLY: collect-market.ts CONFIG_JSON DATABASE_PATH (explicit sampling policy, no orders or executor credentials)';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log(usage);
else if (args.length !== 2) {
  console.error(usage);
  process.exitCode = 2;
} else {
  let config: ReturnType<typeof parseContinuousConfig> | undefined;
  try {
    config = parseContinuousConfig(readCollectionInput(args[0]!));
  } catch {
    console.error('INVALID_COLLECTION_INPUT');
    process.exitCode = 2;
  }
  if (config) {
    let journal: MarketJournal | undefined;
    const controller = new AbortController();
    let stoppedBy: 'SIGINT' | 'SIGTERM' | undefined;
    const interrupt = () => {
      stoppedBy ??= 'SIGINT';
      controller.abort();
    };
    const terminate = () => {
      stoppedBy ??= 'SIGTERM';
      controller.abort();
    };
    try {
      journal = new MarketJournal(args[1]!);
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', terminate);
      const result = await collectReferences(config, journal, fetch, Date.now, controller.signal);
      console.log(JSON.stringify(result));
      process.exitCode =
        stoppedBy === 'SIGINT'
          ? 130
          : stoppedBy === 'SIGTERM'
            ? 143
            : result.status === 'COMPLETED' && result.rejected === 0
              ? 0
              : 1;
    } catch {
      console.error('COLLECTION_OR_JOURNAL_FAILED');
      process.exitCode = 1;
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      journal?.close();
    }
  }
}
