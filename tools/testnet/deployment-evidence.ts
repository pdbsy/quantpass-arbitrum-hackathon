import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, loadReferenceAdmission } from './preflight.ts';
import { compiledArtifacts } from './deployment.ts';
import {
  prepareDeploymentPlan,
  parseDeploymentWorksheet,
} from '../../packages/testnet/src/deployment-plan.ts';
import { verifyTestnetDeployment } from '../../packages/testnet/src/deployment-evidence.ts';
import { JsonRpcClient } from '../../packages/chain-adapter/src/rpc.ts';

export async function deploymentEvidenceCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'AlphaForge read-only Testnet deployment receipt verification: --verify <worksheet.json> <reference.json> <reference-digest> <receipt-hashes.json> <new-evidence.json>. No signing/broadcast; AF_TESTNET_RPC_URL required.',
    );
    return 0;
  }
  if (args.length !== 6 || args[0] !== '--verify' || args.slice(1).some((v) => v.startsWith('--'))) {
    console.error('DEPLOYMENT_EVIDENCE_USAGE');
    return 2;
  }
  try {
    const reference = loadReferenceAdmission(resolve(args[2]!), args[3]!),
      worksheet = parseDeploymentWorksheet(readJson(resolve(args[1]!))),
      root = resolve(fileURLToPath(new URL('../..', import.meta.url))),
      plan = await prepareDeploymentPlan(worksheet, reference.terms, compiledArtifacts(root));
    const input = readJson(resolve(args[4]!)) as { creationHashes: string[]; poolCreationHashes: string[] };
    if (
      !input ||
      Object.keys(input).length !== 2 ||
      !Array.isArray(input.creationHashes) ||
      !Array.isArray(input.poolCreationHashes) ||
      !env.AF_TESTNET_RPC_URL
    )
      throw new Error();
    const result = await verifyTestnetDeployment(
      new JsonRpcClient([env.AF_TESTNET_RPC_URL]),
      plan,
      input.creationHashes,
      input.poolCreationHashes,
      reference.terms,
      worksheet.maxPriceAge,
    );
    writeFileSync(
      resolve(args[5]!),
      JSON.stringify(
        {
          ...result,
          verifiedAt: new Date().toISOString(),
          worksheetDigest: plan.worksheetDigest,
          referenceDigest: args[3],
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log('ALPHAFORGE_TESTNET_CREATION_EVIDENCE_VERIFIED');
    return 0;
  } catch {
    console.error('DEPLOYMENT_EVIDENCE_REJECTED');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await deploymentEvidenceCli(process.argv.slice(2), process.env);
