import { createHash } from 'node:crypto';
import { keccak256 } from 'ethers';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, readRegularBytes, loadReferenceAdmission } from './preflight.ts';
import {
  prepareDeploymentPlan,
  type DeploymentArtifact,
} from '../../packages/testnet/src/deployment-plan.ts';
import { validateV3Artifact } from './v3-artifacts.mjs';

export function compiledArtifacts(root: string) {
  const names = {
    AlphaForgeTestUSDC: 'AlphaForgeTestAsset.sol',
    StrategyPass: 'StrategyPass.sol',
    AlphaForgeTestStock: 'AlphaForgeTestStock.sol',
    AlphaForgeTestReferenceFeed: 'AlphaForgeTestStock.sol',
    AlphaForgeTradingVault: 'AlphaForgeTradingVault.sol',
    AlphaForgeLiquiditySeeder: 'AlphaForgeLiquiditySeeder.sol',
    PassLocker: 'PassLocker.sol',
  };
  const artifacts: Record<string, DeploymentArtifact> = {};
  for (const [name, source] of Object.entries(names)) {
    const bytes = readRegularBytes(
        join(root, '.checks/af-chain01/out', source, name + '.json'),
        16 * 1024 * 1024,
      ),
      a = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      a.metadata?.compiler?.version !== '0.8.31+commit.fd3a2265' ||
      a.metadata?.settings?.optimizer?.enabled !== false ||
      a.metadata?.settings?.evmVersion !== 'paris' ||
      Object.keys(a.bytecode?.linkReferences ?? {}).length !== 0
    )
      throw new Error('DEPLOYMENT_COMPILER');
    // Every compiler source digest must match the current checked source, including the pinned OZ graph.
    for (const [file, record] of Object.entries(
      a.metadata.sources as Record<string, { keccak256: string }>,
    )) {
      const relative = file.startsWith('@openzeppelin/contracts/') ? 'node_modules/' + file : file;
      if (relative.includes('..') || relative.startsWith('/')) throw new Error('DEPLOYMENT_SOURCE');
      if (
        record.keccak256 !== keccak256(readRegularBytes(join(root, 'contracts', relative), 4 * 1024 * 1024))
      )
        throw new Error('DEPLOYMENT_SOURCE');
    }
    artifacts[name] = {
      abi: a.abi,
      bytecode: a.bytecode.object,
      runtimeBytes: (a.deployedBytecode.object.length - 2) / 2,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  const vendor = join(root, 'deploy/testnet/vendor'),
    manifest = readJson(join(vendor, 'manifest.json')) as {
      artifacts: { file: string; contractName: string }[];
    };
  for (const entry of manifest.artifacts) {
    const raw = readFileSync(join(vendor, entry.file), 'utf8'),
      a = validateV3Artifact(entry, raw);
    artifacts[entry.contractName] = {
      abi: a.abi,
      bytecode: a.bytecode,
      runtimeBytes: (a.deployedBytecode.length - 2) / 2,
      sha256: createHash('sha256').update(raw).digest('hex'),
    };
  }
  return artifacts;
}
export async function deploymentCli(args: readonly string[]): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'AlphaForge unsigned Testnet deployment bundle: --prepare <worksheet.json> <reference.json> <reference-digest> <new-output.json>. Requires qualified local artifacts; no RPC, key, signing or broadcast.',
    );
    return 0;
  }
  if (args.length !== 5 || args[0] !== '--prepare' || args.slice(1).some((v) => v.startsWith('--'))) {
    console.error('DEPLOYMENT_USAGE');
    return 2;
  }
  try {
    const root = resolve(fileURLToPath(new URL('../..', import.meta.url))),
      reference = loadReferenceAdmission(resolve(args[2]!), args[3]!);
    const plan = await prepareDeploymentPlan(
      readJson(resolve(args[1]!)),
      reference.terms,
      compiledArtifacts(root),
    );
    writeFileSync(resolve(args[4]!), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('ALPHAFORGE_TESTNET_UNSIGNED_BUNDLE_CREATED');
    return 0;
  } catch {
    console.error('DEPLOYMENT_PREPARATION_REJECTED');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await deploymentCli(process.argv.slice(2));
