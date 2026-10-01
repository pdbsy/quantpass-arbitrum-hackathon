import { captureReference, MarketJournal } from '../../packages/market-data/src/capture.ts';
import { validateSelection } from '../../packages/market-data/src/robinhood.ts';
import type { Selection } from '../../packages/market-data/src/robinhood.ts';

const usage =
  'REFERENCE_ONLY: capture-market.ts SYMBOL CHAIN_ID CONTRACT_ADDRESS MAX_AGE_MS DATABASE_PATH (one read-only observation; no orders)';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log(usage);
else {
  let selection: Selection | undefined;
  const maxAgeMs = Number(args[3]);
  try {
    if (
      args.length !== 5 ||
      !/^(4663|46630)$/.test(args[1]!) ||
      !/^[1-9][0-9]*$/.test(args[3]!) ||
      !Number.isSafeInteger(maxAgeMs) ||
      !args[4]
    )
      throw new Error('INVALID_ARGUMENTS');
    selection = validateSelection({
      symbol: args[0]!,
      chainId: Number(args[1]) as 4663 | 46630,
      contractAddress: args[2]!,
    });
  } catch {
    console.error(usage);
    process.exitCode = 2;
  }
  if (selection) {
    let journal: MarketJournal | undefined;
    try {
      // Open before fetching so an unavailable evidence destination fails without network reads.
      journal = new MarketJournal(args[4]!);
      const captured = await captureReference(selection, maxAgeMs);
      const id = journal.append(captured);
      console.log(
        JSON.stringify(
          {
            id,
            status: captured.status,
            reason: captured.reason,
            observation: captured.observation,
            sources: captured.sources.map(({ url, receivedAt, sha256 }) => ({ url, receivedAt, sha256 })),
          },
          null,
          2,
        ),
      );
      if (captured.status !== 'ACCEPTED') process.exitCode = 1;
    } catch {
      console.error('CAPTURE_OR_JOURNAL_FAILED');
      process.exitCode = 1;
    } finally {
      journal?.close();
    }
  }
}
