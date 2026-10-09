import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, Interface, keccak256 } from 'ethers';
import { readRegularBytes } from '../../packages/testnet/src/bounded-file.ts';
import { ROBINHOOD_CHAIN_TESTNET } from '../../packages/robinhood-chain/src/network.ts';
import { prepareDeployment, type DeploymentInputs } from './prepare.ts';

const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const gasInfo = new Interface(['function getGasAccountingParams() view returns(uint256,uint256,uint256)']);
const readMethods = new Set([
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getBalance',
  'eth_getTransactionCount',
  'eth_getCode',
  'eth_gasPrice',
  'eth_call',
  'eth_estimateGas',
]);
export interface TargetPreflightRpc {
  request(method: string, params: readonly unknown[]): Promise<unknown>;
}
export interface TargetPreflightBudget {
  readonly maxGasPerTransactionRaw: string;
  readonly maxFeePerGasRaw: string;
  readonly maxTotalGasCostWei: string;
  readonly minimumRemainingEthRaw: string;
  readonly maxHeadAgeSeconds: number;
}
function fail(code: string): never {
  throw new Error(code);
}
function uint(value: unknown, nonzero = false): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) fail('TARGET_UINT');
  const n = BigInt(value);
  if (n >= 2n ** 256n || (nonzero && n === 0n)) fail('TARGET_UINT');
  return n;
}
function rpcUint(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value))
    fail('TARGET_RPC_RESPONSE');
  return BigInt(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('TARGET_INPUT');
  return value as Record<string, unknown>;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function targetPlanDigest(value: unknown): string {
  return '0x' + createHash('sha256').update(canonical(value)).digest('hex');
}
function json(path: string, maximum = 256 * 1024): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(path, maximum)));
}

/** Exact qualified source graph; compiler artifacts and runtime hashes are different evidence. */
export function qualifyTargetArtifacts(root = repository) {
  const artifacts = [
    ['AlphaForgeTestAsset', 'AlphaForgeTestUSDC'],
    ['StrategyPass', 'StrategyPass'],
    ['AlphaForgePassFactory', 'AlphaForgePassFactory'],
    ['AlphaForgePassPool', 'AlphaForgePassPool'],
    ['AlphaForgeNativeReserve', 'AlphaForgeNativeReserve'],
    ['AlphaForgeMarketRouter', 'AlphaForgeMarketRouter'],
    ['AlphaForgeFairLaunch', 'AlphaForgeFairLaunch'],
    ['AlphaForgeClaimReserve', 'AlphaForgeClaimReserve'],
    ['AlphaForgeStrategyVault', 'AlphaForgeStrategyTestStock'],
    ['AlphaForgeStrategyVault', 'AlphaForgeStrategyReferenceFeed'],
    ['AlphaForgeStrategyVault', 'AlphaForgeStockReserve'],
    ['AlphaForgeStrategyVault', 'AlphaForgeStrategyVaultFactory'],
    ['AlphaForgeStrategyVault', 'AlphaForgeStrategyVault'],
  ] as const;
  const sourceHashes: Record<string, string> = {},
    artifactHashes: Record<string, string> = {};
  for (const [file, name] of artifacts) {
    const bytes = readRegularBytes(
        resolve(root, '.checks/af-chain01/out', file + '.sol', name + '.json'),
        16 * 1024 * 1024,
      ),
      artifact = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))),
      metadata = record(
        typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) : artifact.metadata,
      ),
      settings = record(metadata.settings);
    if (
      record(metadata.compiler).version !== '0.8.31+commit.fd3a2265' ||
      record(settings.optimizer).enabled !== false ||
      (settings.viaIR !== undefined && settings.viaIR !== false) ||
      settings.evmVersion !== 'paris' ||
      Object.keys(record(settings.libraries)).length !== 0
    )
      fail('TARGET_ARTIFACT_COMPILER');
    const expectedSource =
      file === 'AlphaForgeStrategyVault'
        ? `src/launch-vault/${file}.sol`
        : ['AlphaForgeTestAsset', 'StrategyPass'].includes(file)
          ? `src/${file}.sol`
          : `src/market/${file}.sol`;
    const sources = record(metadata.sources),
      compilationTarget = record(settings.compilationTarget);
    if (
      !Object.keys(sources).length ||
      !Object.hasOwn(sources, expectedSource) ||
      Object.keys(compilationTarget).length !== 1 ||
      compilationTarget[expectedSource] !== name
    )
      fail('TARGET_ARTIFACT_SOURCE_GRAPH');
    for (const [path, source] of Object.entries(sources)) {
      if (
        !/^(src\/|node_modules\/@alphaforge\/openzeppelin-pinned\/).+\.sol$/.test(path) ||
        path.split('/').includes('..') ||
        path.includes('\\')
      )
        fail('TARGET_ARTIFACT_SOURCE');
      const content = readRegularBytes(resolve(root, 'contracts', path), 4 * 1024 * 1024);
      if (record(source).keccak256 !== keccak256(content)) fail('TARGET_ARTIFACT_SOURCE');
      sourceHashes[path] = createHash('sha256').update(content).digest('hex');
    }
    for (const [property, maximum] of [
      ['bytecode', 49152],
      ['deployedBytecode', 24576],
    ] as const) {
      const code = record(artifact[property]);
      if (
        typeof code.object !== 'string' ||
        !/^0x(?:[a-fA-F0-9]{2})+$/.test(code.object) ||
        (code.object.length - 2) / 2 > maximum ||
        Object.keys(record(code.linkReferences)).length !== 0
      )
        fail('TARGET_ARTIFACT_CODE');
    }
    artifactHashes[name] = createHash('sha256').update(bytes).digest('hex');
  }
  return {
    artifacts: artifactHashes,
    sources: sourceHashes,
    digest: targetPlanDigest({ artifactHashes, sourceHashes }),
  };
}

/** Official Testnet, read methods only. There is no signer, wallet discovery or broadcast API. */
export function targetReadonlyRpc(endpoint: string, fetcher: typeof fetch = fetch): TargetPreflightRpc {
  if (endpoint !== ROBINHOOD_CHAIN_TESTNET.rpcUrl) fail('TARGET_RPC_ENDPOINT');
  let id = 0;
  return Object.freeze({
    request: async (method: string, params: readonly unknown[]) => {
      if (!readMethods.has(method)) fail('TARGET_RPC_METHOD');
      const requestId = ++id;
      const response = await fetcher(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      });
      if (response.status !== 200 || !response.body) fail('TARGET_RPC_UNAVAILABLE');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 256 * 1024) fail('TARGET_RPC_CAPACITY');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const result = record(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))),
      );
      if (
        result.jsonrpc !== '2.0' ||
        result.id !== requestId ||
        result.error !== undefined ||
        !Object.hasOwn(result, 'result')
      )
        fail('TARGET_RPC_RESPONSE');
      return result.result;
    },
  });
}

/** Observe a public EOA before funding or plan approval; this cannot authorize deployment. */
export async function targetWalletObservation(
  publicAddress: string,
  rpc: TargetPreflightRpc,
  clock = () => Math.floor(Date.now() / 1000),
) {
  const now = clock();
  const owner = getAddress(publicAddress);
  if (owner === '0x0000000000000000000000000000000000000000') fail('TARGET_WALLET_ADDRESS');
  if (!Number.isSafeInteger(now) || now < 0) fail('TARGET_TIME');
  if (rpcUint(await rpc.request('eth_chainId', [])) !== 46630n) fail('TARGET_CHAIN');
  const head = record(await rpc.request('eth_getBlockByNumber', ['latest', false]));
  const height = rpcUint(head.number),
    timestamp = rpcUint(head.timestamp),
    block = '0x' + height.toString(16);
  if (typeof head.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(head.hash)) fail('TARGET_RPC_RESPONSE');
  const [balance, latest, pending, code, fee] = await Promise.all([
    rpc.request('eth_getBalance', [owner, block]),
    rpc.request('eth_getTransactionCount', [owner, 'latest']),
    rpc.request('eth_getTransactionCount', [owner, 'pending']),
    rpc.request('eth_getCode', [owner, block]),
    rpc.request('eth_gasPrice', []),
  ]);
  const value = rpcUint(balance),
    latestNonce = rpcUint(latest),
    pendingNonce = rpcUint(pending),
    gasPrice = rpcUint(fee);
  if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) fail('TARGET_RPC_RESPONSE');
  const [canonicalInput, finalLatest, finalPending] = await Promise.all([
    rpc.request('eth_getBlockByNumber', [block, false]),
    rpc.request('eth_getTransactionCount', [owner, 'latest']),
    rpc.request('eth_getTransactionCount', [owner, 'pending']),
  ]);
  const canonicalHead = record(canonicalInput),
    finalLatestNonce = rpcUint(finalLatest),
    finalPendingNonce = rpcUint(finalPending),
    finalNow = clock();
  if (!Number.isSafeInteger(finalNow) || finalNow < now) fail('TARGET_TIME');
  const reasons = ['APPROVED_DEPLOYMENT_INPUTS_AND_PLAN_REQUIRED'];
  if (value === 0n) reasons.push('FAUCET_FUNDING_REQUIRED');
  if (latestNonce !== pendingNonce) reasons.push('TARGET_NONCE_UNCERTAIN');
  if (latestNonce !== finalLatestNonce || pendingNonce !== finalPendingNonce)
    reasons.push('TARGET_NONCE_CHANGED');
  if (code !== '0x') reasons.push('TARGET_DEPLOYER_NOT_EOA');
  if (canonicalHead.hash !== head.hash || rpcUint(canonicalHead.number) !== height)
    reasons.push('TARGET_REORG');
  if (timestamp > BigInt(finalNow) || BigInt(finalNow) - timestamp > 60n) reasons.push('TARGET_HEAD_STALE');
  return {
    schemaVersion: 1,
    kind: 'ALPHAFORGE_TARGET_PUBLIC_WALLET_READONLY_OBSERVATION',
    status: 'BLOCKED',
    chainId: 46630,
    owner,
    observedAt: new Date(finalNow * 1000).toISOString(),
    blockNumber: height.toString(),
    blockHash: head.hash,
    blockTimestamp: timestamp.toString(),
    nativeBalanceWei: value.toString(),
    latestNonce: finalLatestNonce.toString(),
    pendingNonce: finalPendingNonce.toString(),
    runtimeCodePresent: code !== '0x',
    gasPriceWei: gasPrice.toString(),
    reasons,
    unsignedPlan: 'NOT_APPROVED',
    targetGasEstimate: 'NOT_RUN',
    deployment: 'NOT_RUN',
    signatures: 'NOT_RUN',
    broadcasts: 'NOT_RUN',
    fundingTransactions: 'NOT_RUN',
  };
}

/** A conservative funding envelope is not a target-network estimate of the undeployed graph. */
export async function targetDeploymentPreflight(
  inputPlan: unknown,
  budget: TargetPreflightBudget,
  rpc: TargetPreflightRpc,
  options: { now?: () => number; artifactRoot?: string } = {},
) {
  const supplied = record(inputPlan),
    inputs = record(supplied.inputs) as unknown as DeploymentInputs;
  // The planner rejects zero retained native reserve before any RPC or constructor can consume nonce.
  if (uint(inputs.ethMinimumReserveRaw) === 0n) fail('CONVERSION_READINESS_REQUIRED');
  const expected = await prepareDeployment(inputs);
  if (canonical(supplied) !== canonical(expected)) fail('TARGET_PLAN_MISMATCH');
  const artifactEvidence = qualifyTargetArtifacts(options.artifactRoot ?? repository);
  const perGas = uint(budget.maxGasPerTransactionRaw, true),
    feeCap = uint(budget.maxFeePerGasRaw, true),
    totalGasBudget = uint(budget.maxTotalGasCostWei, true),
    retained = uint(budget.minimumRemainingEthRaw, true);
  if (
    !Number.isSafeInteger(budget.maxHeadAgeSeconds) ||
    budget.maxHeadAgeSeconds < 1 ||
    budget.maxHeadAgeSeconds > 60
  )
    fail('TARGET_HEAD_POLICY');
  const now = options.now?.() ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(now) || now < 0) fail('TARGET_TIME');
  if (rpcUint(await rpc.request('eth_chainId', [])) !== 46630n) fail('TARGET_CHAIN');
  const head = record(await rpc.request('eth_getBlockByNumber', ['latest', false]));
  const height = rpcUint(head.number),
    timestamp = rpcUint(head.timestamp);
  if (typeof head.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(head.hash)) fail('TARGET_RPC_RESPONSE');
  const block = '0x' + height.toString(16),
    deployer = getAddress(inputs.deployer),
    admin = getAddress(inputs.administrator);
  const actions = expected.actions as {
    operation: string;
    caller: string;
    contractAddress: string;
    nonce?: number;
    unsigned: { to: string | null; data: string; value: string } | null;
  }[];
  const deployments = actions.filter((a) => a.unsigned?.to === null),
    executable = actions.filter((a) => a.unsigned !== null);
  if (deployments.some((a) => (a.unsigned!.data.length - 2) / 2 > 49152)) fail('TARGET_INITCODE_SIZE');
  const [latest, pending, pinned, fee, parameters, code, ...balances] = await Promise.all([
    rpc.request('eth_getTransactionCount', [deployer, 'latest']),
    rpc.request('eth_getTransactionCount', [deployer, 'pending']),
    rpc.request('eth_getTransactionCount', [deployer, block]),
    rpc.request('eth_gasPrice', []),
    rpc.request('eth_call', [
      {
        to: '0x000000000000000000000000000000000000006c',
        data: gasInfo.encodeFunctionData('getGasAccountingParams'),
      },
      block,
    ]),
    rpc.request('eth_getCode', [deployer, block]),
    ...[...new Set([deployer, admin])].map((a) => rpc.request('eth_getBalance', [a, block])),
  ]);
  const latestNonce = rpcUint(latest),
    pendingNonce = rpcUint(pending),
    pinnedNonce = rpcUint(pinned),
    gasPrice = rpcUint(fee);
  if (typeof parameters !== 'string') fail('TARGET_RPC_RESPONSE');
  const accounting = gasInfo.decodeFunctionResult('getGasAccountingParams', parameters);
  const txLimit = BigInt(accounting[2]);
  if (txLimit <= 0n || txLimit > 32000000n) fail('TARGET_GAS_ACCOUNTING');
  if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) fail('TARGET_RPC_RESPONSE');
  const actorBalances = Object.fromEntries(
    [...new Set([deployer, admin])].map((a, i) => [a, rpcUint(balances[i]).toString()]),
  );
  const administratorCode = admin === deployer ? code : await rpc.request('eth_getCode', [admin, block]);
  if (typeof administratorCode !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(administratorCode))
    fail('TARGET_RPC_RESPONSE');
  const administratorNonces =
    admin === deployer
      ? [latestNonce, pendingNonce, pinnedNonce]
      : await Promise.all([
          rpc.request('eth_getTransactionCount', [admin, 'latest']).then(rpcUint),
          rpc.request('eth_getTransactionCount', [admin, 'pending']).then(rpcUint),
          rpc.request('eth_getTransactionCount', [admin, block]).then(rpcUint),
        ]);
  const occupied: string[] = [];
  for (const action of deployments) {
    const existing = await rpc.request('eth_getCode', [action.contractAddress, block]);
    if (typeof existing !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(existing))
      fail('TARGET_RPC_RESPONSE');
    if (existing !== '0x') occupied.push(action.contractAddress);
  }
  const reasons: string[] = [];
  if (timestamp > BigInt(now) || BigInt(now) - timestamp > BigInt(budget.maxHeadAgeSeconds))
    reasons.push('TARGET_HEAD_STALE');
  if (latestNonce !== pendingNonce || pendingNonce !== pinnedNonce || pendingNonce !== BigInt(inputs.nonce))
    reasons.push('TARGET_NONCE_UNCERTAIN');
  if (code !== '0x') reasons.push('TARGET_DEPLOYER_NOT_EOA');
  if (administratorCode !== '0x') reasons.push('TARGET_SMART_ACCOUNT_EXECUTION_PLAN_REQUIRED');
  if (administratorNonces[0] !== administratorNonces[1] || administratorNonces[1] !== administratorNonces[2])
    reasons.push('TARGET_ADMINISTRATOR_NONCE_UNCERTAIN');
  if (occupied.length) reasons.push('TARGET_CREATE_ADDRESS_OCCUPIED');
  if (perGas > txLimit) reasons.push('TARGET_GAS_LIMIT_POLICY');
  if (gasPrice === 0n || gasPrice > feeCap) reasons.push('TARGET_GAS_PRICE_POLICY');
  const conservativeGasCost = BigInt(executable.length) * perGas * feeCap;
  if (conservativeGasCost > totalGasBudget) reasons.push('TARGET_TOTAL_GAS_BUDGET');
  const requiredByActor: Record<string, string> = {};
  for (const actor of Object.keys(actorBalances)) {
    const actorActions = executable.filter((a) => getAddress(a.caller) === actor);
    const value = actorActions.reduce((sum, a) => sum + uint(a.unsigned!.value), 0n);
    const required = BigInt(actorActions.length) * perGas * feeCap + value + retained;
    requiredByActor[actor] = required.toString();
    if (BigInt(actorBalances[actor]!) < required) reasons.push('TARGET_INSUFFICIENT_ETH:' + actor);
  }
  let firstEstimate: { status: string; operation: string; gasRaw: string | null } = {
    status: 'NOT_RUN',
    operation: deployments[0]!.operation,
    gasRaw: null,
  };
  if (!reasons.length) {
    try {
      const first = deployments[0]!;
      const gas = rpcUint(
        await rpc.request('eth_estimateGas', [
          { from: deployer, data: first.unsigned!.data, value: '0x0' },
          block,
        ]),
      );
      if (gas === 0n || gas > perGas) {
        reasons.push('TARGET_FIRST_DEPLOYMENT_GAS');
        firstEstimate = { ...firstEstimate, status: 'BLOCKED', gasRaw: gas.toString() };
      } else
        firstEstimate = { ...firstEstimate, status: 'PASS_FIRST_DEPLOYMENT_ONLY', gasRaw: gas.toString() };
    } catch {
      reasons.push('TARGET_FIRST_DEPLOYMENT_ESTIMATE_UNAVAILABLE');
      firstEstimate.status = 'BLOCKED';
    }
  }
  const actors = [...new Set([deployer, admin])];
  const [canonicalInput, ...finalActorInputs] = await Promise.all([
    rpc.request('eth_getBlockByNumber', [block, false]),
    ...actors.flatMap((actor) => [
      rpc.request('eth_getTransactionCount', [actor, 'latest']),
      rpc.request('eth_getTransactionCount', [actor, 'pending']),
    ]),
  ]);
  const canonicalHead = record(canonicalInput),
    finalNow = options.now?.() ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(finalNow) || finalNow < now) fail('TARGET_TIME');
  const actorNonces = Object.fromEntries(
    actors.map((actor, i) => {
      const before = actor === deployer ? [latestNonce, pendingNonce] : administratorNonces;
      const endLatest = rpcUint(finalActorInputs[i * 2]),
        endPending = rpcUint(finalActorInputs[i * 2 + 1]);
      if (endLatest !== before[0] || endPending !== before[1] || endLatest !== endPending)
        reasons.push('TARGET_NONCE_CHANGED:' + actor);
      return [actor, { latest: endLatest.toString(), pending: endPending.toString() }];
    }),
  );
  if (
    (timestamp > BigInt(finalNow) || BigInt(finalNow) - timestamp > BigInt(budget.maxHeadAgeSeconds)) &&
    !reasons.includes('TARGET_HEAD_STALE')
  )
    reasons.push('TARGET_HEAD_STALE');
  if (canonicalHead.hash !== head.hash || rpcUint(canonicalHead.number) !== height)
    reasons.push('TARGET_REORG');
  return {
    schemaVersion: 1,
    kind: 'ALPHAFORGE_TARGET_DEPLOYMENT_READONLY_PREFLIGHT',
    status: reasons.length ? 'BLOCKED' : 'READONLY_PREFLIGHT_COMPLETE',
    chainId: 46630,
    planDigest: targetPlanDigest(expected),
    artifactEvidence,
    observedAt: new Date(finalNow * 1000).toISOString(),
    blockNumber: height.toString(),
    blockHash: head.hash,
    blockTimestamp: timestamp.toString(),
    deployer,
    administrator: admin,
    latestNonce: actorNonces[deployer]!.latest,
    pendingNonce: actorNonces[deployer]!.pending,
    pinnedNonce: pinnedNonce.toString(),
    actorNonces,
    predictedDeploymentCount: deployments.length,
    executablePlanTransactions: executable.length,
    unresolvedReferenceSteps: actions.filter((a) => a.unsigned === null).map((a) => a.operation),
    occupiedCreateAddresses: occupied,
    actorBalancesWei: actorBalances,
    gas: {
      gasPriceWei: gasPrice.toString(),
      executionLimit: txLimit.toString(),
      firstDeployment: firstEstimate,
      fullPlanEstimate: 'NOT_RUN_DEPENDENT_CONTRACTS_NOT_DEPLOYED',
    },
    funding: {
      basis: 'CONSERVATIVE_POLICY_UPPER_BOUND_NOT_TARGET_ESTIMATE',
      conservativeGasCostWei: conservativeGasCost.toString(),
      maximumPolicyGasCostWei: totalGasBudget.toString(),
      minimumRetainedPerActorWei: retained.toString(),
      nativePlanFundingWei: inputs.conversionEthRaw,
      requiredByActorWei: requiredByActor,
      scope: 'EXECUTABLE_UNSIGNED_PLAN_ACTIONS_ONLY',
      excludedOperations: ['FRESH_STOCK_PRICE_AND_SESSION_UPDATES', 'LATER_USER_TRANSACTIONS'],
    },
    reasons,
    deployment: 'NOT_RUN',
    signatures: 'NOT_RUN',
    broadcasts: 'NOT_RUN',
    fundingTransactions: 'NOT_RUN',
    activation: 'NOT_RUN',
    securityAdmission: 'NOT_EVALUATED_BY_READONLY_RPC_TOOL',
    confirmationPolicy: '3 L2 blocks including inclusion; no L1 finality claim',
  };
}

/** Operator supplies an unsigned plan and finite policy; public output never contains a signing secret. */
export async function targetPreflightCli(args: readonly string[]): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: target-preflight.ts UNSIGNED_PLAN.json BUDGET.json | --wallet PUBLIC_ADDRESS (official chain 46630; read-only; no signing/broadcast)',
    );
    return 0;
  }
  if (args.length === 2 && args[0] === '--wallet') {
    try {
      console.log(
        JSON.stringify(
          await targetWalletObservation(args[1]!, targetReadonlyRpc(ROBINHOOD_CHAIN_TESTNET.rpcUrl)),
          null,
          2,
        ),
      );
      return 1;
    } catch {
      console.error('TARGET_WALLET_OBSERVATION_REJECTED');
      return 1;
    }
  }
  if (args.length !== 2 || args.some((a) => a.startsWith('--'))) return 2;
  try {
    const result = await targetDeploymentPreflight(
      json(resolve(args[0]!), 2 * 1024 * 1024),
      json(resolve(args[1]!)) as TargetPreflightBudget,
      targetReadonlyRpc(ROBINHOOD_CHAIN_TESTNET.rpcUrl),
    );
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'BLOCKED' ? 1 : 0;
  } catch {
    console.error('TARGET_DEPLOYMENT_PREFLIGHT_REJECTED');
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await targetPreflightCli(process.argv.slice(2));
