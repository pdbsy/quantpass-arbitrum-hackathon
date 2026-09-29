import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../../apps/server/src/app.ts';
import { emaTargets } from '../../packages/automata/src/ema-strategy.ts';
import { StrategyClient } from './strategy-client.mjs';
import { DecisionJournal } from './decision-journal.mjs';
import { EMA_RUN_ID, provisionEma, advanceEma } from './ema-demo-runtime.mjs';
const root = new URL('../../', import.meta.url);
const args = process.argv.slice(2);
if (args.some((a) => a !== '--fast')) throw new Error('Only --fast is supported');
await mkdir(new URL('.data/', root), { recursive: true });
const { app } = await buildApp({
  dbPath: fileURLToPath(new URL('.data/qinfra-ema.sqlite', root)),
  env: { QP_MODE: 'local', QP_ADAPTER: 'mock' },
  origin: 'http://127.0.0.1:4180',
  automataReplay: false,
  webRoot: fileURLToPath(new URL('apps/web/dist/', root)),
});
let journal,
  closed = false;
const shutdown = new AbortController();
async function close() {
  if (closed) return;
  closed = true;
  shutdown.abort();
  await app.close();
  journal?.close();
}
try {
  await app.listen({ host: '127.0.0.1', port: 4180 });
  journal = new DecisionJournal(fileURLToPath(new URL('.data/qinfra-ema-outbox.sqlite', root)));
  const client = new StrategyClient({
    owner: 'alice',
    runId: EMA_RUN_ID,
    targets: {},
    selectTargets: emaTargets,
    journal,
  });
  await client.connect();
  await provisionEma(client);
  console.log('AlphaForge LOCAL/MOCK EMA 15/30 synthetic-period demo: http://127.0.0.1:4180/automata.html');
  console.log('Select Alice. Existing state resumes; stopping the process does not claim liquidation.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown.abort());
  let done = false;
  for (let attempts = 0; attempts < 1000 && !shutdown.signal.aborted; attempts++) {
    try {
      if ((await advanceEma(client)) === 'finished') {
        done = true;
        break;
      }
    } catch (error) {
      if (!client.pending) throw error;
      console.log('Pending decision retained; retrying identical envelope.');
    }
    await delay(args.includes('--fast') ? 20 : 1000, undefined, { signal: shutdown.signal }).catch((e) => {
      if (e.name !== 'AbortError') throw e;
    });
  }
  if (shutdown.signal.aborted) await close();
  else if (!done) throw new Error('Demo iteration bound reached; inspect persistent run and outbox');
  else {
    console.log('EMA demo complete; server remains available for inspection.');
    shutdown.signal.addEventListener(
      'abort',
      () => {
        void close();
      },
      { once: true },
    );
  }
} catch (error) {
  await close();
  console.error(error.message);
  process.exitCode = 1;
}
