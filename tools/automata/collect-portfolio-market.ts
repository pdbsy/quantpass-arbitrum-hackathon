import { BatchJournal } from '../../packages/market-data/src/batch-journal.ts';
import {
  collectReferenceBatches,
  parseBatchCollectionConfig,
} from '../../packages/market-data/src/batch-continuous.ts';
import { readCollectionInput } from './collection-input.ts';
const usage =
  'REFERENCE_ONLY: collect-portfolio-market.ts CONFIG_JSON DATABASE_PATH (1..3 canonical sources, explicit batch policy, no orders or credentials)';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log(usage);
else if (args.length !== 2) {
  console.error(usage);
  process.exitCode = 2;
} else {
  let config: ReturnType<typeof parseBatchCollectionConfig> | undefined;
  try {
    config = parseBatchCollectionConfig(readCollectionInput(args[0]!));
  } catch {
    console.error('INVALID_COLLECTION_INPUT');
    process.exitCode = 2;
  }
  if (config) {
    let journal: BatchJournal | undefined;
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
      journal = new BatchJournal(args[1]!);
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', terminate);
      const result = await collectReferenceBatches(config, journal, fetch, Date.now, controller.signal);
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
