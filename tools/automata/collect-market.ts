import { openSync, closeSync, fstatSync, readSync, lstatSync, constants } from 'node:fs';
import { resolve } from 'node:path';
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
    const input = resolve(args[0]!);
    const before = lstatSync(input);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 131072) throw new Error();
    const fd = openSync(
      input,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error();
      const bytes = Buffer.alloc(131073);
      let count = 0;
      while (count < bytes.length) {
        const n = readSync(fd, bytes, count, bytes.length - count, null);
        if (n === 0) break;
        count += n;
      }
      if (count > 131072) throw new Error();
      config = parseContinuousConfig(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count))),
      );
    } finally {
      closeSync(fd);
    }
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
