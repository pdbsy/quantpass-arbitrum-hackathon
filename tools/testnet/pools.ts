import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, loadReferenceAdmission } from './preflight.ts';
import { JsonRpcClient } from '../../packages/chain-adapter/src/rpc.ts';
import { asBlockHash } from '../../packages/chain-adapter/src/types.ts';
import { validateDeploymentManifest } from '../../packages/chain-adapter/src/manifest.ts';
import { validateTradingInventory } from '../../packages/testnet/src/trading-inventory.ts';
import { evidenceHash } from '../../packages/testnet/src/executor-plan.ts';
import { prepareVerifiedPools, type PoolBudget } from '../../packages/testnet/src/pool-preparation.ts';
export async function poolsCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'AlphaForge read-only pool preparation: --prepare <pool-worksheet.json> <deployment-evidence.json> <evidence-digest> <reference.json> <reference-digest> <new-output.json>. Actual canonical read-only RPC and official quotes; no signing or broadcast.',
    );
    return 0;
  }
  if (args.length !== 7 || args[0] !== '--prepare' || args.slice(1).some((v) => v.startsWith('--'))) {
    console.error('POOL_PREPARATION_USAGE');
    return 2;
  }
  try {
    const w = readJson(resolve(args[1]!)) as {
      schemaVersion: number;
      chainId: number;
      owner: string;
      seeder: string;
      pools: PoolBudget[];
    };
    if (
      !w ||
      Object.keys(w).length !== 5 ||
      Object.keys(w).some((k) => !['schemaVersion', 'chainId', 'owner', 'seeder', 'pools'].includes(k)) ||
      w.schemaVersion !== 1 ||
      w.chainId !== 46630 ||
      !Array.isArray(w.pools)
    )
      throw new Error();
    const evidence = readJson(resolve(args[2]!)) as {
      chainId: number;
      scope: string;
      receipts: { address: string }[];
      vaults: { manifest: { manifestDigest: string }; inventory: unknown; inventoryDigest: string }[];
      operatorLiquidity: { owner: string; seeder: string; runtimeBytecodeHash: string };
    };
    if (
      evidenceHash(evidence) !== args[3] ||
      evidence.chainId !== 46630 ||
      evidence.scope !== 'TEST_SUBSTITUTES_ONLY' ||
      !evidence.vaults.length ||
      w.owner !== evidence.operatorLiquidity.owner ||
      w.seeder !== evidence.operatorLiquidity.seeder
    )
      throw new Error();
    const v = evidence.vaults[0]!,
      manifest = validateDeploymentManifest(v.manifest, {
        environment: 'robinhood-chain-testnet',
        chainId: 46630,
        manifestDigest: asBlockHash(v.manifest.manifestDigest),
      }),
      inventory = validateTradingInventory(v.inventory, v.inventoryDigest, manifest.manifestDigest);
    const reference = loadReferenceAdmission(resolve(args[4]!), args[5]!),
      endpoint = env.AF_TESTNET_RPC_URL;
    if (!endpoint) throw new Error();
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
    const result = await prepareVerifiedPools({
      rpc: new JsonRpcClient([endpoint]),
      manifest,
      inventory,
      owner: w.owner,
      seeder: w.seeder,
      seederCodeHash: evidence.operatorLiquidity.runtimeBytecodeHash,
      terms: reference.terms,
      budgets: w.pools,
    });
    writeFileSync(
      resolve(args[6]!),
      JSON.stringify(
        {
          ...result,
          referenceDigest: args[5],
          deploymentEvidenceDigest: args[3],
          preparedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log('ALPHAFORGE_POOLS_UNSIGNED_PREPARED');
    return 0;
  } catch {
    console.error('POOL_PREPARATION_REJECTED');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await poolsCli(process.argv.slice(2), process.env);
