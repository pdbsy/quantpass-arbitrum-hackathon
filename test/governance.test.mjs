import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  loadGovernanceArtifacts,
  renderGovernanceReview,
  renderSecurityBoundaryAppendix,
  semanticAdrDigest,
  semanticBoundaryDigest,
  validateGovernanceDocumentStatus,
  validateGovernanceReview,
  validateSecurityBoundary,
  validateRoadmapAlignment,
} from '../tools/check-governance-v2.mjs';

const boundary = JSON.parse(
  await readFile(new URL('../planning/security-boundary.json', import.meta.url), 'utf8'),
);
const roadmap = JSON.parse(await readFile(new URL('../planning/roadmap.json', import.meta.url), 'utf8'));

function makeValidReview() {
  return {
    schemaVersion: 1,
    taskId: 'GOV-001',
    decisionId: 'ADR-0001',
    reviewedCommit: 'a'.repeat(40),
    reviewedAt: '2026-09-06',
    reviewMethod: 'three-independent-read-only-reviews',
    reviewedSemanticDigest: semanticBoundaryDigest(boundary),
    artifactDigests: {
      adrNormalizedSha256: 'a'.repeat(64),
      validatorSha256: 'b'.repeat(64),
      regressionTestsSha256: 'c'.repeat(64),
    },
    reviewers: [
      'architecture-and-authority-boundary',
      'roles-assets-and-cryptography',
      'validator-and-state-transition',
    ].map((area, index) => ({
      area,
      reviewerId: `independent-reviewer-${index + 1}`,
      independence: 'read-only-no-edits-no-delegation',
      verdict: 'pass',
      blockers: [],
      evidence: ['planning/security-boundary.json:1', 'docs/adr/0001-testnet-mvp-scope-and-authority.md:1'],
      commands: ['npm run governance:check'],
      nonBlockingNotes: [],
    })),
    verdict: 'pass',
    aggregateBlockers: [],
    nonBlockingRecommendations: [],
    limitations: [],
  };
}

test('review governance boundary is complete, closed and documented', async () => {
  assert.equal(validateSecurityBoundary(boundary), boundary);
  assert.equal(validateRoadmapAlignment(boundary, roadmap), roadmap);
  const artifacts = await loadGovernanceArtifacts();
  assert.equal(artifacts.boundary.environment.chainId, 46_630);
  assert.equal(artifacts.boundary.environment.writePlanes.deployment.enabled, false);
  assert.equal(artifacts.boundary.environment.writePlanes.application.enabled, false);
  assert.equal(artifacts.boundary.operatingModel.unattendedExecution, false);
  assert.equal(artifacts.review, null);
  assert.equal(semanticBoundaryDigest(artifacts.boundary).length, 64);
  assert.equal(semanticAdrDigest(artifacts.adr).length, 64);
  assert.equal(artifacts.appendix, renderSecurityBoundaryAppendix(artifacts.boundary));
});

test('closed governance baseline rejects every reviewed semantic bypass', () => {
  const mutations = [
    ['unattended execution', (item) => (item.operatingModel.unattendedExecution = true)],
    ['deployment write enable', (item) => (item.environment.writePlanes.deployment.enabled = true)],
    ['application write enable', (item) => (item.environment.writePlanes.application.enabled = true)],
    ['mainnet enable', (item) => (item.environment.mainnetSupported = true)],
    ['real funds enable', (item) => (item.environment.realFundsSupported = true)],
    ['pause guardian caller authority', (item) => (item.roles[4].authority = 'caller-supplied')],
    ['pause guardian arbitrary call', (item) => item.roles[4].capabilities.push('arbitrary_external_call')],
    ['deploy privilege transfer', (item) => (item.capabilities[8].owners = ['relayer'])],
    ['owner withdrawal removal', (item) => item.roles[0].capabilities.splice(1, 1)],
    ['proxy enable', (item) => (item.contract.proxyAllowed = true)],
    ['native value enable', (item) => (item.contract.nativeValuePolicy = 'forward-user-value')],
    ['admin upgrade migration', (item) => (item.contract.migration = 'proxy-admin-upgrade')],
    ['unpause enable', (item) => (item.contract.unpauseAllowed = true)],
    ['blocked exit', (item) => (item.safeExit.availableDuringPause = false)],
    ['empty pause blocks', (item) => (item.safeExit.riskIncreasingActionsBlocked = [])],
    ['real token activation', (item) => item.assetPolicy.activeAllowlist.push('real-token')],
    ['admin token exception', (item) => item.assetPolicy.rejectedBehaviors.splice(6, 3)],
    ['token freeze exception', (item) => item.assetPolicy.rejectedBehaviors.splice(10, 1)],
    ['token privileged role allowed', (item) => item.assetPolicy.requiredProperties.splice(6, 1)],
    ['cross-chain replay', (item) => item.signatures[0].requiredBindings.splice(0, 1)],
    ['risk permit signer swap', (item) => (item.signatures[1].signerRole = 'executor')],
    ['strategy bindings cleared', (item) => (item.signatures[2].requiredBindings = [])],
    ['memory nonce', (item) => (item.nonceDomains[2].persistence = 'memory')],
    [
      'state version not incremented',
      (item) => (item.executionConcurrency.contractEnforcement = 'best-effort-check'),
    ],
    [
      'concurrent risk issuance',
      (item) => (item.executionConcurrency.riskServiceIssuance = 'parallel-permit-issuance'),
    ],
    ['state binding removed', (item) => item.signatures[0].requiredBindings.splice(11, 2)],
    ['cross-role key reuse', (item) => (item.roleLifecycle.crossRoleKeyMaterialReuseAllowed = true)],
    ['Ed25519 key separation removed', (item) => (item.roleLifecycle.ed25519TrustKeysPairwiseDistinct = [])],
    ['owner secret removed', (item) => item.secrets.splice(0, 1)],
    ['repository allowed for key', (item) => item.secrets[2].allowedStorage.push('repository')],
    ['trust endpoint substitution', (item) => (item.trustBoundaries[0].to = 'attacker-wallet')],
    ['trust controls cleared', (item) => (item.trustBoundaries[0].controls = [])],
    ['privileged relayer endpoint', (item) => (item.trustBoundaries[4].from = 'privileged-executor')],
    ['runtime manifest selection', (item) => (item.trustBootstrap.runtimeOrRequestSelectionAllowed = true)],
    [
      'unreviewed manifest activation',
      (item) => (item.trustBootstrap.currentManifestDigest = 'a'.repeat(64)),
    ],
    [
      'deployment without dry-run',
      (item) => item.environment.writePlanes.deployment.requiresCompletedTasks.splice(-1, 1),
    ],
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

test('coordinated guardian capability escalation is rejected even when role and owner catalog agree', () => {
  const candidate = structuredClone(boundary);
  candidate.roles[4].capabilities.push('arbitrary_external_call');
  candidate.capabilities.push({ id: 'arbitrary_external_call', owners: ['executor'] });
  assert.throws(() => validateSecurityBoundary(candidate), /Invalid governance boundary/);
});

test('roadmap alignment rejects unknown prerequisites and acceptance without a review record', () => {
  const unknownTask = structuredClone(boundary);
  unknownTask.environment.writePlanes.application.requiresCompletedTasks[0] = 'MISSING-001';
  assert.throws(() => validateRoadmapAlignment(unknownTask, roadmap), /unknown task MISSING-001/);

  const prematureAcceptance = structuredClone(boundary);
  prematureAcceptance.decision.status = 'accepted';
  assert.throws(() => validateRoadmapAlignment(prematureAcceptance, roadmap), /requires GOV-001 done/);

  const fakeAcceptedRoadmap = structuredClone(roadmap);
  const governance = fakeAcceptedRoadmap.tasks.find((task) => task.id === 'GOV-001');
  governance.status = 'done';
  governance.evidence = [
    'docs/adr/0001-testnet-mvp-scope-and-authority.md',
    'docs/adr/0001-security-boundary.generated.md',
    'docs/reviews/GOV-001.json',
    'docs/reviews/GOV-001.md',
    'planning/security-boundary.json',
    'tools/check-governance-v2.mjs',
    'test/governance.test.mjs',
  ];
  assert.throws(
    () => validateRoadmapAlignment(prematureAcceptance, fakeAcceptedRoadmap),
    /governanceReview must be an object/,
  );
  assert.equal(
    validateRoadmapAlignment(prematureAcceptance, fakeAcceptedRoadmap, makeValidReview()),
    fakeAcceptedRoadmap,
  );
});

test('governance review record fails closed on missing, mismatched or non-PASS evidence', () => {
  const acceptedBoundary = structuredClone(boundary);
  acceptedBoundary.decision.status = 'accepted';
  const valid = makeValidReview();
  assert.equal(validateGovernanceReview(valid, acceptedBoundary), valid);
  assert.match(renderGovernanceReview(valid), /Aggregate verdict：`pass`/);

  const mutations = [
    ['empty record', () => ({}), /keys must be exactly/],
    [
      'semantic mismatch',
      (item) => {
        item.reviewedSemanticDigest = '0'.repeat(64);
        return item;
      },
      /semantic digest does not match/,
    ],
    [
      'aggregate non-PASS',
      (item) => {
        item.verdict = 'fail';
        return item;
      },
      /aggregate governance review verdict/,
    ],
    [
      'reviewer non-PASS',
      (item) => {
        item.reviewers[1].verdict = 'blocked';
        return item;
      },
      /must have a PASS verdict/,
    ],
    [
      'reviewer blocker',
      (item) => {
        item.reviewers[0].blockers.push('open');
        return item;
      },
      /differs from the required closed set/,
    ],
    [
      'aggregate blocker',
      (item) => {
        item.aggregateBlockers.push('open');
        return item;
      },
      /differs from the required closed set/,
    ],
    [
      'artifact mismatch',
      (item) => {
        item.artifactDigests.validatorSha256 = 'd'.repeat(64);
        return item;
      },
      /does not match reviewed content/,
      {
        adrNormalizedSha256: 'a'.repeat(64),
        validatorSha256: 'b'.repeat(64),
        regressionTestsSha256: 'c'.repeat(64),
      },
    ],
  ];

  for (const [name, mutate, pattern, artifactDigests] of mutations) {
    const candidate = makeValidReview();
    const value = mutate(candidate);
    assert.throws(
      () => validateGovernanceReview(value, acceptedBoundary, artifactDigests),
      pattern,
      `${name} must be rejected`,
    );
  }
});

test('human-facing governance status must match the machine decision', () => {
  const reviewAdr = '# ADR\n\n- 状态：独立复核中\n';
  const reviewReadme = 'Governance decision status: **independent review (not accepted)**.\n';
  assert.deepEqual(validateGovernanceDocumentStatus(boundary, reviewAdr, reviewReadme), {
    adr: reviewAdr,
    readme: reviewReadme,
  });

  const acceptedBoundary = structuredClone(boundary);
  acceptedBoundary.decision.status = 'accepted';
  assert.throws(
    () => validateGovernanceDocumentStatus(acceptedBoundary, reviewAdr, reviewReadme),
    /ADR status must match accepted/,
  );
  assert.doesNotThrow(() =>
    validateGovernanceDocumentStatus(
      acceptedBoundary,
      '# ADR\n\n- 状态：已接受\n',
      'Governance decision status: **accepted**.\n',
    ),
  );
});
