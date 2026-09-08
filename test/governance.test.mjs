import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import {
  loadGovernanceArtifacts,
  readOptionalCommitBlob,
  renderGovernanceReview,
  renderSecurityBoundaryAppendix,
  semanticAdrDigest,
  semanticBoundaryDigest,
  semanticReadmeGovernanceDigest,
  semanticReadmeDigest,
  semanticRoadmapPolicyDigest,
  validateGovernanceDocumentStatus,
  validateGovernanceReview,
  validateGovernanceReviewProvenance,
  validateReviewDateWindow,
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
      ciSha256: 'f'.repeat(64),
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

function addIsoDateDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('review civil-date window requires a possible instant after commit and before now', () => {
  assert.doesNotThrow(() =>
    validateReviewDateWindow('2026-09-08', '2026-09-07T18:00:00.000Z', new Date('2026-09-07T18:30:00.000Z')),
  );
  assert.throws(
    () =>
      validateReviewDateWindow(
        '2026-09-08',
        '2026-09-09T00:00:00.000Z',
        new Date('2026-09-08T00:00:00.000Z'),
      ),
    /reviewed commit timestamp is in the future/,
  );
  assert.throws(
    () =>
      validateReviewDateWindow(
        '2026-09-07',
        '2026-09-08T12:00:00.000Z',
        new Date('2026-09-09T00:00:00.000Z'),
      ),
    /reviewedAt predates the reviewed commit/,
  );
  assert.throws(
    () =>
      validateReviewDateWindow(
        '2026-09-08',
        '2026-09-07T09:00:00.000Z',
        new Date('2026-09-07T09:59:59.999Z'),
      ),
    /reviewedAt is in the future/,
  );
});

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
  assert.match(artifacts.ciText, /node tools\/check-governance-v2\.mjs/);
  assert.match(artifacts.ciText, /node --test test\/governance\.test\.mjs/);
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
        ciSha256: 'f'.repeat(64),
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

test('accepted-governance digests allow lifecycle progress but reject policy drift', () => {
  const lifecycle = structuredClone(roadmap);
  lifecycle.updatedAt = addIsoDateDays(lifecycle.updatedAt, 1);
  lifecycle.project.planVersion = '99.0';
  lifecycle.tasks[7].status = 'blocked';
  lifecycle.tasks[7].evidence = ['docs/THREAT-MODEL.md'];
  lifecycle.tasks[7].updatedAt = lifecycle.updatedAt;
  lifecycle.tasks[7].blockedReason = 'waiting for a new independent review';
  lifecycle.releaseGates[1].status = 'passed';
  for (const check of lifecycle.releaseGates[1].checks) {
    check.status = 'passed';
    check.evidence = 'docs/reviews/GOV-001.json';
  }
  assert.equal(semanticRoadmapPolicyDigest(lifecycle), semanticRoadmapPolicyDigest(roadmap));

  const policyDrift = structuredClone(roadmap);
  policyDrift.tasks[7].acceptance[0] = 'skip trust-boundary review';
  assert.notEqual(semanticRoadmapPolicyDigest(policyDrift), semanticRoadmapPolicyDigest(roadmap));

  const readme =
    '# Project\n\n## Current work\n\nGovernance decision status: **accepted**.\n\nFrozen policy.\n\n## Safety\n\nSafe.\n';
  assert.equal(
    semanticReadmeGovernanceDigest(readme),
    semanticReadmeGovernanceDigest(readme.replace('## Safety', '## Quick start\n\nUpdated.\n\n## Safety')),
  );
  assert.notEqual(
    semanticReadmeGovernanceDigest(readme),
    semanticReadmeGovernanceDigest(readme.replace('Frozen policy.', 'Weakened policy.')),
  );
});

test('optional historical blobs distinguish absence from object-read failure', async (t) => {
  const repository = await mkdtemp(resolve(tmpdir(), 'quantpass-governance-optional-'));
  t.after(() => rm(repository, { recursive: true, force: true }));
  await writeRepositoryFile(repository, 'docs/reviews/GOV-001.json', '{"present":true}\n');
  git(repository, ['init', '--quiet']);
  git(repository, ['config', 'user.name', 'Governance Test']);
  git(repository, ['config', 'user.email', 'governance-test@example.invalid']);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'historical review record']);
  const commit = git(repository, ['rev-parse', 'HEAD']).trim();
  const reviewBlob = git(repository, ['rev-parse', `${commit}:docs/reviews/GOV-001.json`]).trim();

  assert.equal(readOptionalCommitBlob(repository, commit, 'docs/reviews/GOV-001.md'), null);
  assert.match(readOptionalCommitBlob(repository, commit, 'docs/reviews/GOV-001.json'), /present/);
  await writeRepositoryFile(repository, 'docs/reviews/directory/child.txt', 'not a blob path\n');
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'tree entry fixture']);
  const treeCommit = git(repository, ['rev-parse', 'HEAD']).trim();
  assert.throws(
    () => readOptionalCommitBlob(repository, treeCommit, 'docs/reviews/directory'),
    /non-blob or mismatched entry/,
  );

  // Damage only this newly created fixture's loose object, not the process PATH.
  // This exercises real Git failures on Windows and POSIX without a shell shim.
  assert.match(reviewBlob, /^[0-9a-f]{40,64}$/);
  const objectPath = resolve(repository, '.git/objects', reviewBlob.slice(0, 2), reviewBlob.slice(2));
  const heldObject = resolve(repository, 'held-review-blob');
  await rename(objectPath, heldObject);
  try {
    assert.throws(
      () => readOptionalCommitBlob(repository, commit, 'docs/reviews/GOV-001.json'),
      /Git provenance command failed: git cat-file/,
    );
  } finally {
    await rename(heldObject, objectPath);
  }
  assert.match(readOptionalCommitBlob(repository, commit, 'docs/reviews/GOV-001.json'), /present/);
  assert.throws(
    () => readOptionalCommitBlob(repository, '0'.repeat(commit.length), 'docs/reviews/GOV-001.json'),
    /Git provenance command failed: git ls-tree/,
  );
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
  const reviewRoadmap = structuredClone(roadmap);
  const reviewGovernance = reviewRoadmap.tasks.find((task) => task.id === 'GOV-001');
  const reviewSupply = reviewRoadmap.tasks.find((task) => task.id === 'SUPPLY-001');
  reviewGovernance.status = 'in_progress';
  delete reviewGovernance.blockedReason;
  reviewSupply.status = 'done';
  reviewSupply.evidence = ['.github/workflows/ci.yml'];
  baselineFiles.set('planning/roadmap.json', `${JSON.stringify(reviewRoadmap, null, 2)}\n`);
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
  const acceptedRoadmap = structuredClone(reviewRoadmap);
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
    ciSha256: sha256(baselineFiles.get('.github/workflows/ci.yml')),
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
    ciText: baselineFiles.get('.github/workflows/ci.yml'),
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

  const nextCalendarDayReview = structuredClone(review);
  nextCalendarDayReview.reviewedAt = addIsoDateDays(reviewedAt, 1);
  const nextCalendarDayCurrent = {
    ...current,
    reviewText: `${JSON.stringify(nextCalendarDayReview, null, 2)}\n`,
    reviewReport: renderGovernanceReview(nextCalendarDayReview),
  };
  assert.doesNotThrow(() =>
    validateGovernanceReviewProvenance(nextCalendarDayReview, nextCalendarDayCurrent, {
      repositoryRoot: repository,
      now,
    }),
  );

  const impossibleLocalDate = structuredClone(nextCalendarDayReview);
  impossibleLocalDate.reviewedAt = addIsoDateDays(reviewedAt, 2);
  const impossibleLocalCurrent = {
    ...current,
    reviewText: `${JSON.stringify(impossibleLocalDate, null, 2)}\n`,
    reviewReport: renderGovernanceReview(impossibleLocalDate),
  };
  assert.throws(
    () =>
      validateGovernanceReviewProvenance(impossibleLocalDate, impossibleLocalCurrent, {
        repositoryRoot: repository,
        now,
      }),
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

  const decoyRepository = await mkdtemp(resolve(tmpdir(), 'quantpass-governance-decoy-'));
  t.after(() => rm(decoyRepository, { recursive: true, force: true }));
  git(decoyRepository, ['init', '--quiet']);
  git(decoyRepository, ['config', 'user.name', 'Governance Test']);
  git(decoyRepository, ['config', 'user.email', 'governance-test@example.invalid']);
  await writeRepositoryFile(decoyRepository, 'decoy.txt', 'ambient Git repository\n');
  git(decoyRepository, ['add', '--all']);
  git(decoyRepository, ['commit', '--quiet', '-m', 'ambient repository']);
  const poisonedGitEnvironment = {
    GIT_DIR: resolve(decoyRepository, '.git'),
    GIT_WORK_TREE: decoyRepository,
    GIT_INDEX_FILE: resolve(decoyRepository, '.git/index'),
    GIT_OBJECT_DIRECTORY: resolve(decoyRepository, '.git/objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: resolve(decoyRepository, '.git/objects'),
    GIT_SHALLOW_FILE: resolve(decoyRepository, '.git/shallow'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.repositoryformatversion',
    GIT_CONFIG_VALUE_0: '99',
    GIT_REPLACE_REF_BASE: 'refs/attacker-replacements/',
  };
  const originalGitEnvironment = Object.fromEntries(
    Object.keys(poisonedGitEnvironment).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, poisonedGitEnvironment);
  try {
    assert.doesNotThrow(() =>
      validateGovernanceReviewProvenance(review, current, { repositoryRoot: repository, now }),
    );
  } finally {
    for (const [name, value] of Object.entries(originalGitEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  git(repository, ['replace', reviewedCommit, unrelatedCommit]);
  assert.equal(git(repository, ['show', '-s', '--format=%s', reviewedCommit]).trim(), 'unrelated baseline');
  assert.doesNotThrow(() =>
    validateGovernanceReviewProvenance(review, current, { repositoryRoot: repository, now }),
  );
  git(repository, ['replace', '-d', reviewedCommit]);

  const nestedRoot = resolve(repository, 'nested-root');
  await mkdir(nestedRoot, { recursive: true });
  assert.throws(
    () => validateGovernanceReviewProvenance(review, current, { repositoryRoot: nestedRoot, now }),
    /repository root differs from the requested root/,
  );

  const shallowRepository = await mkdtemp(resolve(tmpdir(), 'quantpass-governance-shallow-'));
  await rm(shallowRepository, { recursive: true, force: true });
  t.after(() => rm(shallowRepository, { recursive: true, force: true }));
  execFileSync('git', ['clone', '--quiet', '--depth', '1', `file://${repository}`, shallowRepository], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.throws(
    () =>
      validateGovernanceReviewProvenance(review, current, {
        repositoryRoot: shallowRepository,
        now,
      }),
    /must contain complete history/,
  );

  const driftedAdr = `${current.adr}\n## Unreviewed post-acceptance override\n\nChange the accepted authority model.\n`;
  await writeRepositoryFile(repository, 'docs/adr/0001-testnet-mvp-scope-and-authority.md', driftedAdr);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'drift accepted ADR']);
  assert.throws(
    () =>
      validateGovernanceReviewProvenance(
        review,
        { ...current, adr: driftedAdr },
        {
          repositoryRoot: repository,
          now,
        },
      ),
    /current accepted ADR semantics differ from the reviewed artifact/,
  );
  await writeRepositoryFile(repository, 'docs/adr/0001-testnet-mvp-scope-and-authority.md', current.adr);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'restore reviewed ADR']);

  const driftedRoadmap = structuredClone(current.roadmap);
  driftedRoadmap.tasks.find((task) => task.id === 'THREAT-001').acceptance[0] =
    'skip trust-boundary validation';
  const driftedRoadmapText = `${JSON.stringify(driftedRoadmap, null, 2)}\n`;
  await writeRepositoryFile(repository, 'planning/roadmap.json', driftedRoadmapText);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'drift roadmap policy']);
  assert.throws(
    () =>
      validateGovernanceReviewProvenance(
        review,
        { ...current, roadmap: driftedRoadmap, roadmapText: driftedRoadmapText },
        { repositoryRoot: repository, now },
      ),
    /current roadmap policy differs from the reviewed artifact/,
  );
  await writeRepositoryFile(repository, 'planning/roadmap.json', current.roadmapText);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'restore reviewed roadmap policy']);

  const progressedRoadmap = structuredClone(current.roadmap);
  const completedThreat = progressedRoadmap.tasks.find((task) => task.id === 'THREAT-001');
  completedThreat.status = 'done';
  completedThreat.evidence = ['docs/THREAT-MODEL.md'];
  completedThreat.updatedAt = addIsoDateDays(completedThreat.updatedAt, 1);
  const nextTask = progressedRoadmap.tasks.find((task) => task.id === 'CONFIG-001');
  nextTask.status = 'in_progress';
  nextTask.updatedAt = completedThreat.updatedAt;
  progressedRoadmap.updatedAt = completedThreat.updatedAt;
  progressedRoadmap.project.planVersion = '2.4';
  const progressedRoadmapText = `${JSON.stringify(progressedRoadmap, null, 2)}\n`;
  await writeRepositoryFile(repository, 'planning/roadmap.json', progressedRoadmapText);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'advance roadmap lifecycle']);
  assert.doesNotThrow(() =>
    validateGovernanceReviewProvenance(
      review,
      { ...current, roadmap: progressedRoadmap, roadmapText: progressedRoadmapText },
      { repositoryRoot: repository, now },
    ),
  );
  await writeRepositoryFile(repository, 'planning/roadmap.json', current.roadmapText);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'restore lifecycle fixture']);

  const expandedReadme = `${current.readme}\nAdditional non-governance usage note.\n`;
  await writeRepositoryFile(repository, 'README.md', expandedReadme);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'update README outside governance section']);
  assert.doesNotThrow(() =>
    validateGovernanceReviewProvenance(
      review,
      { ...current, readme: expandedReadme },
      {
        repositoryRoot: repository,
        now,
      },
    ),
  );

  const driftedReadme = current.readme.replace(
    'GOV-001 acceptance evidence is tied to a real Git ancestor and a closed first-transition diff.',
    'GOV-001 acceptance may use an uncommitted or mutable snapshot.',
  );
  await writeRepositoryFile(repository, 'README.md', driftedReadme);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'drift README governance section']);
  assert.throws(
    () =>
      validateGovernanceReviewProvenance(
        review,
        { ...current, readme: driftedReadme },
        {
          repositoryRoot: repository,
          now,
        },
      ),
    /current README governance section differs from the reviewed artifact/,
  );
  await writeRepositoryFile(repository, 'README.md', current.readme);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'restore README governance section']);

  const driftedValidator = `${current.validatorText}\n// unreviewed post-acceptance validator change\n`;
  await writeRepositoryFile(repository, 'tools/check-governance-v2.mjs', driftedValidator);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'drift governance validator']);
  assert.throws(
    () =>
      validateGovernanceReviewProvenance(
        review,
        { ...current, validatorText: driftedValidator },
        {
          repositoryRoot: repository,
          now,
        },
      ),
    /current governance validator differs from the reviewed artifact/,
  );
  await writeRepositoryFile(repository, 'tools/check-governance-v2.mjs', current.validatorText);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'restore reviewed validator']);

  const driftedTest = `${current.governanceTest}\n// unreviewed post-acceptance test weakening\n`;
  await writeRepositoryFile(repository, 'test/governance.test.mjs', driftedTest);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'drift governance regression tests']);
  assert.throws(
    () =>
      validateGovernanceReviewProvenance(
        review,
        { ...current, governanceTest: driftedTest },
        {
          repositoryRoot: repository,
          now,
        },
      ),
    /current governance regression tests differ from the reviewed artifact/,
  );
  await writeRepositoryFile(repository, 'test/governance.test.mjs', current.governanceTest);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'restore reviewed governance tests']);

  const driftedCi = `${current.ciText}\n# unreviewed post-acceptance workflow change\n`;
  await writeRepositoryFile(repository, '.github/workflows/ci.yml', driftedCi);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'drift CI workflow']);
  assert.throws(
    () =>
      validateGovernanceReviewProvenance(
        review,
        { ...current, ciText: driftedCi },
        {
          repositoryRoot: repository,
          now,
        },
      ),
    /current CI workflow differs from the reviewed artifact/,
  );
  await writeRepositoryFile(repository, '.github/workflows/ci.yml', current.ciText);
  git(repository, ['add', '--all']);
  git(repository, ['commit', '--quiet', '-m', 'restore reviewed CI workflow']);

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
