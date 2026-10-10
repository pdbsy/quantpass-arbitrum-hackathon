import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Interface } from 'ethers';
import { prepareDeployment, type DeploymentInputs } from '../tools/launch-market/prepare.ts';
import {
  qualifyTargetArtifacts,
  targetDeploymentPreflight,
  targetPlanDigest,
  targetReadonlyRpc,
  targetWalletObservation,
  type TargetPreflightBudget,
  type TargetPreflightRpc,
} from '../tools/launch-market/target-preflight.ts';

const address = (n: number) => '0x' + n.toString(16).padStart(40, '0');
const hash = '0x' + 'a'.repeat(64);
const now = 1_800_000_000;
function inputs(): DeploymentInputs {
  return {
    chainId: 46630,
    deployer: address(1),
    nonce: 0,
    administrator: address(1),
    quoteSigner: address(2),
    claimSigner: address(3),
    tslaLpRecipient: address(4),
    amznLpRecipient: address(4),
    usdcSupplyRaw: '2000000000000',
    conversionUsdcRaw: '100000000000',
    conversionEthRaw: '10000000000000000',
    stockReserveUsdcRaw: '100000000000',
    stockReserveUnitsRaw: '500000000000000000000000',
    ethPerTransactionRaw: '100000000000000',
    ethPerAccountDailyRaw: '500000000000000',
    ethGlobalDailyRaw: '1000000000000000',
    ethMinimumReserveRaw: '1000000000000000',
  };
}
const policy: TargetPreflightBudget = {
  maxGasPerTransactionRaw: '32000000',
  maxFeePerGasRaw: '20000000',
  maxTotalGasCostWei: '30000000000000000',
  minimumRemainingEthRaw: '1000000000000000',
  maxHeadAgeSeconds: 60,
};
function rpc(
  options: {
    chain?: string;
    nonce?: string;
    balance?: string;
    occupied?: boolean;
    reorg?: boolean;
    fee?: string;
    stale?: boolean;
  } = {},
) {
  const calls: { method: string; params: readonly unknown[] }[] = [];
  const transport: TargetPreflightRpc = {
    request: async (method, params) => {
      calls.push({ method, params });
      switch (method) {
        case 'eth_chainId':
          return options.chain ?? '0xb626';
        case 'eth_getBlockByNumber':
          return {
            number: '0x1',
            hash: params[0] !== 'latest' && options.reorg ? '0x' + 'b'.repeat(64) : hash,
            timestamp: '0x' + (now - (options.stale ? 61 : 1)).toString(16),
          };
        case 'eth_getTransactionCount':
          return params[1] === 'pending' ? (options.nonce ?? '0x0') : '0x0';
        case 'eth_getBalance':
          return options.balance ?? '0xde0b6b3a7640000';
        case 'eth_gasPrice':
          return options.fee ?? '0x989680';
        case 'eth_getCode':
          return options.occupied && params[0] !== address(1) ? '0x6000' : '0x';
        case 'eth_call':
          return new Interface([
            'function getGasAccountingParams() view returns(uint256,uint256,uint256)',
          ]).encodeFunctionResult('getGasAccountingParams', [7000000, 32000000, 32000000]);
        case 'eth_estimateGas':
          return '0x100000';
        default:
          throw new Error('Unexpected read method: ' + method);
      }
    },
  };
  return { calls, transport };
}

test('target preflight never turns an empty real wallet into deployment or estimation success', async () => {
  const fixture = rpc({ balance: '0x0' }),
    plan = await prepareDeployment(inputs());
  const result = await targetDeploymentPreflight(plan, policy, fixture.transport, { now: () => now });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.some((r) => r.startsWith('TARGET_INSUFFICIENT_ETH:')));
  assert.equal(result.gas.firstDeployment.status, 'NOT_RUN');
  assert.equal(result.gas.fullPlanEstimate, 'NOT_RUN_DEPENDENT_CONTRACTS_NOT_DEPLOYED');
  assert.equal(result.deployment, 'NOT_RUN');
  assert.equal(result.signatures, 'NOT_RUN');
  assert.equal(result.broadcasts, 'NOT_RUN');
  assert.equal(result.fundingTransactions, 'NOT_RUN');
  assert.equal(
    fixture.calls.some((c) => c.method === 'eth_estimateGas'),
    false,
  );
  assert.equal(
    fixture.calls.some((c) => /send|sign|accounts/i.test(c.method)),
    false,
  );
});

test('public wallet observation needs no invented plan and remains blocked before faucet funding', async () => {
  const fixture = rpc({ balance: '0x0' });
  const result = await targetWalletObservation(address(1), fixture.transport, () => now);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.nativeBalanceWei, '0');
  assert.equal(result.pendingNonce, '0');
  assert.ok(result.reasons.includes('FAUCET_FUNDING_REQUIRED'));
  assert.ok(result.reasons.includes('APPROVED_DEPLOYMENT_INPUTS_AND_PLAN_REQUIRED'));
  assert.equal(result.unsignedPlan, 'NOT_APPROVED');
  assert.equal(result.targetGasEstimate, 'NOT_RUN');
  assert.equal(
    fixture.calls.some((c) => c.method === 'eth_estimateGas'),
    false,
  );
});

test('qualified read-only plan shows finite conservative funds and only its first real estimate', async () => {
  const fixture = rpc(),
    plan = await prepareDeployment(inputs());
  const result = await targetDeploymentPreflight(plan, policy, fixture.transport, { now: () => now });
  assert.equal(result.status, 'READONLY_PREFLIGHT_COMPLETE');
  assert.equal(result.predictedDeploymentCount, 15);
  assert.equal(result.executablePlanTransactions, 41);
  assert.equal(result.unresolvedReferenceSteps.length, 2);
  assert.equal(result.gas.firstDeployment.status, 'PASS_FIRST_DEPLOYMENT_ONLY');
  assert.equal(result.gas.fullPlanEstimate, 'NOT_RUN_DEPENDENT_CONTRACTS_NOT_DEPLOYED');
  assert.equal(result.funding.conservativeGasCostWei, '26240000000000000');
  assert.equal(result.funding.requiredByActorWei[address(1)], '37240000000000000');
  assert.equal(result.funding.basis, 'CONSERVATIVE_POLICY_UPPER_BOUND_NOT_TARGET_ESTIMATE');
  assert.equal(fixture.calls.filter((c) => c.method === 'eth_estimateGas').length, 1);
  assert.ok(
    fixture.calls
      .filter((c) => ['eth_call', 'eth_getCode', 'eth_getBalance', 'eth_estimateGas'].includes(c.method))
      .every((c) => c.params.at(-1) === '0x1'),
  );
  assert.equal(result.planDigest, targetPlanDigest(plan));
  assert.equal(targetPlanDigest({ b: 1, a: 2 }), targetPlanDigest({ a: 2, b: 1 }));
});

test('altered transaction plans and invalid retained reserve are rejected before any RPC', async () => {
  const fixture = rpc(),
    plan = await prepareDeployment(inputs());
  const changed = structuredClone(plan);
  (changed.actions[0] as { unsigned: { value: string } }).unsigned.value = '1';
  await assert.rejects(targetDeploymentPreflight(changed, policy, fixture.transport), /TARGET_PLAN_MISMATCH/);
  const zero = structuredClone(plan);
  zero.inputs.ethMinimumReserveRaw = '0';
  await assert.rejects(
    targetDeploymentPreflight(zero, policy, fixture.transport),
    /CONVERSION_READINESS_REQUIRED/,
  );
  assert.equal(fixture.calls.length, 0);
});

test('wrong chain, nonce uncertainty, occupied CREATE addresses and stale heads fail closed', async () => {
  const plan = await prepareDeployment(inputs()),
    wrong = rpc({ chain: '0x1' });
  await assert.rejects(
    targetDeploymentPreflight(plan, policy, wrong.transport, { now: () => now }),
    /TARGET_CHAIN/,
  );
  assert.equal(wrong.calls.length, 1);
  const uncertain = rpc({ nonce: '0x1', occupied: true, stale: true });
  const result = await targetDeploymentPreflight(plan, policy, uncertain.transport, { now: () => now });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('TARGET_NONCE_UNCERTAIN'));
  assert.ok(result.reasons.includes('TARGET_CREATE_ADDRESS_OCCUPIED'));
  assert.ok(result.reasons.includes('TARGET_HEAD_STALE'));
  assert.equal(result.occupiedCreateAddresses.length, 15);
  assert.equal(
    uncertain.calls.some((c) => c.method === 'eth_estimateGas'),
    false,
  );
});

test('canonical hash changes and excessive gas price or total budget prevent readiness', async () => {
  const plan = await prepareDeployment(inputs()),
    fixture = rpc({ reorg: true, fee: '0x1312d01' });
  const result = await targetDeploymentPreflight(
    plan,
    { ...policy, maxTotalGasCostWei: '1' },
    fixture.transport,
    { now: () => now },
  );
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('TARGET_REORG'));
  assert.ok(result.reasons.includes('TARGET_GAS_PRICE_POLICY'));
  assert.ok(result.reasons.includes('TARGET_TOTAL_GAS_BUDGET'));
});

test('nonce changes and time spent during preflight invalidate the initially qualified observation', async () => {
  const plan = await prepareDeployment(inputs()),
    fixture = rpc();
  let nonceReads = 0,
    clocks = 0;
  const transport: TargetPreflightRpc = {
    request: async (method, params) => {
      if (method === 'eth_getTransactionCount' && ++nonceReads > 3) return '0x1';
      return fixture.transport.request(method, params);
    },
  };
  const result = await targetDeploymentPreflight(plan, policy, transport, {
    now: () => now + (clocks++ ? 61 : 0),
  });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('TARGET_NONCE_CHANGED:' + address(1)));
  assert.ok(result.reasons.includes('TARGET_HEAD_STALE'));
  assert.equal(result.pendingNonce, '1');
  assert.equal(result.deployment, 'NOT_RUN');
});

test('pinned nonce disagreement and a contract administrator require a fresh explicit execution plan', async () => {
  const fixture = rpc();
  const transport: TargetPreflightRpc = {
    request: async (method, params) => {
      if (
        method === 'eth_getTransactionCount' &&
        params[0] === address(1) &&
        ['latest', 'pending'].includes(String(params[1]))
      )
        return '0x1';
      if (method === 'eth_getCode' && params[0] === address(5)) return '0x6000';
      return fixture.transport.request(method, params);
    },
  };
  const plan = await prepareDeployment({ ...inputs(), nonce: 1, administrator: address(5) });
  const result = await targetDeploymentPreflight(plan, policy, transport, { now: () => now });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.reasons.includes('TARGET_NONCE_UNCERTAIN'));
  assert.ok(result.reasons.includes('TARGET_SMART_ACCOUNT_EXECUTION_PLAN_REQUIRED'));
  assert.equal(result.pinnedNonce, '0');
  assert.equal(result.pendingNonce, '1');
  assert.equal(result.gas.firstDeployment.status, 'NOT_RUN');
});

test('readonly transport rejects nonofficial RPC and every signing or broadcast method before fetch', async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    throw new Error('No network allowed in this boundary test');
  };
  assert.throws(() => targetReadonlyRpc('https://mainnet.example', fetcher), /TARGET_RPC_ENDPOINT/);
  const transport = targetReadonlyRpc('https://rpc.testnet.chain.robinhood.com', fetcher);
  for (const method of [
    'eth_sendRawTransaction',
    'eth_sendTransaction',
    'personal_sign',
    'eth_sign',
    'eth_accounts',
    'anvil_setBalance',
  ])
    await assert.rejects(transport.request(method, []), /TARGET_RPC_METHOD/);
  assert.equal(requests, 0);
});

test('compiler source mismatch cannot qualify a current deployment artifact', async () => {
  const folder = await mkdtemp(resolve(tmpdir(), 'af-target-artifact-'));
  try {
    const source = 'src/AlphaForgeTestAsset.sol';
    const compiled = JSON.parse(
      await readFile(
        new URL('../.checks/af-chain01/out/AlphaForgeTestAsset.sol/AlphaForgeTestUSDC.json', import.meta.url),
        'utf8',
      ),
    );
    compiled.metadata.sources = { [source]: { keccak256: '0x' + '0'.repeat(64) } };
    await mkdir(resolve(folder, '.checks/af-chain01/out/AlphaForgeTestAsset.sol'), { recursive: true });
    await mkdir(resolve(folder, 'contracts/src'), { recursive: true });
    await writeFile(resolve(folder, 'contracts', source), 'pragma solidity 0.8.31;');
    await writeFile(
      resolve(folder, '.checks/af-chain01/out/AlphaForgeTestAsset.sol/AlphaForgeTestUSDC.json'),
      JSON.stringify(compiled),
    );
    assert.throws(() => qualifyTargetArtifacts(folder), /TARGET_ARTIFACT_SOURCE/);
    compiled.metadata.sources = {};
    await writeFile(
      resolve(folder, '.checks/af-chain01/out/AlphaForgeTestAsset.sol/AlphaForgeTestUSDC.json'),
      JSON.stringify(compiled),
    );
    assert.throws(() => qualifyTargetArtifacts(folder), /TARGET_ARTIFACT_SOURCE_GRAPH/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
