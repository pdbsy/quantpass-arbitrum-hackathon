import { buildApp } from './app.ts';
import type { M3ChainRuntime } from './m3-chain-runtime.ts';

type BuildAppOptions = Parameters<typeof buildApp>[0];

export async function buildM3App(
  options: Omit<BuildAppOptions, 'chainRuntime'> & {
    readonly chainRuntime?: M3ChainRuntime;
    readonly chainRuntimes?: readonly M3ChainRuntime[];
  },
) {
  if (options.chainRuntime && options.chainRuntimes) throw new Error('INVALID_CHAIN_RUNTIME_SET');
  if (options.chainRuntimes && options.chainRuntimes.length === 0)
    throw new Error('INVALID_CHAIN_RUNTIME_SET');
  const runtimes = options.chainRuntimes ?? (options.chainRuntime ? [options.chainRuntime] : []);
  const appOptions = {
    dbPath: options.dbPath,
    env: options.env,
    origin: options.origin,
    ...(options.webRoot === undefined ? {} : { webRoot: options.webRoot }),
  };
  if (runtimes.length <= 1)
    return buildApp({
      ...appOptions,
      ...(runtimes[0] === undefined ? {} : { chainRuntime: runtimes[0] }),
    });

  const identities = new Set<string>();
  for (const runtime of runtimes) {
    const identity = `${runtime.manifest.chainId}:${runtime.manifest.contractAddress.toLowerCase()}`;
    if (identities.has(identity)) throw new Error('DUPLICATE_CHAIN_RUNTIME');
    identities.add(identity);
  }
  const compositeRuntime = {
    chainEvidence: runtimes.map((runtime) => runtime.chainEvidence),
    close: () => {
      for (const runtime of runtimes) runtime.close();
    },
  } as unknown as M3ChainRuntime;
  return buildApp({ ...appOptions, chainRuntime: compositeRuntime });
}
