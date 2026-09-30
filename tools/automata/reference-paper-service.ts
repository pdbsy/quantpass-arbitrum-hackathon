import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCollectionInput } from './collection-input.ts';
import { readConfig } from '../../packages/config/src/index.ts';
import {
  ReferencePaperService,
  parsePaperServiceConfig,
} from '../../packages/automata/src/reference-paper-service.ts';
import { buildApp } from '../../apps/server/src/app.ts';
const usage =
  'LOCAL REFERENCE_PAPER only: reference-paper-service.ts serve CONFIG DATA_DIRECTORY LOOPBACK_PORT; no signing, broadcast, chain execution or real funds';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log(usage);
else {
  let runtime: ReferencePaperService | undefined,
    app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
  try {
    if (args.length !== 4 || args[0] !== 'serve' || !/^([1-9][0-9]{3,4})$/.test(args[3]!))
      throw new Error('INVALID_PAPER_SERVICE_INPUT');
    const port = Number(args[3]);
    if (port < 1024 || port > 65535) throw new Error('INVALID_PAPER_SERVICE_INPUT');
    readConfig(process.env);
    const config = parsePaperServiceConfig(readCollectionInput(args[1]!));
    if (config.sourceMode !== 'OFFICIAL_REFERENCE') throw new Error('PAPER_FIXTURE_CLI_CLOSED');
    const root = resolve(args[2]!),
      origin = 'http://127.0.0.1:' + port;
    runtime = new ReferencePaperService(root, config);
    const result = await buildApp({
      dbPath: join(root, 'session.sqlite'),
      env: process.env,
      origin,
      referencePaper: runtime,
      referencePaperOnly: true,
      webRoot: fileURLToPath(new URL('../../apps/web/dist/', import.meta.url)),
    });
    app = result.app;
    await app.listen({ host: '127.0.0.1', port });
    runtime.start();
    console.log('AlphaForge REFERENCE_PAPER: ' + origin + '/reference-paper.html');
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        // Graceful process exit is distinct from an explicit owner portfolio stop.
        void app!.close().catch(() => {
          process.exitCode = 1;
        });
      });
  } catch (error) {
    if (app) await app.close();
    else await runtime?.close();
    console.error(
      error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
        ? error.message
        : 'PAPER_SERVICE_START_FAILED',
    );
    process.exitCode = 1;
  }
}
