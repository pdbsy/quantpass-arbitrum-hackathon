import { lstatSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Interface } from 'ethers';
import { readRegularBytes } from '../../packages/testnet/src/bounded-file.ts';
import type { LaunchMarketManifest } from '../../packages/launch-market/src/types.ts';
import { RpcMarketChain } from '../../apps/server/src/launch-market-adapters/rpc-chain.ts';
import {
  VerifiedStockReference,
  prepareStockReferenceUpdate,
} from '../../apps/server/src/launch-market-adapters/stock-reference.ts';

/** Fetch source-confirmed market data and prepare unsigned test-chain keeper actions. No write RPC. */
export async function stockReferenceCli(args: readonly string[]): Promise<number> {
  if (args.length !== 5 || !['TSLA', 'AMZN'].includes(args[3]!)) {
    console.error(
      'Usage: stock-reference.ts VERIFIED_MANIFEST.json HTTPS_RPC PRIVATE_DATA_CREDENTIALS.json TSLA|AMZN NEW_OUTPUT.json',
    );
    return 2;
  }
  let chain: RpcMarketChain | null = null;
  try {
    const [manifestFile, rpc, credentialFile, strategy, output] = args as [
      string,
      string,
      string,
      'TSLA' | 'AMZN',
      string,
    ];
    const path = resolve(credentialFile),
      stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.() ||
      realpathSync(path) !== path
    )
      throw new Error('PRIVATE_DATA_CREDENTIALS_REQUIRED');
    const credentials = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(path, 4096)),
    );
    if (typeof credentials.apiKey !== 'string' || typeof credentials.apiSecret !== 'string')
      throw new Error('STOCK_DATA_NOT_CONFIGURED');
    const manifest = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(resolve(manifestFile))),
    ) as LaunchMarketManifest;
    chain = new RpcMarketChain(manifest, rpc);
    await chain.initialize();
    if (!manifest.vaultFactory) throw new Error('VAULT_NOT_CONFIGURED');
    const iface = new Interface([
      'function strategy(uint8) view returns((address creator,address pass,address usdc,address targetStock,address otherStock,address stockReserve,address referenceFeed,bytes32 strategyRef,uint32 maxPriceAge))',
    ]);
    const head = await chain.head(),
      config = (
        await chain.read(manifest.vaultFactory, iface, 'strategy', [strategy === 'TSLA' ? 0 : 1], head)
      )[0];
    if (
      String(config.pass).toLowerCase() !== manifest.strategies[strategy].pass.toLowerCase() ||
      String(config.usdc).toLowerCase() !== manifest.usdc.toLowerCase() ||
      Number(config.maxPriceAge) > 60
    )
      throw new Error('STRATEGY_REFERENCE_IDENTITY_MISMATCH');
    const feed = new Interface([
        'function keeper() view returns(address)',
        'function referenceIdentity() view returns(bytes32)',
      ]),
      keeper = (await chain.read(String(config.referenceFeed), feed, 'keeper', [], head))[0],
      referenceIdentity = (
        await chain.read(String(config.referenceFeed), feed, 'referenceIdentity', [], head)
      )[0];
    const reference = await new VerifiedStockReference(credentials).read(strategy),
      now = Math.floor(Date.now() / 1000);
    await chain.assertCanonical(head);
    const unsigned = prepareStockReferenceUpdate(String(config.referenceFeed), reference, now);
    await writeFile(
      resolve(output),
      JSON.stringify(
        {
          ...unsigned,
          reference,
          caller: String(keeper),
          referenceIdentity: String(referenceIdentity),
          verification:
            'Check actual feed keeper and state before signing; never sign expired references or fabricate a regular session.',
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    console.log(
      'Unsigned test-stock reference prepared; no signature, brokerage order or chain broadcast performed.',
    );
    return 0;
  } catch {
    console.error('STOCK_REFERENCE_PREPARATION_REJECTED');
    return 1;
  } finally {
    chain?.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname))
  process.exitCode = await stockReferenceCli(process.argv.slice(2));
