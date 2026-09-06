import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  loadGovernanceArtifacts,
  renderSecurityBoundaryAppendix,
  semanticBoundaryDigest,
  validateSecurityBoundary,
  validateRoadmapAlignment,
} from '../tools/check-governance-v2.mjs';

const boundary = JSON.parse(
  await readFile(new URL('../planning/security-boundary.json', import.meta.url), 'utf8'),
);
const roadmap = JSON.parse(await readFile(new URL('../planning/roadmap.json', import.meta.url), 'utf8'));

test('review governance boundary is complete, closed and documented', async () => {
  assert.equal(validateSecurityBoundary(boundary), boundary);
  assert.equal(validateRoadmapAlignment(boundary, roadmap), roadmap);
  const artifacts = await loadGovernanceArtifacts();
  assert.equal(artifacts.boundary.environment.chainId, 46_630);
  assert.equal(artifacts.boundary.environment.writePlanes.deployment.enabled, false);
  assert.equal(artifacts.boundary.environment.writePlanes.application.enabled, false);
  assert.equal(artifacts.boundary.operatingModel.unattendedExecution, false);
  assert.equal(semanticBoundaryDigest(artifacts.boundary).length, 64);
  assert.equal(artifacts.appendix, renderSecurityBoundaryAppendix(artifacts.boundary));
});

test('closed governance baseline rejects every reviewed semantic bypass', () => {
  const mutations = [
    ['unattended execution', (item) => (item.operatingModel.unattendedExecution = true)],
    ['deployment write enable', (item) => (item.environment.writePlanes.deployment.enabled = true)],
    ['application write enable', (item) => (item.environment.writePlanes.application.enabled = true)],
    ['mainnet enable', (item) => (item.environment.mainnetSupported = true)],
    ['real funds enable', (item) => (item.environment.realFundsSupported = true)],
    ['executor caller authority', (item) => (item.roles[4].authority = 'caller-supplied')],
    ['executor arbitrary call', (item) => item.roles[4].capabilities.push('arbitrary_external_call')],
    ['deploy privilege transfer', (item) => (item.capabilities[9].owners = ['executor'])],
    ['owner withdrawal removal', (item) => item.roles[0].capabilities.splice(1, 1)],
    ['proxy enable', (item) => (item.contract.proxyAllowed = true)],
    ['admin upgrade migration', (item) => (item.contract.migration = 'proxy-admin-upgrade')],
    ['unpause enable', (item) => (item.contract.unpauseAllowed = true)],
    ['blocked exit', (item) => (item.safeExit.availableDuringPause = false)],
    ['empty pause blocks', (item) => (item.safeExit.riskIncreasingActionsBlocked = [])],
    ['real token activation', (item) => item.assetPolicy.activeAllowlist.push('real-token')],
    ['admin token exception', (item) => item.assetPolicy.rejectedBehaviors.splice(6, 3)],
    ['cross-chain replay', (item) => item.signatures[0].requiredBindings.splice(0, 1)],
    ['risk permit signer swap', (item) => (item.signatures[1].signerRole = 'executor')],
    ['strategy bindings cleared', (item) => (item.signatures[2].requiredBindings = [])],
    ['memory nonce', (item) => (item.nonceDomains[2].persistence = 'memory')],
    ['owner secret removed', (item) => item.secrets.splice(0, 1)],
    ['repository allowed for key', (item) => item.secrets[2].allowedStorage.push('repository')],
    ['trust endpoint substitution', (item) => (item.trustBoundaries[0].to = 'attacker-wallet')],
    ['trust controls cleared', (item) => (item.trustBoundaries[0].controls = [])],
    ['blind signing prohibition removed', (item) => item.prohibited.splice(4, 1)],
    ['extra unsafe field', (item) => (item.emergencyAdmin = true)],
  ];

  for (const [name, mutate] of mutations) {
    const candidate = structuredClone(boundary);
    mutate(candidate);
    assert.throws(
      () => validateSecurityBoundary(candidate),
      /Invalid governance boundary/,
      `${name} must be rejected`,
    );
  }
});

test('coordinated capability escalation is rejected even when role and owner catalog agree', () => {
  const candidate = structuredClone(boundary);
  candidate.roles[4].capabilities.push('arbitrary_external_call');
  candidate.capabilities.push({ id: 'arbitrary_external_call', owners: ['executor'] });
  assert.throws(() => validateSecurityBoundary(candidate), /Invalid governance boundary/);
});

test('roadmap alignment rejects unknown prerequisites and dishonest acceptance', () => {
  const unknownTask = structuredClone(boundary);
  unknownTask.environment.writePlanes.application.requiresCompletedTasks[0] = 'MISSING-001';
  assert.throws(() => validateRoadmapAlignment(unknownTask, roadmap), /unknown task MISSING-001/);

  const prematureAcceptance = structuredClone(boundary);
  prematureAcceptance.decision.status = 'accepted';
  assert.throws(() => validateRoadmapAlignment(prematureAcceptance, roadmap), /requires GOV-001 done/);
});
