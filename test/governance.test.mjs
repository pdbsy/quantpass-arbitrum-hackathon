import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  loadGovernanceArtifacts,
  validateAdrCoverage,
  validateSecurityBoundary,
} from '../tools/check-governance.mjs';

const boundary = JSON.parse(
  await readFile(new URL('../planning/security-boundary.json', import.meta.url), 'utf8'),
);

test('accepted governance boundary is complete and documented', async () => {
  assert.equal(validateSecurityBoundary(boundary), boundary);
  const artifacts = await loadGovernanceArtifacts();
  assert.equal(artifacts.boundary.environment.chainId, 46_630);
  assert.equal(artifacts.boundary.environment.testnetWrites.enabled, false);
  assert.equal(artifacts.boundary.capabilityOwners.withdraw_assets[0], 'owner');
});

test('governance boundary rejects premature network and value expansion', () => {
  const testnetWrite = structuredClone(boundary);
  testnetWrite.environment.testnetWrites.enabled = true;
  assert.throws(() => validateSecurityBoundary(testnetWrite), /testnet writes must remain disabled/);

  const mainnet = structuredClone(boundary);
  mainnet.environment.mainnetSupported = true;
  assert.throws(() => validateSecurityBoundary(mainnet), /mainnet must remain unsupported/);

  const realFunds = structuredClone(boundary);
  realFunds.environment.realFundsSupported = true;
  assert.throws(() => validateSecurityBoundary(realFunds), /real funds must remain unsupported/);
});

test('governance boundary rejects privilege escalation and blocked exits', () => {
  const executorWithdrawal = structuredClone(boundary);
  executorWithdrawal.capabilityOwners.withdraw_assets.push('executor');
  assert.throws(() => validateSecurityBoundary(executorWithdrawal), /withdraw capability owners/);

  const proxy = structuredClone(boundary);
  proxy.contract.proxyAllowed = true;
  assert.throws(() => validateSecurityBoundary(proxy), /proxy must be forbidden/);

  const blockedExit = structuredClone(boundary);
  blockedExit.safeExit.availableDuringPause = false;
  assert.throws(() => validateSecurityBoundary(blockedExit), /safe exit must remain available/);
});

test('governance boundary rejects weakened asset and signature rules', () => {
  const rebasing = structuredClone(boundary);
  rebasing.assetPolicy.rejectedBehaviors = rebasing.assetPolicy.rejectedBehaviors.filter(
    (behavior) => behavior !== 'rebasing',
  );
  assert.throws(() => validateSecurityBoundary(rebasing), /must include rebasing/);

  const crossChainReplay = structuredClone(boundary);
  const ownerAuthorization = crossChainReplay.signatures.find(
    (signature) => signature.id === 'owner-authorization',
  );
  ownerAuthorization.requiredBindings = ownerAuthorization.requiredBindings.filter(
    (binding) => binding !== 'chainId',
  );
  assert.throws(() => validateSecurityBoundary(crossChainReplay), /must include chainId/);
});

test('ADR coverage rejects missing trust-boundary documentation', () => {
  const incompleteAdr = '# ADR-0001\nChain ID `46630`\n本 ADR 不开启 Testnet 写入';
  assert.throws(() => validateAdrCoverage(boundary, incompleteAdr), /ADR must identify role owner/);
});
