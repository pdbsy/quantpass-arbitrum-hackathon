import { testnetNetworkIdentity } from '../../packages/testnet/src/network-identity.ts';
import { evidenceHash } from '../../packages/testnet/src/executor-plan.ts';
import { qualifyExecutorDeployments } from '../../apps/server/src/testnet-executor-service.ts';
import { realpathSync } from 'node:fs';
import { readRegularBytes } from '../../packages/testnet/src/bounded-file.ts';
export { readRegularBytes } from '../../packages/testnet/src/bounded-file.ts';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadTestnetDeployments,
  parseTestnetServerConfig,
} from '../../packages/testnet/src/server-config.ts';
import { parsePublicTestnetConfig } from '../../packages/testnet/src/public-config.ts';
import { parseExecutorConfig, parseReferenceAdmission } from '../../packages/testnet/src/execution-config.ts';
import { loadTradingDeployments } from '../../packages/testnet/src/deployments.ts';
import { createHash } from 'node:crypto';

export function readJson(path: string): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(path)));
}

export function loadReferenceAdmission(file: string, digest: string, now = Date.now()) {
  const input = readJson(file),
    terms = parseReferenceAdmission(input, digest, now);
  const sources = (input as { sources: { archiveFile: string; sha256: string }[] }).sources;
  for (const source of sources)
    if (
      createHash('sha256')
        .update(readRegularBytes(join(dirname(file), source.archiveFile), 4 * 1024 * 1024))
        .digest('hex') !== source.sha256
    )
      throw new Error('REFERENCE_ARCHIVE_DIGEST');
  return { input, terms };
}

export async function testnetPreflight(
  configFile: string,
  env: Readonly<Record<string, string | undefined>>,
) {
  const input = readJson(configFile);
  const profile = (input as { profile?: unknown })?.profile;
  if (profile === 'PUBLIC_TESTNET' || profile === 'RESTRICTED_TESTNET_EXECUTOR') {
    const config =
      profile === 'PUBLIC_TESTNET' ? parsePublicTestnetConfig(input) : parseExecutorConfig(input);
    const directory = realpathSync(dirname(resolve(configFile)));
    const deployments = await loadTradingDeployments(config.vaults, async (name) =>
      readJson(join(directory, name)),
    );
    if (config.profile === 'RESTRICTED_TESTNET_EXECUTOR') {
      const admission = loadReferenceAdmission(join(directory, config.referenceFile), config.referenceDigest);
      qualifyExecutorDeployments({ config, deployments, terms: admission.terms });
    }
    const configurationDigest = evidenceHash(config);
    const network = testnetNetworkIdentity({
      chainId: config.chainId,
      profile: config.profile,
      configurationDigest,
      deployments,
    });
    return Object.freeze({
      schemaVersion: 1,
      configuration: 'VALID',
      configurationDigest,
      networkDigest: network.digest,
      networkIdentity: network.descriptor,
      readiness: deployments.length ? 'BLOCKED_PENDING_CANONICAL_CHAIN_INPUTS' : 'NOT_CONFIGURED',
      mainnet: 'DISABLED_UNCONFIGURED',
      deploymentReceipts: 'NOT_RUN',
      rpcCapabilities: { required: network.descriptor.rpcRequirements, qualification: 'NOT_RUN' },
      referenceAdmission:
        config.profile === 'RESTRICTED_TESTNET_EXECUTOR'
          ? 'ARCHIVES_ADMITTED_OFFLINE_ONLY'
          : 'EXECUTOR_INPUT_REQUIRED',
      requiredOperationalInputs: [
        'PROTECTED_HISTORICAL_CANONICAL_RPC',
        'DEPLOYMENT_RECEIPTS_AND_INVENTORY',
        'REVIEWED_THREE_SOURCE_REFERENCES',
        'OWNER_GRANTS_AND_FINITE_BUDGETS',
        'EXTERNAL_ACCEPTANCE',
      ],
      ...(config.profile === 'RESTRICTED_TESTNET_EXECUTOR'
        ? {
            unsignedExecutorPolicy: {
              minOrderUsdc: config.minOrderUsdc,
              deadlineSeconds: config.deadlineSeconds,
              gas: config.gas,
              maxTotalGasCostWei: config.maxTotalGasCostWei,
            },
          }
        : {}),
      profile: config.profile,
      chainId: 46630,
      deploymentEvidence: deployments.length ? 'MANIFEST_VALID_OFFLINE_ONLY' : 'NOT_DEPLOYED',
      configuredVaults: deployments.length,
      rpcVerification: 'NOT_RUN',
      walletSignatures: 'NOT_RUN',
      orderExecution: 'DISABLED',
      serverStarted: false,
      dataCreated: false,
    });
  }
  const config = parseTestnetServerConfig(input);
  const directory = realpathSync(dirname(resolve(configFile)));
  const endpoint = env.AF_TESTNET_RPC_URL;
  const deployments = await loadTestnetDeployments(config, endpoint ? [endpoint] : [], async (file) =>
    readJson(join(directory, file)),
  );
  return Object.freeze({
    schemaVersion: 1,
    configuration: 'VALID',
    profile: config.profile,
    chainId: config.chainId,
    deploymentEvidence: config.vaults.length ? 'MANIFEST_VALID_OFFLINE_ONLY' : 'NOT_DEPLOYED',
    configuredVaults: deployments.filter((deployment) => deployment.deploymentStatus === 'DEPLOYED').length,
    rpcVerification: 'NOT_RUN',
    walletSignatures: 'NOT_RUN',
    orderExecution: 'DISABLED',
    serverStarted: false,
    dataCreated: false,
  });
}

export async function preflightCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log('AlphaForge offline Testnet configuration preflight: testnet:preflight <operator.json>');
    return 0;
  }
  if (args.length !== 1 || !args[0] || args[0].startsWith('--')) {
    console.error('TESTNET_PREFLIGHT_USAGE');
    return 2;
  }
  try {
    console.log(JSON.stringify(await testnetPreflight(args[0], env)));
    return 0;
  } catch {
    console.error('TESTNET_PREFLIGHT_REJECTED');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await preflightCli(process.argv.slice(2), process.env);
