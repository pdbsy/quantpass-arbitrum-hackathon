import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './preflight.ts';
import { startPublicTestnetServer } from '../../apps/server/src/testnet-startup.ts';

export async function serverCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'AlphaForge public Testnet server: --serve <operator.json> <loopback-port>; HTTPS proxy required; no signer',
    );
    return 0;
  }
  if (
    args.length !== 3 ||
    args[0] !== '--serve' ||
    !args[1] ||
    args[1].startsWith('--') ||
    !/^[1-9][0-9]{0,4}$/.test(args[2] ?? '')
  ) {
    console.error('PUBLIC_TESTNET_USAGE');
    return 2;
  }
  try {
    const file = resolve(args[1]),
      port = Number(args[2]);
    if (port > 65535) throw new Error();
    const server = await startPublicTestnetServer({
      configuration: readJson(file),
      manifestReader: async (name) => readJson(join(dirname(file), name)),
      port,
      periodicSync: true,
      webRoot: resolve(fileURLToPath(new URL('../../apps/web/dist', import.meta.url))),
      ...(env.AF_TESTNET_RPC_URL ? { rpcEndpoint: env.AF_TESTNET_RPC_URL } : {}),
    });
    const shutdown = () => {
      void server.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    console.log('ALPHAFORGE_PUBLIC_TESTNET_LOOPBACK_READY; owner wallet only; no signer');
    return 0;
  } catch {
    console.error('PUBLIC_TESTNET_STARTUP_REJECTED');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await serverCli(process.argv.slice(2), process.env);
