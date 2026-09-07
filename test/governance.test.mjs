import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import {
  loadGovernanceArtifacts,
  renderGovernanceReview,
  renderSecurityBoundaryAppendix,
  semanticAdrDigest,
  semanticBoundaryDigest,
  semanticReadmeDigest,
  validateGovernanceDocumentStatus,
  validateGovernanceReview,
  validateGovernanceReviewProvenance,
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
      readmeNormalizedSha256: 'd'.repeat(64),
      roadmapSha256: 'e'.repeat(64),
      validatorSha256: 'b'.repeat(64),
      regressionTestsSha256: 'c'.repeat(64),
    },
    reviewers: [
      'architecture-and-authority-boundary',
      'roles-assets-and-cryptography',
      'validator-and-state-transition',
    ].map((area, index) => ({
      area,
      reviewerId: ['gov-architecture', 'gov-roles-assets', 'gov-validation'][index],
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

function git(repository, args) {
  return execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function writeRepositoryFile(repository, path, content) {
  const target = resolve(repository, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
    ['impossible boundary date', (item) => (item.updatedAt = '2026-99-99')],
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
  candidate.capabilities.push({ id: 'arbitrary_external_call', owners: ['pause-guardian'] });
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
  assert.throws(
    () => validateRoadmapAlignment(prematureAcceptance, fakeAcceptedRoadmap, makeValidReview()),
    /requires verified Git review provenance/,
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
      'impossible review date',
      (item) => {
        item.reviewedAt = '2026-99-99';
        return item;
      },
      /real YYYY-MM-DD calendar date/,
    ],
    [
      'fabricated reviewer identity',
      (item) => {
        item.reviewers[0].reviewerId = 'fabricated-reviewer';
        return item;
      },
      /reviewerId must be gov-architecture/,
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
        readmeNormalizedSha256: 'd'.repeat(64),
        roadmapSha256: 'e'.repeat(64),
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

test('Git provenance rejects forged review baselines and constrains the first acceptance transition', async (t) => {
  const repository = await mkdtemp(resolve(tmpdir(), 'quantpass-governance-provenance-'));
  t.after(() => rm(repository, { recursive: true, force: true }));

  const fixturePaths = [
    '.github/workflows/ci.yml',
    'README.md',
    'TODO.md',
    'docs/TASK-BOARD.md',
    'docs/adr/0001-security-boundary.generated.md',
    'docs/adr/0001-testnet-mvp-scope-and-authority.md',
    'docs/task-board.html',
    'planning/roadmap.json',
    'planning/security-boundary.json',
    'test/governance.test.mjs',
    'tools/check-governance-v2.mjs',
  ];
  const baselineFiles = new Map(
    await Promise.all(
      fixturePaths.map(async (path) => [
        path,
        await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
      ]),
    ),
  );
  for (const [path, content] of baselineFiles) await writeRepositoryFile(repository, path, content);

  git(repository, ['init', '--quiet']);
  git(repository, ['config', 'user.name', 'Governance Test']);
  git(repository, ['config', 'user.email', 'governance-test@example.invalid']);
  git(repository, ['config', 'commit.gpgsign', 'false']);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'reviewed baseline']);
  const reviewedCommit = git(repository, ['rev-parse', 'HEAD']).trim();
  const reviewedAt = git(repository, ['show', '-s', '--format=%cs', reviewedCommit]).trim();
  const unrelatedCommit = git(repository, [
    'commit-tree',
    git(repository, ['rev-parse', `${reviewedCommit}^{tree}`]).trim(),
    '-m',
    'unrelated baseline',
  ]).trim();

  const acceptedBoundary = structuredClone(boundary);
  acceptedBoundary.decision.status = 'accepted';
  const acceptedRoadmap = structuredClone(roadmap);
  const governance = acceptedRoadmap.tasks.find((task) => task.id === 'GOV-001');
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
  acceptedRoadmap.tasks.find((task) => task.id === 'THREAT-001').status = 'in_progress';

  const review = makeValidReview();
  review.reviewedCommit = reviewedCommit;
  review.reviewedAt = reviewedAt;
  review.reviewedSemanticDigest = semanticBoundaryDigest(boundary);
  review.artifactDigests = {
    adrNormalizedSha256: semanticAdrDigest(
      baselineFiles.get('docs/adr/0001-testnet-mvp-scope-and-authority.md'),
    ),
    readmeNormalizedSha256: semanticReadmeDigest(baselineFiles.get('README.md')),
    roadmapSha256: sha256(baselineFiles.get('planning/roadmap.json')),
    validatorSha256: sha256(baselineFiles.get('tools/check-governance-v2.mjs')),
    regressionTestsSha256: sha256(baselineFiles.get('test/governance.test.mjs')),
  };
  review.reviewers.forEach((reviewer) => {
    reviewer.evidence = [
      'planning/security-boundary.json:1',
      'docs/adr/0001-testnet-mvp-scope-and-authority.md:1',
    ];
    reviewer.commands = [`git show ${reviewedCommit}:planning/security-boundary.json | nl -ba`];
  });

  const acceptanceFiles = {
    'README.md': baselineFiles
      .get('README.md')
      .replace(
        'Governance decision status: **independent review (not accepted)**.',
        'Governance decision status: **accepted**.',
      ),
    'TODO.md': `${baselineFiles.get('TODO.md')}\nacceptance transition\n`,
    'docs/TASK-BOARD.md': `${baselineFiles.get('docs/TASK-BOARD.md')}\nacceptance transition\n`,
    'docs/adr/0001-security-boundary.generated.md': renderSecurityBoundaryAppendix(acceptedBoundary),
    'docs/adr/0001-testnet-mvp-scope-and-authority.md': baselineFiles
      .get('docs/adr/0001-testnet-mvp-scope-and-authority.md')
      .replace('- 状态：独立复核中', '- 状态：已接受'),
    'docs/reviews/GOV-001.json': `${JSON.stringify(review, null, 2)}\n`,
    'docs/reviews/GOV-001.md': renderGovernanceReview(review),
    'docs/task-board.html': `${baselineFiles.get('docs/task-board.html')}\n<!-- acceptance transition -->\n`,
    'planning/roadmap.json': `${JSON.stringify(acceptedRoadmap, null, 2)}\n`,
    'planning/security-boundary.json': `${JSON.stringify(acceptedBoundary, null, 2)}\n`,
  };
  for (const [path, content] of Object.entries(acceptanceFiles)) {
    await writeRepositoryFile(repository, path, content);
  }

  const current = {
    boundaryText: acceptanceFiles['planning/security-boundary.json'],
    roadmapText: acceptanceFiles['planning/roadmap.json'],
    boundary: acceptedBoundary,
    roadmap: acceptedRoadmap,
    adr: acceptanceFiles['docs/adr/0001-testnet-mvp-scope-and-authority.md'],
    appendix: acceptanceFiles['docs/adr/0001-security-boundary.generated.md'],
    readme: acceptanceFiles['README.md'],
    reviewText: acceptanceFiles['docs/reviews/GOV-001.json'],
    reviewReport: acceptanceFiles['docs/reviews/GOV-001.md'],
    validatorText: baselineFiles.get('tools/check-governance-v2.mjs'),
    governanceTest: baselineFiles.get('test/governance.test.mjs'),
  };
  const now = new Date(`${reviewedAt}T12:00:00.000Z`);

  const nonexistent = structuredClone(review);
  nonexistent.reviewedCommit = 'a'.repeat(40);
  assert.throws(
    () => validateGovernanceReviewProvenance(nonexistent, current, { repositoryRoot: repository, now }),
    /does not exist as a Git commit/,
  );

  const nonAncestor = structuredClone(review);
  nonAncestor.reviewedCommit = unrelatedCommit;
  assert.throws(
    () => validateGovernanceReviewProvenance(nonAncestor, current, { repositoryRoot: repository, now }),
    /is not an ancestor of HEAD/,
  );

  const digestDrift = structuredClone(review);
  digestDrift.artifactDigests.validatorSha256 = '0'.repeat(64);
  assert.throws(
    () => validateGovernanceReviewProvenance(digestDrift, current, { repositoryRoot: repository, now }),
    /validatorSha256 does not match reviewed content/,
  );

  const futureReview = structuredClone(review);
  futureReview.reviewedAt = '2999-01-01';
  assert.throws(
    () => validateGovernanceReviewProvenance(futureReview, current, { repositoryRoot: repository, now }),
    /reviewedAt is in the future/,
  );

  const fakeEvidence = structuredClone(review);
  fakeEvidence.reviewers[0].evidence = ['fake:1', 'fake:2'];
  assert.throws(
    () => validateGovernanceReviewProvenance(fakeEvidence, current, { repositoryRoot: repository, now }),
    /evidence references an unreviewed path/,
  );

  const fakeCommand = structuredClone(review);
  fakeCommand.reviewers[0].commands = ['true'];
  assert.throws(
    () => validateGovernanceReviewProvenance(fakeCommand, current, { repositoryRoot: repository, now }),
    /command must be a pinned read-only git show command/,
  );

  await writeRepositoryFile(repository, 'src/backdoor.ts', 'export const bypass = true;\n');
  assert.throws(
    () => validateGovernanceReviewProvenance(review, current, { repositoryRoot: repository, now }),
    /acceptance transition paths must be exactly/,
  );
  await rm(resolve(repository, 'src/backdoor.ts'));

  await writeRepositoryFile(
    repository,
    'tools/check-governance-v2.mjs',
    `${baselineFiles.get('tools/check-governance-v2.mjs')}\n// unreviewed weakening\n`,
  );
  assert.throws(
    () => validateGovernanceReviewProvenance(review, current, { repositoryRoot: repository, now }),
    /acceptance transition paths must be exactly/,
  );
  await writeRepositoryFile(
    repository,
    'tools/check-governance-v2.mjs',
    baselineFiles.get('tools/check-governance-v2.mjs'),
  );

  const verification = validateGovernanceReviewProvenance(review, current, {
    repositoryRoot: repository,
    now,
  });
  assert.equal(verification.acceptanceCommit, null);
  assert.equal(
    validateRoadmapAlignment(acceptedBoundary, acceptedRoadmap, review, verification),
    acceptedRoadmap,
  );

  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'accept governance decision']);
  const committedVerification = validateGovernanceReviewProvenance(review, current, {
    repositoryRoot: repository,
    now,
  });
  assert.match(committedVerification.acceptanceCommit, /^[0-9a-f]{40}$/);

  await writeRepositoryFile(repository, 'src/feature.ts', 'export const feature = true;\n');
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'continue normal development']);
  assert.doesNotThrow(() =>
    validateGovernanceReviewProvenance(review, current, { repositoryRoot: repository, now }),
  );

  const tamperedReview = structuredClone(review);
  tamperedReview.nonBlockingRecommendations.push('fabricated after acceptance');
  assert.throws(
    () =>
      validateGovernanceReviewProvenance(tamperedReview, current, {
        repositoryRoot: repository,
        now,
      }),
    /review record changed after the acceptance transition/,
  );
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
  assert.equal(semanticReadmeDigest(reviewReadme).length, 64);
  assert.equal(
    semanticReadmeDigest(reviewReadme),
    semanticReadmeDigest('Governance decision status: **accepted**.\n'),
  );
});
