import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePlan } from './build-planning.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const boundaryPath = resolve(root, 'planning/security-boundary.json');
const roadmapPath = resolve(root, 'planning/roadmap.json');
const adrPath = resolve(root, 'docs/adr/0001-testnet-mvp-scope-and-authority.md');
const appendixPath = resolve(root, 'docs/adr/0001-security-boundary.generated.md');
const readmePath = resolve(root, 'README.md');
const reviewRecordPath = resolve(root, 'docs/reviews/GOV-001.json');
const reviewReportPath = resolve(root, 'docs/reviews/GOV-001.md');
const governanceTestPath = resolve(root, 'test/governance.test.mjs');
const validatorPath = fileURLToPath(import.meta.url);
const ciPath = resolve(root, '.github/workflows/ci.yml');

const VERIFIED_REVIEW = Symbol('verified-governance-review');
const REVIEWABLE_PATHS = Object.freeze([
  '.github/workflows/ci.yml',
  'README.md',
  'docs/adr/0001-security-boundary.generated.md',
  'docs/adr/0001-testnet-mvp-scope-and-authority.md',
  'planning/roadmap.json',
  'planning/security-boundary.json',
  'test/governance.test.mjs',
  'tools/check-governance-v2.mjs',
]);
const ACCEPTANCE_TRANSITION_PATHS = Object.freeze([
  'README.md',
  'TODO.md',
  'docs/TASK-BOARD.md',
  'docs/adr/0001-security-boundary.generated.md',
  'docs/adr/0001-testnet-mvp-scope-and-authority.md',
  'docs/reviews/GOV-001.json',
  'docs/reviews/GOV-001.md',
  'docs/task-board.html',
  'planning/roadmap.json',
  'planning/security-boundary.json',
]);
const REVIEWER_IDS = Object.freeze(['gov-architecture', 'gov-roles-assets', 'gov-validation']);

// This digest excludes only review state and date. Every other byte of semantic JSON is a closed,
// review-required baseline; changing it requires updating this constant and the mutation tests.
const CLOSED_SECURITY_BASELINE_SHA256 = '36bf2426946939461134689b6d81f99d3cb8d5ccaeaea1fbc17ad9336885ef81';

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid governance boundary: ${message}`);
}

function requireString(value, field) {
  requireCondition(typeof value === 'string' && value.trim().length > 0, `${field} must be a string`);
}

function requireStringArray(value, field, minimum = 1) {
  requireCondition(
    Array.isArray(value) && value.length >= minimum,
    `${field} must contain ${minimum}+ items`,
  );
  value.forEach((item, index) => requireString(item, `${field}[${index}]`));
  requireCondition(new Set(value).size === value.length, `${field} must not contain duplicates`);
}

async function readOptionalTextFile(path, field) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw new Error(`Invalid governance boundary: ${field} cannot be read`, { cause: error });
  }
}

function requireExactKeys(value, expected, field) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value), `${field} must be an object`);
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  requireCondition(
    JSON.stringify(actual) === JSON.stringify(keys),
    `${field} keys must be exactly ${keys.join(', ')}`,
  );
}

function requireExactArray(actual, expected, field) {
  requireCondition(
    Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected),
    `${field} differs from the required closed set`,
  );
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function semanticReadmeDigest(readme) {
  requireString(readme, 'README document');
  const statusPattern =
    /^Governance decision status: \*\*(accepted|independent review \(not accepted\))\*\*\.$/gm;
  const matches = readme.match(statusPattern) ?? [];
  requireCondition(matches.length === 1, 'README must contain exactly one recognized governance status');
  return sha256Text(readme.replace(statusPattern, 'Governance decision status: **__DECISION_STATUS__**.'));
}

export function semanticAdrDigest(adr) {
  requireString(adr, 'ADR document');
  const normalized = adr.replace(/^- 状态：(独立复核中|已接受)$/m, '- 状态：__DECISION_STATUS__');
  requireCondition(normalized !== adr, 'ADR must contain exactly one recognized decision status');
  requireCondition(
    (adr.match(/^- 状态：(独立复核中|已接受)$/gm) ?? []).length === 1,
    'ADR must contain exactly one recognized decision status',
  );
  return sha256Text(normalized);
}

export function semanticReadmeGovernanceDigest(readme) {
  requireString(readme, 'README document');
  const heading = '## Current work\n';
  const start = readme.indexOf(heading);
  requireCondition(start >= 0, 'README must contain the Current work section');
  requireCondition(
    readme.indexOf(heading, start + heading.length) === -1,
    'README contains duplicate Current work sections',
  );
  const end = readme.indexOf('\n## ', start + heading.length);
  const section = readme.slice(start, end === -1 ? readme.length : end);
  return semanticReadmeDigest(section);
}

export function semanticRoadmapPolicyDigest(roadmap) {
  validatePlan(roadmap);
  const normalized = structuredClone(roadmap);
  normalized.updatedAt = '__LIFECYCLE_DATE__';
  requireCondition(
    normalized.project && typeof normalized.project === 'object',
    'roadmap.project must be an object',
  );
  normalized.project.planVersion = '__LIFECYCLE_VERSION__';
  for (const task of normalized.tasks) {
    task.status = '__LIFECYCLE_STATUS__';
    task.evidence = '__LIFECYCLE_EVIDENCE__';
    task.updatedAt = '__LIFECYCLE_DATE__';
    delete task.blockedReason;
  }
  for (const gate of normalized.releaseGates) {
    gate.status = '__LIFECYCLE_STATUS__';
    requireCondition(Array.isArray(gate.checks), `${gate.id ?? 'release gate'}.checks must be an array`);
    for (const check of gate.checks) {
      check.status = '__LIFECYCLE_STATUS__';
      check.evidence = '__LIFECYCLE_EVIDENCE__';
    }
  }
  return sha256Text(canonicalJson(normalized));
}

export function validateReviewDateWindow(reviewedAt, commitTimestamp, now = new Date()) {
  const reviewStart = Date.parse(`${reviewedAt}T00:00:00+14:00`);
  const nextReviewDate = new Date(`${reviewedAt}T00:00:00.000Z`);
  nextReviewDate.setUTCDate(nextReviewDate.getUTCDate() + 1);
  const reviewEnd = Date.parse(`${nextReviewDate.toISOString().slice(0, 10)}T00:00:00-12:00`);
  const commitInstant = Date.parse(commitTimestamp);
  const nowInstant = now.valueOf();
  requireCondition(Number.isFinite(commitInstant), 'reviewed commit timestamp is invalid');
  requireCondition(Number.isFinite(nowInstant), 'current time is invalid');
  requireCondition(commitInstant <= nowInstant, 'reviewed commit timestamp is in the future');
  requireCondition(reviewEnd > commitInstant, 'governanceReview.reviewedAt predates the reviewed commit');
  requireCondition(reviewStart <= nowInstant, 'governanceReview.reviewedAt is in the future');
}

export function semanticBoundaryDigest(boundary) {
  const normalized = structuredClone(boundary);
  normalized.updatedAt = '__DATE__';
  if (normalized.decision) normalized.decision.status = '__REVIEW_STATE__';
  return createHash('sha256').update(canonicalJson(normalized), 'utf8').digest('hex');
}

export function validateGovernanceDocumentStatus(boundary, adr, readme) {
  requireString(adr, 'ADR document');
  requireString(readme, 'README document');
  const expectedAdrStatus = boundary.decision.status === 'accepted' ? '- 状态：已接受' : '- 状态：独立复核中';
  const otherAdrStatus = boundary.decision.status === 'accepted' ? '- 状态：独立复核中' : '- 状态：已接受';
  const expectedReadmeStatus =
    boundary.decision.status === 'accepted'
      ? 'Governance decision status: **accepted**.'
      : 'Governance decision status: **independent review (not accepted)**.';
  const otherReadmeStatus =
    boundary.decision.status === 'accepted'
      ? 'Governance decision status: **independent review (not accepted)**.'
      : 'Governance decision status: **accepted**.';

  requireCondition(
    adr.split('\n').filter((line) => line === expectedAdrStatus).length === 1,
    `ADR status must match ${boundary.decision.status}`,
  );
  requireCondition(!adr.includes(otherAdrStatus), 'ADR contains a contradictory decision status');
  requireCondition(
    readme.split('\n').filter((line) => line === expectedReadmeStatus).length === 1,
    `README status must match ${boundary.decision.status}`,
  );
  requireCondition(!readme.includes(otherReadmeStatus), 'README contains a contradictory decision status');
  return { adr, readme };
}

export function validateGovernanceReview(review, boundary, artifactDigests) {
  requireExactKeys(
    review,
    [
      'schemaVersion',
      'taskId',
      'decisionId',
      'reviewedCommit',
      'reviewedAt',
      'reviewMethod',
      'reviewedSemanticDigest',
      'artifactDigests',
      'reviewers',
      'verdict',
      'aggregateBlockers',
      'nonBlockingRecommendations',
      'limitations',
    ],
    'governanceReview',
  );
  requireCondition(review.schemaVersion === 1, 'governanceReview.schemaVersion must be 1');
  requireCondition(review.taskId === 'GOV-001', 'governanceReview.taskId must be GOV-001');
  requireCondition(review.decisionId === 'ADR-0001', 'governanceReview.decisionId must be ADR-0001');
  requireCondition(
    /^[0-9a-f]{40}$/.test(review.reviewedCommit) && !/^0+$/.test(review.reviewedCommit),
    'governanceReview.reviewedCommit must be a nonzero full Git commit',
  );
  requireCondition(
    isRealIsoDate(review.reviewedAt),
    'governanceReview.reviewedAt must be a real YYYY-MM-DD calendar date',
  );
  requireCondition(
    review.reviewMethod === 'three-independent-read-only-reviews',
    'governanceReview.reviewMethod changed',
  );
  requireCondition(
    review.reviewedSemanticDigest === semanticBoundaryDigest(boundary),
    'governanceReview semantic digest does not match the boundary',
  );
  requireExactKeys(
    review.artifactDigests,
    [
      'adrNormalizedSha256',
      'ciSha256',
      'readmeNormalizedSha256',
      'roadmapSha256',
      'validatorSha256',
      'regressionTestsSha256',
    ],
    'governanceReview.artifactDigests',
  );
  for (const [name, digest] of Object.entries(review.artifactDigests)) {
    requireCondition(/^[0-9a-f]{64}$/.test(digest), `${name} must be a SHA-256 digest`);
    if (artifactDigests) {
      requireCondition(digest === artifactDigests[name], `${name} does not match reviewed content`);
    }
  }

  const expectedAreas = [
    'architecture-and-authority-boundary',
    'roles-assets-and-cryptography',
    'validator-and-state-transition',
  ];
  requireCondition(
    Array.isArray(review.reviewers) && review.reviewers.length === expectedAreas.length,
    'governanceReview must contain exactly three reviewers',
  );
  const reviewerIds = new Set();
  for (const [index, reviewer] of review.reviewers.entries()) {
    requireExactKeys(
      reviewer,
      [
        'area',
        'reviewerId',
        'independence',
        'verdict',
        'blockers',
        'evidence',
        'commands',
        'nonBlockingNotes',
      ],
      `governanceReview.reviewers[${index}]`,
    );
    requireCondition(reviewer.area === expectedAreas[index], `reviewer ${index} area changed`);
    requireCondition(
      reviewer.reviewerId === REVIEWER_IDS[index],
      `reviewer ${index}.reviewerId must be ${REVIEWER_IDS[index]}`,
    );
    requireCondition(!reviewerIds.has(reviewer.reviewerId), 'reviewer IDs must be distinct');
    reviewerIds.add(reviewer.reviewerId);
    requireCondition(
      reviewer.independence === 'read-only-no-edits-no-delegation',
      `${reviewer.area} independence statement changed`,
    );
    requireCondition(reviewer.verdict === 'pass', `${reviewer.area} must have a PASS verdict`);
    requireExactArray(reviewer.blockers, [], `${reviewer.area}.blockers`);
    requireStringArray(reviewer.evidence, `${reviewer.area}.evidence`, 2);
    requireStringArray(reviewer.commands, `${reviewer.area}.commands`);
    requireStringArray(reviewer.nonBlockingNotes, `${reviewer.area}.nonBlockingNotes`, 0);
  }
  requireCondition(review.verdict === 'pass', 'aggregate governance review verdict must be PASS');
  requireExactArray(review.aggregateBlockers, [], 'governanceReview.aggregateBlockers');
  requireStringArray(review.nonBlockingRecommendations, 'governanceReview.nonBlockingRecommendations', 0);
  requireStringArray(review.limitations, 'governanceReview.limitations', 0);
  return review;
}

function validateWritePlane(plane, expectedActivation, expectedTasks, expectedGates, field) {
  requireExactKeys(plane, ['enabled', 'activation', 'requiresCompletedTasks', 'requiresPassedGates'], field);
  requireCondition(plane.enabled === false, `${field} must remain disabled`);
  requireCondition(plane.activation === expectedActivation, `${field}.activation is unsafe`);
  requireExactArray(plane.requiresCompletedTasks, expectedTasks, `${field}.requiresCompletedTasks`);
  requireExactArray(plane.requiresPassedGates, expectedGates, `${field}.requiresPassedGates`);
}

function validateClosedRoles(boundary) {
  const expectedRoles = [
    [
      'owner',
      'wallet-signature',
      ['deposit_test_asset', 'withdraw_test_asset', 'revoke_pending_intent', 'sign_single_execution_intent'],
    ],
    ['strategy-runtime', 'release-manifest-pinned-ed25519-key', ['propose_bounded_decision']],
    ['risk-signer', 'deployment-manifest-pinned-evm-key', ['sign_bounded_execution_permit']],
    ['snapshot-signer', 'deployment-manifest-pinned-ed25519-key', ['sign_confirmed_account_snapshot']],
    ['pause-guardian', 'immutable-separate-guardian-address', ['irreversibly_pause_risk_increase']],
    ['deployer', 'one-time-low-balance-deployment-account', ['deploy_immutable_contract']],
    ['indexer', 'read-only-rpc-no-signing-key', ['read_confirmed_events', 'reconcile_state']],
  ];
  requireCondition(
    Array.isArray(boundary.roles) && boundary.roles.length === expectedRoles.length,
    'roles must be closed',
  );
  const seenRoles = new Set();
  for (const [index, role] of boundary.roles.entries()) {
    requireExactKeys(role, ['id', 'authority', 'capabilities'], `roles[${index}]`);
    const [id, authority, capabilities] = expectedRoles[index];
    requireCondition(role.id === id, `roles[${index}].id must be ${id}`);
    requireCondition(role.authority === authority, `${id}.authority differs from the approved model`);
    requireExactArray(role.capabilities, capabilities, `${id}.capabilities`);
    requireCondition(!seenRoles.has(role.id), `duplicate role ${role.id}`);
    seenRoles.add(role.id);
  }

  const expectedCapabilities = expectedRoles.flatMap(([roleId, , capabilities]) =>
    capabilities.map((id) => ({ id, owners: [roleId] })),
  );
  requireCondition(
    Array.isArray(boundary.capabilities) && boundary.capabilities.length === expectedCapabilities.length,
    'capability catalog must be closed',
  );
  const declared = new Map();
  for (const [index, capability] of boundary.capabilities.entries()) {
    requireExactKeys(capability, ['id', 'owners'], `capabilities[${index}]`);
    requireString(capability.id, `capabilities[${index}].id`);
    requireStringArray(capability.owners, `${capability.id}.owners`);
    requireCondition(!declared.has(capability.id), `duplicate capability ${capability.id}`);
    declared.set(capability.id, capability.owners);
  }
  for (const expected of expectedCapabilities) {
    requireExactArray(declared.get(expected.id), expected.owners, `${expected.id}.owners`);
  }
  for (const [roleId, , capabilities] of expectedRoles) {
    for (const capability of capabilities) {
      requireCondition(declared.get(capability)?.[0] === roleId, `${roleId} capability ownership mismatch`);
    }
  }
}

function validateSignatures(boundary) {
  const expected = [
    {
      id: 'owner-execution-intent',
      scheme: 'EIP-712',
      signerRole: 'owner',
      consumer: 'vault-contract',
      bindings: [
        'chainId',
        'verifyingContract',
        'vault',
        'owner',
        'asset',
        'target',
        'selector',
        'calldataHash',
        'value',
        'amountIn',
        'minimumAmountOut',
        'expectedVaultStateVersion',
        'vaultStateHash',
        'nonce',
        'deadline',
        'policyHash',
      ],
    },
    {
      id: 'risk-execution-permit',
      scheme: 'EIP-712',
      signerRole: 'risk-signer',
      consumer: 'vault-contract',
      bindings: [
        'chainId',
        'verifyingContract',
        'vault',
        'owner',
        'asset',
        'target',
        'selector',
        'calldataHash',
        'value',
        'amountIn',
        'minimumAmountOut',
        'expectedVaultStateVersion',
        'vaultStateHash',
        'ownerIntentHash',
        'decisionCommitment',
        'accountSnapshotCommitment',
        'nonce',
        'deadline',
        'policyHash',
      ],
    },
    {
      id: 'strategy-decision',
      scheme: 'Ed25519-canonical-json',
      signerRole: 'strategy-runtime',
      consumer: 'risk-service',
      bindings: [
        'decisionId',
        'strategyFamilyId',
        'strategyVersionId',
        'codeMeasurement',
        'policyHash',
        'accountSnapshotCommitment',
        'targetIntentHash',
        'nonce',
        'issuedAt',
        'expiresAt',
      ],
    },
    {
      id: 'account-snapshot',
      scheme: 'Ed25519-canonical-json',
      signerRole: 'snapshot-signer',
      consumer: 'risk-service',
      bindings: [
        'snapshotId',
        'chainId',
        'vault',
        'owner',
        'blockNumber',
        'blockHash',
        'vaultStateVersion',
        'vaultStateHash',
        'capturedAt',
        'balancesCommitment',
        'positionsCommitment',
      ],
    },
  ];
  requireCondition(
    Array.isArray(boundary.signatures) && boundary.signatures.length === expected.length,
    'signature catalog must be closed',
  );
  for (const [index, signature] of boundary.signatures.entries()) {
    const item = expected[index];
    requireExactKeys(
      signature,
      ['id', 'scheme', 'signerRole', 'consumer', 'implemented', 'trackedBy', 'requiredBindings'],
      `signatures[${index}]`,
    );
    requireCondition(signature.id === item.id, `signature ${index} must be ${item.id}`);
    requireCondition(signature.scheme === item.scheme, `${item.id}.scheme is unsafe`);
    requireCondition(signature.signerRole === item.signerRole, `${item.id}.signerRole is unsafe`);
    requireCondition(signature.consumer === item.consumer, `${item.id}.consumer is unsafe`);
    requireCondition(signature.implemented === false, `${item.id} must remain marked unimplemented`);
    requireCondition(signature.trackedBy === 'TRUST-001', `${item.id} must be tracked by TRUST-001`);
    requireExactArray(signature.requiredBindings, item.bindings, `${item.id}.requiredBindings`);
  }
}

function validateSecrets(boundary) {
  const expected = [
    ['owner-private-key', 'user-wallet', ['user-wallet-only']],
    ['strategy-runtime-private-key', 'isolated-strategy-runtime', ['runtime-key-provider']],
    ['risk-signer-private-key', 'isolated-risk-signer', ['hardware-or-managed-key-provider']],
    ['snapshot-signer-private-key', 'isolated-snapshot-signer', ['managed-key-provider']],
    ['deployer-private-key', 'one-time-low-balance-deployer', ['hardware-wallet-or-managed-key-provider']],
    ['pause-guardian-private-key', 'separate-guardian-wallet', ['hardware-wallet-or-managed-key-provider']],
  ];
  requireCondition(
    Array.isArray(boundary.secrets) && boundary.secrets.length === expected.length,
    'secret inventory must be closed',
  );
  for (const [index, secret] of boundary.secrets.entries()) {
    const [id, holder, storage] = expected[index];
    requireExactKeys(secret, ['id', 'holder', 'allowedStorage', 'forbiddenStorage'], `secrets[${index}]`);
    requireCondition(secret.id === id, `secret ${index} must be ${id}`);
    requireCondition(secret.holder === holder, `${id}.holder differs from the approved model`);
    requireExactArray(secret.allowedStorage, storage, `${id}.allowedStorage`);
    requireExactArray(
      secret.forbiddenStorage,
      id === 'owner-private-key'
        ? ['repository', 'server', 'plaintext-env', 'browser-storage', 'logs', 'ci']
        : ['repository', 'server-filesystem', 'plaintext-env', 'browser-storage', 'logs', 'ci'],
      `${id}.forbiddenStorage`,
    );
    requireCondition(
      secret.allowedStorage.every((location) => !secret.forbiddenStorage.includes(location)),
      `${id} storage sets must be disjoint`,
    );
  }
}

function validateTrustBoundaries(boundary) {
  const expected = [
    [
      'TB-01',
      'web-ui',
      'user-wallet',
      ['transaction-request', 'human-readable-eip712'],
      [
        'explicit-chain-address-amount-deadline-display',
        'one-intent-one-confirmation',
        'wallet-native-review',
      ],
    ],
    [
      'TB-02',
      'strategy-runtime',
      'risk-service',
      ['signed-strategy-decision'],
      ['pinned-release-key', 'policy-hash', 'decision-expiry', 'durable-decision-nonce'],
    ],
    [
      'TB-03',
      'confirmed-chain-state',
      'snapshot-signer',
      ['vault-state', 'block-number', 'block-hash'],
      ['chain-id-check', 'confirmation-policy', 'signed-snapshot-commitment'],
    ],
    [
      'TB-04',
      'risk-service',
      'user-wallet-or-permissionless-relayer',
      ['risk-execution-permit', 'owner-execution-intent'],
      [
        'dual-signature',
        'full-call-binding',
        'independent-nonce',
        'expected-vault-state-version',
        'short-deadline',
      ],
    ],
    [
      'TB-05',
      'user-wallet-or-permissionless-relayer',
      'vault-contract',
      ['signed-transaction', 'dual-signed-execution'],
      [
        'msg-sender-is-not-authorization',
        'contract-revalidation',
        'atomic-nonce-consumption',
        'exact-state-version-and-hash',
        'typed-call',
        'fixed-target-selector',
      ],
    ],
    [
      'TB-06',
      'rpc-provider',
      'adapter-and-indexer',
      ['chain-id', 'bytecode', 'receipt', 'logs', 'block-hash'],
      ['untrusted-rpc', 'runtime-hash-check', 'bounded-retry', 'reorg-rollback'],
    ],
    [
      'TB-07',
      'vault-contract',
      'fixed-token-or-venue',
      ['erc20-transfer', 'typed-allowlisted-call'],
      [
        'non-proxy-target',
        'exact-approval',
        'balance-delta-equality',
        'return-value-check',
        'reentrancy-guard',
      ],
    ],
    [
      'TB-08',
      'confirmed-chain-events',
      'application-view',
      ['confirmed-state', 'confirmation-level', 'reorg-status'],
      ['pending-not-success', 'event-identity', 'block-hash-checkpoint', 'contract-state-reconciliation'],
    ],
    [
      'TB-09',
      'deployment-and-release-manifest',
      'web-adapter-risk-service',
      ['trusted-addresses', 'runtime-hashes', 'abi-hash', 'release-key', 'policy-hash'],
      [
        'compile-time-pinned-expected-digest',
        'no-runtime-or-request-selection',
        'content-addressed-manifest',
        'build-provenance',
        'clean-rebuild',
        'cross-component-hash-check',
      ],
    ],
    [
      'TB-10',
      'local-browser',
      'local-demo-http-server',
      ['session-cookie', 'origin', 'simulation-command'],
      [
        'loopback-only-listener',
        'origin-and-csrf-enforcement',
        'http-only-session',
        'local-simulation-isolation',
        'no-testnet-adapter-import',
      ],
    ],
  ];
  requireCondition(
    Array.isArray(boundary.trustBoundaries) && boundary.trustBoundaries.length === expected.length,
    'trust boundary catalog must be closed',
  );
  for (const [index, item] of boundary.trustBoundaries.entries()) {
    const [id, from, to, data, controls] = expected[index];
    requireExactKeys(item, ['id', 'from', 'to', 'data', 'controls'], `trustBoundaries[${index}]`);
    requireCondition(item.id === id, `trust boundary ${index} must be ${id}`);
    requireCondition(item.from === from && item.to === to, `${id} endpoints differ from the approved model`);
    requireExactArray(item.data, data, `${id}.data`);
    requireExactArray(item.controls, controls, `${id}.controls`);
  }
}

export function validateSecurityBoundary(boundary) {
  requireExactKeys(
    boundary,
    [
      'schemaVersion',
      'updatedAt',
      'decision',
      'operatingModel',
      'environment',
      'custody',
      'contract',
      'assetPolicy',
      'capabilities',
      'roles',
      'roleLifecycle',
      'safeExit',
      'executionConcurrency',
      'nonceDomains',
      'signatures',
      'secrets',
      'trustBoundaries',
      'trustBootstrap',
      'prohibited',
    ],
    'root',
  );
  requireCondition(boundary.schemaVersion === 3, 'schemaVersion must be 3');
  requireCondition(isRealIsoDate(boundary.updatedAt), 'updatedAt must be a real YYYY-MM-DD date');
  requireExactKeys(boundary.decision, ['id', 'status', 'scope', 'supersedes'], 'decision');
  requireCondition(boundary.decision.id === 'ADR-0001', 'decision.id must be ADR-0001');
  requireCondition(
    ['review', 'accepted'].includes(boundary.decision.status),
    'decision must be review or accepted',
  );
  requireCondition(
    boundary.decision.scope === 'Robinhood Chain Testnet hackathon MVP',
    'decision scope changed',
  );
  requireExactArray(boundary.decision.supersedes, [], 'decision.supersedes');

  requireExactKeys(
    boundary.operatingModel,
    [
      'execution',
      'unattendedExecution',
      'humanReadableWalletConfirmationPerIntent',
      'pendingIsSuccess',
      'localSimulationMayReachTestnetAdapter',
    ],
    'operatingModel',
  );
  requireCondition(
    boundary.operatingModel.execution === 'user-confirmed-single-intent',
    'execution must be user-confirmed per intent',
  );
  requireCondition(
    boundary.operatingModel.unattendedExecution === false,
    'unattended execution is prohibited',
  );
  requireCondition(
    boundary.operatingModel.humanReadableWalletConfirmationPerIntent === true,
    'every intent needs readable confirmation',
  );
  requireCondition(boundary.operatingModel.pendingIsSuccess === false, 'pending must not be success');
  requireCondition(
    boundary.operatingModel.localSimulationMayReachTestnetAdapter === false,
    'local simulation must not reach testnet',
  );

  requireExactKeys(
    boundary.environment,
    ['allowed', 'chainId', 'mainnetSupported', 'realFundsSupported', 'writePlanes'],
    'environment',
  );
  requireExactArray(
    boundary.environment.allowed,
    ['local-simulation', 'robinhood-chain-testnet'],
    'environment.allowed',
  );
  requireCondition(boundary.environment.chainId === 46_630, 'only Robinhood Chain Testnet 46630 is allowed');
  requireCondition(boundary.environment.mainnetSupported === false, 'mainnet must remain unsupported');
  requireCondition(boundary.environment.realFundsSupported === false, 'real funds must remain unsupported');
  requireExactKeys(
    boundary.environment.writePlanes,
    ['deployment', 'application'],
    'environment.writePlanes',
  );
  validateWritePlane(
    boundary.environment.writePlanes.deployment,
    'manual-one-time-reviewed',
    [
      'GOV-001',
      'THREAT-001',
      'CONFIG-001',
      'ASSET-001',
      'TRUST-001',
      'TOOL-001',
      'SPEC-001',
      'SPEC-002',
      'ABI-001',
      'SUPPLY-001',
      'CON-001',
      'CON-002',
      'TST-001',
      'TST-002',
      'SEC-002',
      'KEY-001',
      'DRYRUN-001',
    ],
    ['G1', 'G2'],
    'environment.writePlanes.deployment',
  );
  validateWritePlane(
    boundary.environment.writePlanes.application,
    'explicit-reviewed-feature-flag',
    [
      'PRIV-001',
      'WALLET-001',
      'ADAPTER-001',
      'TX-001',
      'INDEX-001',
      'BACKEND-001',
      'RPC-001',
      'WEBSEC-001',
      'DEPLOY-001',
      'VERIFY-001',
      'OBS-001',
      'IR-001',
    ],
    ['G1', 'G2', 'G3'],
    'environment.writePlanes.application',
  );

  requireExactKeys(
    boundary.custody,
    ['model', 'applicationHoldsUserKeys', 'nonOwnerCanWithdraw', 'ownerDirectExitDuringPause', 'description'],
    'custody',
  );
  requireCondition(
    boundary.custody.model === 'protocol-contract-custody-application-non-custodial',
    'custody model changed',
  );
  requireCondition(
    boundary.custody.applicationHoldsUserKeys === false,
    'application must not hold user keys',
  );
  requireCondition(boundary.custody.nonOwnerCanWithdraw === false, 'non-owner withdrawal is prohibited');
  requireCondition(
    boundary.custody.ownerDirectExitDuringPause === true,
    'owner direct exit must survive pause',
  );
  requireString(boundary.custody.description, 'custody.description');

  requireExactKeys(
    boundary.contract,
    [
      'upgradeability',
      'proxyAllowed',
      'delegatecallAllowed',
      'arbitraryTargetOrCalldataAllowed',
      'callPolicy',
      'externalTargetUpgradeability',
      'approvalPolicy',
      'nativeValuePolicy',
      'externalPositionModel',
      'pauseMode',
      'unpauseAllowed',
      'migration',
    ],
    'contract',
  );
  requireCondition(boundary.contract.upgradeability === 'immutable-v1', 'v1 contract must be immutable');
  requireCondition(boundary.contract.proxyAllowed === false, 'proxy must be forbidden');
  requireCondition(boundary.contract.delegatecallAllowed === false, 'delegatecall must be forbidden');
  requireCondition(
    boundary.contract.arbitraryTargetOrCalldataAllowed === false,
    'arbitrary target/calldata must be forbidden',
  );
  requireCondition(
    boundary.contract.callPolicy === 'typed-fixed-target-and-selector-only',
    'call policy changed',
  );
  requireCondition(
    boundary.contract.externalTargetUpgradeability === 'reject-proxy-or-mutable-implementation',
    'mutable targets are forbidden',
  );
  requireCondition(
    boundary.contract.approvalPolicy === 'exact-amount-reset-to-zero',
    'approval policy changed',
  );
  requireCondition(
    boundary.contract.nativeValuePolicy === 'zero-only-no-native-asset',
    'native value must be zero and native asset custody is forbidden',
  );
  requireCondition(
    boundary.contract.externalPositionModel === 'atomic-only-no-async-external-custody',
    'async external custody is forbidden',
  );
  requireCondition(
    boundary.contract.pauseMode === 'irreversible-for-address',
    'pause must be irreversible for this address',
  );
  requireCondition(boundary.contract.unpauseAllowed === false, 'unpause must be forbidden');
  requireCondition(
    boundary.contract.migration === 'owner-withdraws-to-wallet-then-explicitly-deposits-new-address',
    'admin migration is forbidden',
  );

  requireExactKeys(
    boundary.assetPolicy,
    [
      'maxAssetCountPerVault',
      'selection',
      'activeAllowlist',
      'eligibleAfterAssetReview',
      'faucetPolicy',
      'depositAccounting',
      'requiredProperties',
      'rejectedBehaviors',
    ],
    'assetPolicy',
  );
  requireCondition(boundary.assetPolicy.maxAssetCountPerVault === 1, 'each vault supports at most one asset');
  requireCondition(boundary.assetPolicy.selection === 'immutable-at-deployment', 'asset must be immutable');
  requireExactArray(boundary.assetPolicy.activeAllowlist, [], 'assetPolicy.activeAllowlist');
  requireExactArray(
    boundary.assetPolicy.eligibleAfterAssetReview,
    ['project-deployed-fixed-supply-clearly-labelled-test-token'],
    'assetPolicy.eligibleAfterAssetReview',
  );
  requireCondition(
    boundary.assetPolicy.faucetPolicy === 'transfer-preallocated-test-supply-to-user-never-mint-to-vault',
    'faucet policy changed',
  );
  requireCondition(
    boundary.assetPolicy.depositAccounting === 'reject-unless-balance-delta-equals-requested-amount',
    'deposit accounting changed',
  );
  requireExactArray(
    boundary.assetPolicy.requiredProperties,
    [
      'erc20-return-values-checked',
      'decimals-pinned-and-validated',
      'runtime-bytecode-hash-pinned',
      'address-and-chain-id-pinned',
      'fixed-supply',
      'no-admin-balance-mutation',
      'no-owner-admin-or-privileged-role',
      'holder-transfers-cannot-be-paused-frozen-or-gated',
      'source-bytecode-and-negative-behavior-tests-required',
    ],
    'assetPolicy.requiredProperties',
  );
  requireExactArray(
    boundary.assetPolicy.rejectedBehaviors,
    [
      'fee-on-transfer',
      'rebasing',
      'erc777-or-callback-hooks',
      'unknown-or-changing-decimals',
      'unverified-runtime-bytecode',
      'hidden-transfer-tax',
      'admin-mint-to-vault',
      'confiscation-or-blacklist',
      'burn-from-vault',
      'proxy-or-mutable-implementation',
      'global-pause-or-freeze',
      'transfer-allowlist-or-gating',
      'owner-admin-or-access-control-role',
    ],
    'assetPolicy.rejectedBehaviors',
  );

  validateClosedRoles(boundary);
  requireExactKeys(
    boundary.roleLifecycle,
    [
      'zeroAddressOrKeyAllowed',
      'evmRoleAddressesPairwiseDistinct',
      'ed25519TrustKeysPairwiseDistinct',
      'crossRoleKeyMaterialReuseAllowed',
      'identityComparison',
      'inPlaceRotation',
      'replacement',
      'deployerRetainsPostDeploymentPrivilege',
    ],
    'roleLifecycle',
  );
  requireCondition(
    boundary.roleLifecycle.zeroAddressOrKeyAllowed === false,
    'zero role addresses and empty trust keys are forbidden',
  );
  requireExactArray(
    boundary.roleLifecycle.evmRoleAddressesPairwiseDistinct,
    ['risk-signer', 'pause-guardian', 'deployer'],
    'roleLifecycle.evmRoleAddressesPairwiseDistinct',
  );
  requireExactArray(
    boundary.roleLifecycle.ed25519TrustKeysPairwiseDistinct,
    ['strategy-runtime', 'snapshot-signer'],
    'roleLifecycle.ed25519TrustKeysPairwiseDistinct',
  );
  requireCondition(
    boundary.roleLifecycle.crossRoleKeyMaterialReuseAllowed === false,
    'security roles must use distinct key material',
  );
  requireCondition(
    boundary.roleLifecycle.identityComparison === 'canonical-address-or-public-key-fingerprint-as-applicable',
    'security identity comparison policy changed',
  );
  requireCondition(
    boundary.roleLifecycle.inPlaceRotation === false,
    'in-place security-root rotation is forbidden',
  );
  requireCondition(
    boundary.roleLifecycle.replacement ===
      'irreversible-pause-owner-exit-new-manifest-new-contract-explicit-owner-reauthorization',
    'replacement flow changed',
  );
  requireCondition(
    boundary.roleLifecycle.deployerRetainsPostDeploymentPrivilege === false,
    'deployer must retain no privilege',
  );

  requireExactKeys(
    boundary.safeExit,
    [
      'availableDuringPause',
      'riskIncreasingActionsBlocked',
      'ownerActionsAlwaysAllowed',
      'onlyAssetOutflowDuringPause',
      'asyncExternalPositionsAllowed',
      'unpauseOrAdminMigrationAllowed',
    ],
    'safeExit',
  );
  requireCondition(boundary.safeExit.availableDuringPause === true, 'safe exit must remain available');
  requireExactArray(
    boundary.safeExit.riskIncreasingActionsBlocked,
    ['deposit', 'new_execution_intent', 'new_strategy_or_venue_call'],
    'safeExit.riskIncreasingActionsBlocked',
  );
  requireExactArray(
    boundary.safeExit.ownerActionsAlwaysAllowed,
    ['revoke_pending_intent', 'withdraw_test_asset'],
    'safeExit.ownerActionsAlwaysAllowed',
  );
  requireCondition(
    boundary.safeExit.onlyAssetOutflowDuringPause === 'vault-to-owner-withdrawal',
    'pause must allow only Vault-to-owner asset outflow',
  );
  requireCondition(
    boundary.safeExit.asyncExternalPositionsAllowed === false,
    'async external positions are forbidden',
  );
  requireCondition(
    boundary.safeExit.unpauseOrAdminMigrationAllowed === false,
    'unpause/admin migration is forbidden',
  );

  requireExactKeys(
    boundary.executionConcurrency,
    ['stateVersion', 'signedPrecondition', 'contractEnforcement', 'riskServiceIssuance', 'snapshotReuse'],
    'executionConcurrency',
  );
  requireCondition(
    boundary.executionConcurrency.stateVersion ===
      'monotonic-on-chain-increment-on-every-successful-vault-state-mutation',
    'every successful Vault state mutation must increment the state version',
  );
  requireCondition(
    boundary.executionConcurrency.signedPrecondition ===
      'owner-and-risk-bind-expected-state-version-and-state-hash',
    'owner and risk signatures must bind the expected Vault state',
  );
  requireCondition(
    boundary.executionConcurrency.contractEnforcement ===
      'exact-match-then-atomic-state-change-and-increment',
    'Vault state-version enforcement changed',
  );
  requireCondition(
    boundary.executionConcurrency.riskServiceIssuance ===
      'serializable-single-reservation-per-vault-and-state-version',
    'risk permits must be issued through a serializable single-flight reservation',
  );
  requireCondition(
    boundary.executionConcurrency.snapshotReuse === 'at-most-one-execution-per-vault-state-version',
    'a snapshot must not authorize concurrent executions',
  );

  requireCondition(
    Array.isArray(boundary.nonceDomains) && boundary.nonceDomains.length === 4,
    'nonce domains must be closed',
  );
  const expectedNonces = [
    ['owner-intent', 'vault-contract', 'on-chain-atomic'],
    ['risk-permit', 'vault-contract', 'on-chain-atomic'],
    ['strategy-decision', 'risk-service', 'durable-transactional'],
    ['vault-state-version', 'vault-contract', 'on-chain-atomic-exact-match-and-increment'],
  ];
  for (const [index, nonce] of boundary.nonceDomains.entries()) {
    requireExactKeys(nonce, ['id', 'consumer', 'persistence'], `nonceDomains[${index}]`);
    requireCondition(
      JSON.stringify([nonce.id, nonce.consumer, nonce.persistence]) === JSON.stringify(expectedNonces[index]),
      `nonceDomains[${index}] changed`,
    );
  }

  validateSignatures(boundary);
  validateSecrets(boundary);
  validateTrustBoundaries(boundary);
  requireExactKeys(
    boundary.trustBootstrap,
    [
      'mode',
      'currentManifestDigest',
      'runtimeOrRequestSelectionAllowed',
      'requiredConsumers',
      'mismatchPolicy',
      'rotation',
      'walletDisplay',
      'activationTask',
    ],
    'trustBootstrap',
  );
  requireCondition(
    boundary.trustBootstrap.mode === 'reviewed-manifest-digest-compiled-into-web-and-risk-service-releases',
    'manifest trust anchor mode changed',
  );
  requireCondition(
    boundary.trustBootstrap.currentManifestDigest === null,
    'manifest digest must remain unset until TRUST-001 independent review',
  );
  requireCondition(
    boundary.trustBootstrap.runtimeOrRequestSelectionAllowed === false,
    'runtime or request selection of a manifest trust root is forbidden',
  );
  requireExactArray(
    boundary.trustBootstrap.requiredConsumers,
    ['web-release', 'risk-service-release'],
    'trustBootstrap.requiredConsumers',
  );
  requireCondition(
    boundary.trustBootstrap.mismatchPolicy === 'fail-closed-disable-all-testnet-writes',
    'manifest mismatch policy changed',
  );
  requireCondition(
    boundary.trustBootstrap.rotation === 'new-independent-review-new-release-and-adr-required',
    'manifest trust-root rotation must require a new review and release',
  );
  requireCondition(
    boundary.trustBootstrap.walletDisplay === 'chain-contract-addresses-and-manifest-digest-required',
    'wallet display must expose the manifest trust anchor',
  );
  requireCondition(
    boundary.trustBootstrap.activationTask === 'TRUST-001',
    'manifest trust-root activation must remain tracked by TRUST-001',
  );
  requireExactArray(
    boundary.prohibited,
    [
      'mainnet-or-unknown-network',
      'real-value-assets',
      'unattended-or-autonomous-trading',
      'application-custody-of-user-keys',
      'automatic-hidden-or-batch-wallet-signing',
      'arbitrary-target-calldata-or-delegatecall',
      'native-asset-custody-or-nonzero-call-value',
      'proxy-upgrade-path',
      'non-owner-withdrawal-or-arbitrary-recipient-transfer',
      'unlimited-token-approval',
      'caller-supplied-trust-root',
      'runtime-or-request-selected-manifest-digest',
      'in-memory-only-replay-protection',
      'pending-transaction-presented-as-success',
      'local-simulation-role-promotion-reaching-testnet',
      'async-external-custody-or-pending-position',
      'admin-mint-confiscate-blacklist-or-burn-from-vault',
      'admin-bulk-migration-or-silent-address-replacement',
      'privileged-or-identity-bound-relayer',
    ],
    'prohibited',
  );

  requireCondition(
    semanticBoundaryDigest(boundary) === CLOSED_SECURITY_BASELINE_SHA256,
    'closed security baseline digest changed; independent review is required',
  );
  return boundary;
}

export function validateRoadmapAlignment(boundary, roadmap, review = null, reviewVerification = null) {
  requireCondition(roadmap?.project?.chainId === boundary.environment.chainId, 'roadmap Chain ID mismatch');
  const tasks = new Map(roadmap.tasks.map((task) => [task.id, task]));
  const gates = new Map(roadmap.releaseGates.map((gate) => [gate.id, gate]));
  for (const [name, plane] of Object.entries(boundary.environment.writePlanes)) {
    for (const id of plane.requiresCompletedTasks) {
      requireCondition(tasks.has(id), `${name} write plane references unknown task ${id}`);
      if (plane.enabled)
        requireCondition(tasks.get(id).status === 'done', `${name} write plane enabled before ${id}`);
    }
    for (const id of plane.requiresPassedGates) {
      requireCondition(gates.has(id), `${name} write plane references unknown gate ${id}`);
      if (plane.enabled)
        requireCondition(gates.get(id).status === 'passed', `${name} write plane enabled before ${id}`);
    }
  }
  const governance = tasks.get('GOV-001');
  requireCondition(governance, 'roadmap must contain GOV-001');
  if (boundary.decision.status === 'review') {
    requireCondition(
      governance.status === 'in_progress' || governance.status === 'blocked',
      'review decision requires GOV-001 in progress or explicitly blocked',
    );
    if (governance.status === 'blocked') {
      requireCondition(
        governance.dependsOn.includes('SUPPLY-001'),
        'blocked GOV-001 must depend on the external SUPPLY-001 enforcement boundary',
      );
    }
  } else {
    requireCondition(governance.status === 'done', 'accepted decision requires GOV-001 done');
    const expectedEvidence = [
      'docs/adr/0001-testnet-mvp-scope-and-authority.md',
      'docs/adr/0001-security-boundary.generated.md',
      'docs/reviews/GOV-001.json',
      'docs/reviews/GOV-001.md',
      'planning/security-boundary.json',
      'tools/check-governance-v2.mjs',
      'test/governance.test.mjs',
    ];
    requireExactArray(governance.evidence, expectedEvidence, 'GOV-001.evidence');
    validateGovernanceReview(review, boundary);
    requireCondition(
      reviewVerification?.[VERIFIED_REVIEW] === true && reviewVerification.review === review,
      'accepted decision requires verified Git review provenance',
    );
  }
  return roadmap;
}

function renderTable(headers, rows) {
  return `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')}`;
}

export function renderSecurityBoundaryAppendix(boundary) {
  const roles = renderTable(
    ['角色', '凭证/信任来源', '唯一能力'],
    boundary.roles.map((role) => [
      `\`${role.id}\``,
      `\`${role.authority}\``,
      role.capabilities.map((item) => `\`${item}\``).join('<br>'),
    ]),
  );
  const signatures = renderTable(
    ['签名', '方案', '签名者', '消费方', '绑定字段'],
    boundary.signatures.map((signature) => [
      `\`${signature.id}\``,
      `\`${signature.scheme}\``,
      `\`${signature.signerRole}\``,
      `\`${signature.consumer}\``,
      signature.requiredBindings.map((item) => `\`${item}\``).join('<br>'),
    ]),
  );
  const secrets = renderTable(
    ['秘密', '持有者', '允许存储', '禁止存储'],
    boundary.secrets.map((secret) => [
      `\`${secret.id}\``,
      `\`${secret.holder}\``,
      secret.allowedStorage.map((item) => `\`${item}\``).join('<br>'),
      secret.forbiddenStorage.map((item) => `\`${item}\``).join('<br>'),
    ]),
  );
  const trust = renderTable(
    ['ID', '来源 → 目标', '数据', '强制控制'],
    boundary.trustBoundaries.map((item) => [
      `\`${item.id}\``,
      `\`${item.from}\` → \`${item.to}\``,
      item.data.map((value) => `\`${value}\``).join('<br>'),
      item.controls.map((value) => `\`${value}\``).join('<br>'),
    ]),
  );
  const planes = renderTable(
    ['写平面', '当前', '激活方式', '任务门禁', 'Gate'],
    Object.entries(boundary.environment.writePlanes).map(([name, plane]) => [
      `\`${name}\``,
      plane.enabled ? '开启' : '关闭',
      `\`${plane.activation}\``,
      plane.requiresCompletedTasks.map((item) => `\`${item}\``).join('<br>'),
      plane.requiresPassedGates.map((item) => `\`${item}\``).join('<br>'),
    ]),
  );
  return [
    '# ADR-0001 机器约束附录',
    '',
    '> 自动生成文件。唯一事实源为 `planning/security-boundary.json`；禁止手工修改。',
    '',
    `- Schema：${boundary.schemaVersion}`,
    `- 决策状态：\`${boundary.decision.status}\``,
    `- Chain ID：\`${boundary.environment.chainId}\``,
    `- 执行模式：\`${boundary.operatingModel.execution}\``,
    `- 无人值守执行：${boundary.operatingModel.unattendedExecution ? '允许' : '禁止'}`,
    `- 语义摘要：\`${semanticBoundaryDigest(boundary)}\``,
    '',
    '## 写平面',
    '',
    planes,
    '',
    '## 角色与唯一能力',
    '',
    roles,
    '',
    'Relayer 不属于角色或能力闭集；任意提交者的 `msg.sender` 均不构成授权。',
    '',
    '## 身份与密钥分离',
    '',
    `- EVM 地址互异：${boundary.roleLifecycle.evmRoleAddressesPairwiseDistinct.map((item) => `\`${item}\``).join('、')}。`,
    `- Ed25519 key 指纹互异：${boundary.roleLifecycle.ed25519TrustKeysPairwiseDistinct.map((item) => `\`${item}\``).join('、')}。`,
    `- 跨角色复用密钥材料：${boundary.roleLifecycle.crossRoleKeyMaterialReuseAllowed ? '允许' : '禁止'}。`,
    '',
    '## 签名与域绑定',
    '',
    signatures,
    '',
    '## 并发与状态新鲜度',
    '',
    `- 状态版本：\`${boundary.executionConcurrency.stateVersion}\`。`,
    `- 签名条件：\`${boundary.executionConcurrency.signedPrecondition}\`。`,
    `- 合约校验：\`${boundary.executionConcurrency.contractEnforcement}\`。`,
    `- 风险签发：\`${boundary.executionConcurrency.riskServiceIssuance}\`。`,
    `- 快照复用：\`${boundary.executionConcurrency.snapshotReuse}\`。`,
    '',
    '## 秘密清单',
    '',
    secrets,
    '',
    '## 信任边界',
    '',
    trust,
    '',
    '## Manifest 信任根自举',
    '',
    `- 模式：\`${boundary.trustBootstrap.mode}\`。`,
    `- 当前 digest：${boundary.trustBootstrap.currentManifestDigest === null ? '未设置；Testnet 写入保持关闭' : `\`${boundary.trustBootstrap.currentManifestDigest}\``}。`,
    `- 运行时/请求选择：${boundary.trustBootstrap.runtimeOrRequestSelectionAllowed ? '允许' : '禁止'}。`,
    `- 不一致策略：\`${boundary.trustBootstrap.mismatchPolicy}\`。`,
    `- 变更流程：\`${boundary.trustBootstrap.rotation}\`。`,
    '',
    '## 当前资产策略',
    '',
    '- Active allowlist：空；`ASSET-001` 完成前没有任何可写入 Testnet 的资产。',
    `- 候选：${boundary.assetPolicy.eligibleAfterAssetReview.map((item) => `\`${item}\``).join('、')}`,
    `- Deposit：\`${boundary.assetPolicy.depositAccounting}\``,
    `- 原生币 value：\`${boundary.contract.nativeValuePolicy}\``,
    `- 拒绝：${boundary.assetPolicy.rejectedBehaviors.map((item) => `\`${item}\``).join('、')}`,
    '',
    '## 暂停、退出与迁移',
    '',
    `- Pause：\`${boundary.contract.pauseMode}\`；不允许 unpause。`,
    `- Pause 后 owner 始终可执行：${boundary.safeExit.ownerActionsAlwaysAllowed.map((item) => `\`${item}\``).join('、')}。`,
    `- Pause 后唯一资产外流：\`${boundary.safeExit.onlyAssetOutflowDuringPause}\`。`,
    '- 外部异步托管：禁止。允许执行必须在同一交易中原子结束并把资产留在 Vault。',
    `- 迁移：\`${boundary.contract.migration}\`。`,
    '',
    '## 禁止项',
    '',
    boundary.prohibited.map((item) => `- \`${item}\``).join('\n'),
    '',
  ].join('\n');
}

export function renderGovernanceReview(review) {
  const reviewers = review.reviewers
    .map(
      (item) =>
        `## ${item.area}\n\n- Reviewer：\`${item.reviewerId}\`\n- Independence：\`${item.independence}\`\n- Verdict：\`${item.verdict}\`\n- Blockers：none\n\nEvidence：\n\n${item.evidence.map((entry) => `- ${entry}`).join('\n')}\n\nCommands：\n\n${item.commands.map((entry) => `- \`${entry}\``).join('\n')}\n\nNon-blocking notes：\n\n${item.nonBlockingNotes.length === 0 ? '- none' : item.nonBlockingNotes.map((entry) => `- ${entry}`).join('\n')}`,
    )
    .join('\n\n');
  const recommendations =
    review.nonBlockingRecommendations.length === 0
      ? '- none'
      : review.nonBlockingRecommendations.map((item) => `- ${item}`).join('\n');
  const limitations =
    review.limitations.length === 0 ? '- none' : review.limitations.map((item) => `- ${item}`).join('\n');
  return `# GOV-001 独立复核记录\n\n> 自动生成文件。唯一事实源为 \`docs/reviews/GOV-001.json\`；禁止手工修改。\n\n- Decision：\`${review.decisionId}\`\n- Reviewed commit：\`${review.reviewedCommit}\`\n- Reviewed at：\`${review.reviewedAt}\`\n- Method：\`${review.reviewMethod}\`\n- Semantic digest：\`${review.reviewedSemanticDigest}\`\n- Aggregate verdict：\`${review.verdict}\`\n- Aggregate blockers：none\n- Git provenance：复核提交必须真实存在，并位于首次验收提交的 first-parent 路径上；首次验收只允许闭集状态转换。\n\n## 受复核工件摘要\n\n- ADR（状态归一化）：\`${review.artifactDigests.adrNormalizedSha256}\`\n- README（状态归一化）：\`${review.artifactDigests.readmeNormalizedSha256}\`\n- Roadmap（复核快照）：\`${review.artifactDigests.roadmapSha256}\`\n- CI workflow：\`${review.artifactDigests.ciSha256}\`\n- Validator：\`${review.artifactDigests.validatorSha256}\`\n- Regression tests：\`${review.artifactDigests.regressionTestsSha256}\`\n\n${reviewers}\n\n## 非阻断建议\n\n${recommendations}\n\n## 局限\n\n${limitations}\n`;
}

const GIT_GLOBAL_ARGS = Object.freeze([
  '--no-replace-objects',
  '--no-optional-locks',
  '--no-pager',
  '--literal-pathspecs',
  '-c',
  'core.fsmonitor=false',
]);

function sanitizedGitEnvironment() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name, value]) => !name.toUpperCase().startsWith('GIT_') && value !== undefined,
    ),
  );
  return {
    ...env,
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
  };
}

function executeGit(args, env, allowFailure = false, operation = args.at(-1)) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      env,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    if (allowFailure) return null;
    throw new Error(`Invalid governance boundary: Git provenance command failed: git ${operation}`);
  }
}

function createGitContext(repositoryRoot) {
  try {
    const expected = realpathSync(repositoryRoot);
    const env = sanitizedGitEnvironment();
    const discovery = executeGit(
      [
        ...GIT_GLOBAL_ARGS,
        '-C',
        expected,
        'rev-parse',
        '--show-toplevel',
        '--absolute-git-dir',
        '--is-bare-repository',
        '--is-shallow-repository',
      ],
      env,
      false,
      'rev-parse',
    )
      .trim()
      .split('\n');
    requireCondition(discovery.length === 4, 'Git provenance repository discovery is incomplete');
    const [topLevel, gitDirectory, isBare, isShallow] = discovery;
    const actual = realpathSync(topLevel);
    requireCondition(actual === expected, 'Git provenance repository root differs from the requested root');
    requireCondition(isBare === 'false', 'Git provenance repository must not be bare');
    requireCondition(isShallow === 'false', 'Git provenance repository must contain complete history');
    return Object.freeze({
      env: Object.freeze(env),
      gitDirectory: realpathSync(gitDirectory),
      workTree: expected,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid governance boundary:')) throw error;
    throw new Error('Invalid governance boundary: Git provenance repository root cannot be verified', {
      cause: error,
    });
  }
}

function resolveGitContext(contextOrRoot) {
  return typeof contextOrRoot === 'string' ? createGitContext(contextOrRoot) : contextOrRoot;
}

function runGit(contextOrRoot, args, allowFailure = false) {
  const context = resolveGitContext(contextOrRoot);
  return executeGit(
    [...GIT_GLOBAL_ARGS, `--git-dir=${context.gitDirectory}`, `--work-tree=${context.workTree}`, ...args],
    context.env,
    allowFailure,
    args[0],
  );
}

function readCommitBlob(contextOrRoot, commit, path) {
  const content = runGit(contextOrRoot, ['show', `${commit}:${path}`], true);
  requireCondition(content !== null, `reviewed Git snapshot is missing ${path}`);
  return content;
}

export function readOptionalCommitBlob(contextOrRoot, commit, path) {
  const context = resolveGitContext(contextOrRoot);
  const entries = parseNulPaths(runGit(context, ['ls-tree', '-z', '--full-tree', commit, '--', path]));
  if (entries.length === 0) return null;
  requireCondition(
    entries.length === 1,
    `reviewed Git snapshot returned an ambiguous tree entry for ${path}`,
  );
  const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([\s\S]+)$/.exec(entries[0]);
  requireCondition(
    match && match[2] === 'blob' && match[4] === path,
    `reviewed Git snapshot contains a non-blob or mismatched entry for ${path}`,
  );
  return runGit(context, ['cat-file', 'blob', match[3]]);
}

function parseNulPaths(value) {
  return value.split('\0').filter(Boolean);
}

function requireExactTransitionPaths(actualPaths) {
  const actual = [...new Set(actualPaths)].sort();
  const expected = [...ACCEPTANCE_TRANSITION_PATHS].sort();
  requireCondition(
    JSON.stringify(actual) === JSON.stringify(expected),
    `acceptance transition paths must be exactly ${expected.join(', ')}; got ${actual.join(', ')}`,
  );
}

function normalizeRoadmapTransition(roadmap) {
  const normalized = structuredClone(roadmap);
  requireCondition(isRealIsoDate(normalized.updatedAt), 'roadmap.updatedAt must be a real date');
  normalized.updatedAt = '__TRANSITION_DATE__';
  const governance = normalized.tasks?.find((task) => task.id === 'GOV-001');
  const threat = normalized.tasks?.find((task) => task.id === 'THREAT-001');
  requireCondition(governance && threat, 'governance transition tasks are missing');
  requireCondition(isRealIsoDate(governance.updatedAt), 'GOV-001.updatedAt must be a real date');
  requireCondition(isRealIsoDate(threat.updatedAt), 'THREAT-001.updatedAt must be a real date');
  governance.status = '__GOVERNANCE_TRANSITION_STATUS__';
  governance.evidence = '__GOVERNANCE_TRANSITION_EVIDENCE__';
  governance.updatedAt = '__TRANSITION_DATE__';
  threat.status = '__NEXT_TASK_STATUS__';
  threat.updatedAt = '__TRANSITION_DATE__';
  return canonicalJson(normalized);
}

function parseSnapshot(snapshot, expectedStatus) {
  const boundary = validateSecurityBoundary(JSON.parse(snapshot.boundaryText));
  const roadmap = JSON.parse(snapshot.roadmapText);
  requireCondition(
    boundary.decision.status === expectedStatus,
    `Git snapshot decision status must be ${expectedStatus}`,
  );
  validateGovernanceDocumentStatus(boundary, snapshot.adr, snapshot.readme);
  requireCondition(
    snapshot.appendix === renderSecurityBoundaryAppendix(boundary),
    'Git snapshot contains a stale generated boundary appendix',
  );

  if (expectedStatus === 'review') {
    requireCondition(snapshot.reviewText === null, 'reviewed commit must not contain a final review record');
    requireCondition(
      snapshot.reviewReport === null,
      'reviewed commit must not contain a final review report',
    );
    validateRoadmapAlignment(boundary, roadmap);
    return { ...snapshot, boundary, roadmap, review: null };
  }

  requireCondition(snapshot.reviewText !== null, 'acceptance snapshot is missing the review record');
  requireCondition(snapshot.reviewReport !== null, 'acceptance snapshot is missing the review report');
  const review = validateGovernanceReview(JSON.parse(snapshot.reviewText), boundary);
  requireCondition(
    snapshot.reviewReport === renderGovernanceReview(review),
    'acceptance snapshot contains a stale governance review report',
  );
  const provisionalVerification = { [VERIFIED_REVIEW]: true, review };
  validateRoadmapAlignment(boundary, roadmap, review, provisionalVerification);
  return { ...snapshot, boundary, roadmap, review };
}

function loadCommitSnapshot(repositoryRoot, commit) {
  return {
    boundaryText: readCommitBlob(repositoryRoot, commit, 'planning/security-boundary.json'),
    roadmapText: readCommitBlob(repositoryRoot, commit, 'planning/roadmap.json'),
    adr: readCommitBlob(repositoryRoot, commit, 'docs/adr/0001-testnet-mvp-scope-and-authority.md'),
    appendix: readCommitBlob(repositoryRoot, commit, 'docs/adr/0001-security-boundary.generated.md'),
    readme: readCommitBlob(repositoryRoot, commit, 'README.md'),
    reviewText: readOptionalCommitBlob(repositoryRoot, commit, 'docs/reviews/GOV-001.json'),
    reviewReport: readOptionalCommitBlob(repositoryRoot, commit, 'docs/reviews/GOV-001.md'),
    validatorText: readCommitBlob(repositoryRoot, commit, 'tools/check-governance-v2.mjs'),
    governanceTest: readCommitBlob(repositoryRoot, commit, 'test/governance.test.mjs'),
    ciText: readCommitBlob(repositoryRoot, commit, '.github/workflows/ci.yml'),
  };
}

function validateReviewerEvidence(review, baseline) {
  const reviewedFiles = new Map(
    REVIEWABLE_PATHS.map((path) => [path, readCommitBlob(baseline.gitContext, review.reviewedCommit, path)]),
  );
  for (const reviewer of review.reviewers) {
    const referencedPaths = new Set();
    for (const evidence of reviewer.evidence) {
      const match = /^([^:]+):(\d+)(?:-(\d+))?$/.exec(evidence);
      requireCondition(match, `${reviewer.area} evidence must be path:start or path:start-end`);
      const [, path, startText, endText = startText] = match;
      requireCondition(reviewedFiles.has(path), `${reviewer.area} evidence references an unreviewed path`);
      const start = Number(startText);
      const end = Number(endText);
      const lineCount = reviewedFiles.get(path).split('\n').length;
      requireCondition(
        start >= 1 && end >= start && end <= lineCount,
        `${reviewer.area} evidence range is invalid`,
      );
      referencedPaths.add(path);
    }
    requireCondition(
      referencedPaths.size >= 2,
      `${reviewer.area} evidence must cover at least two reviewed files`,
    );
    for (const command of reviewer.commands) {
      const prefix = `git show ${review.reviewedCommit}:`;
      requireCondition(
        command.startsWith(prefix) && command.endsWith(' | nl -ba'),
        `${reviewer.area} command must be a pinned read-only git show command`,
      );
      const path = command.slice(prefix.length, -' | nl -ba'.length);
      requireCondition(reviewedFiles.has(path), `${reviewer.area} command references an unreviewed path`);
    }
  }
}

function validateAcceptanceTransition(baseline, acceptance, changedPaths) {
  requireExactTransitionPaths(changedPaths);
  requireCondition(baseline.boundary.decision.status === 'review', 'baseline must be in review');
  requireCondition(acceptance.boundary.decision.status === 'accepted', 'transition must end accepted');
  requireCondition(
    semanticBoundaryDigest(baseline.boundary) === semanticBoundaryDigest(acceptance.boundary),
    'acceptance changed reviewed boundary semantics',
  );
  requireCondition(
    semanticAdrDigest(baseline.adr) === semanticAdrDigest(acceptance.adr),
    'acceptance changed reviewed ADR semantics',
  );
  requireCondition(
    semanticReadmeDigest(baseline.readme) === semanticReadmeDigest(acceptance.readme),
    'acceptance changed README outside its governance status marker',
  );

  const baselineGovernance = baseline.roadmap.tasks.find((task) => task.id === 'GOV-001');
  const acceptanceGovernance = acceptance.roadmap.tasks.find((task) => task.id === 'GOV-001');
  const baselineThreat = baseline.roadmap.tasks.find((task) => task.id === 'THREAT-001');
  const acceptanceThreat = acceptance.roadmap.tasks.find((task) => task.id === 'THREAT-001');
  requireCondition(
    baselineGovernance?.status === 'in_progress' && baselineGovernance.evidence.length === 0,
    'reviewed roadmap must keep GOV-001 in progress without final evidence',
  );
  requireCondition(acceptanceGovernance?.status === 'done', 'acceptance must complete GOV-001');
  requireCondition(baselineThreat?.status === 'backlog', 'reviewed roadmap must keep THREAT-001 backlog');
  requireCondition(acceptanceThreat?.status === 'in_progress', 'acceptance must start THREAT-001');
  requireCondition(
    normalizeRoadmapTransition(baseline.roadmap) === normalizeRoadmapTransition(acceptance.roadmap),
    'acceptance changed roadmap content outside the closed task transition',
  );
}

export function validateGovernanceReviewProvenance(review, current, options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? root);
  const gitContext = createGitContext(repositoryRoot);
  validateGovernanceReview(review, current.boundary);
  requireCondition(
    runGit(gitContext, ['cat-file', '-e', `${review.reviewedCommit}^{commit}`], true) !== null,
    'governanceReview.reviewedCommit does not exist as a Git commit',
  );
  const head = runGit(gitContext, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  requireCondition(
    runGit(gitContext, ['merge-base', '--is-ancestor', review.reviewedCommit, head], true) !== null,
    'governanceReview.reviewedCommit is not an ancestor of HEAD',
  );

  const commitTimestamp = runGit(gitContext, ['show', '-s', '--format=%cI', review.reviewedCommit]).trim();
  const now = options.now ?? new Date();
  validateReviewDateWindow(review.reviewedAt, commitTimestamp, now);

  const baseline = parseSnapshot(loadCommitSnapshot(gitContext, review.reviewedCommit), 'review');
  baseline.gitContext = gitContext;
  validateGovernanceReview(review, current.boundary, {
    adrNormalizedSha256: semanticAdrDigest(baseline.adr),
    ciSha256: sha256Text(baseline.ciText),
    readmeNormalizedSha256: semanticReadmeDigest(baseline.readme),
    roadmapSha256: sha256Text(baseline.roadmapText),
    validatorSha256: sha256Text(baseline.validatorText),
    regressionTestsSha256: sha256Text(baseline.governanceTest),
  });
  validateReviewerEvidence(review, baseline);
  requireCondition(
    semanticAdrDigest(current.adr) === review.artifactDigests.adrNormalizedSha256,
    'current accepted ADR semantics differ from the reviewed artifact',
  );
  requireCondition(
    semanticReadmeGovernanceDigest(current.readme) === semanticReadmeGovernanceDigest(baseline.readme),
    'current README governance section differs from the reviewed artifact',
  );
  requireCondition(
    semanticRoadmapPolicyDigest(current.roadmap) === semanticRoadmapPolicyDigest(baseline.roadmap),
    'current roadmap policy differs from the reviewed artifact',
  );
  requireCondition(
    sha256Text(current.validatorText) === review.artifactDigests.validatorSha256,
    'current governance validator differs from the reviewed artifact',
  );
  requireCondition(
    sha256Text(current.governanceTest) === review.artifactDigests.regressionTestsSha256,
    'current governance regression tests differ from the reviewed artifact',
  );
  requireCondition(
    sha256Text(current.ciText) === review.artifactDigests.ciSha256,
    'current CI workflow differs from the reviewed artifact',
  );

  let acceptance;
  let acceptanceCommit = null;
  let changedPaths;
  if (head === review.reviewedCommit) {
    acceptance = parseSnapshot(current, 'accepted');
    const tracked = parseNulPaths(
      runGit(gitContext, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--name-only',
        '-z',
        review.reviewedCommit,
        '--',
      ]),
    );
    const untracked = parseNulPaths(runGit(gitContext, ['ls-files', '--others', '--exclude-standard', '-z']));
    changedPaths = [...tracked, ...untracked];
  } else {
    const firstParentHistory = runGit(gitContext, ['rev-list', '--first-parent', head]).trim().split('\n');
    requireCondition(
      firstParentHistory.includes(review.reviewedCommit),
      'governanceReview.reviewedCommit is not on the HEAD first-parent history',
    );
    const transitionCommits = runGit(gitContext, [
      'rev-list',
      '--first-parent',
      '--reverse',
      `${review.reviewedCommit}..${head}`,
    ])
      .trim()
      .split('\n')
      .filter(Boolean);
    requireCondition(transitionCommits.length > 0, 'accepted history has no transition commit');
    [acceptanceCommit] = transitionCommits;
    acceptance = parseSnapshot(loadCommitSnapshot(gitContext, acceptanceCommit), 'accepted');
    changedPaths = parseNulPaths(
      runGit(gitContext, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--name-only',
        '-z',
        review.reviewedCommit,
        acceptanceCommit,
        '--',
      ]),
    );
    requireCondition(
      canonicalJson(acceptance.review) === canonicalJson(review),
      'governance review record changed after the acceptance transition',
    );
  }

  validateAcceptanceTransition(baseline, acceptance, changedPaths);
  requireCondition(
    canonicalJson(acceptance.review) === canonicalJson(review),
    'acceptance transition review record differs from the current record',
  );
  return {
    [VERIFIED_REVIEW]: true,
    review,
    reviewedCommit: review.reviewedCommit,
    acceptanceCommit,
  };
}

export async function loadGovernanceArtifacts() {
  const [
    boundaryText,
    roadmapText,
    adr,
    appendix,
    readme,
    reviewText,
    reviewReport,
    validatorText,
    governanceTest,
    ciText,
  ] = await Promise.all([
    readFile(boundaryPath, 'utf8'),
    readFile(roadmapPath, 'utf8'),
    readFile(adrPath, 'utf8'),
    readFile(appendixPath, 'utf8'),
    readFile(readmePath, 'utf8'),
    readOptionalTextFile(reviewRecordPath, 'governance review record'),
    readOptionalTextFile(reviewReportPath, 'governance review report'),
    readFile(validatorPath, 'utf8'),
    readFile(governanceTestPath, 'utf8'),
    readFile(ciPath, 'utf8'),
  ]);
  const boundary = validateSecurityBoundary(JSON.parse(boundaryText));
  const review = reviewText === null ? null : JSON.parse(reviewText);
  const roadmap = JSON.parse(roadmapText);
  validateGovernanceDocumentStatus(boundary, adr, readme);
  requireCondition(
    adr.includes('[机器约束附录](0001-security-boundary.generated.md)'),
    'ADR must link the generated appendix',
  );
  requireCondition(
    adr.includes('本 ADR 不开启任何 Testnet 写平面'),
    'ADR must state that it enables no write plane',
  );
  requireCondition(
    appendix === renderSecurityBoundaryAppendix(boundary),
    'generated boundary appendix is stale',
  );
  if (boundary.decision.status === 'accepted') {
    const reviewVerification = validateGovernanceReviewProvenance(review, {
      boundaryText,
      roadmapText,
      boundary,
      roadmap,
      adr,
      appendix,
      readme,
      reviewText,
      reviewReport,
      validatorText,
      governanceTest,
      ciText,
    });
    validateRoadmapAlignment(boundary, roadmap, review, reviewVerification);
    requireCondition(
      reviewReport === renderGovernanceReview(review),
      'generated governance review report is missing or stale',
    );
  } else {
    validateRoadmapAlignment(boundary, roadmap);
    requireCondition(review === null, 'review state must not contain a final governance review record');
    requireCondition(reviewReport === null, 'review state must not contain a final governance review report');
  }
  return { boundary, roadmap, adr, appendix, readme, review, reviewReport, ciText };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const boundary = validateSecurityBoundary(JSON.parse(await readFile(boundaryPath, 'utf8')));
    if (process.argv.includes('--write')) {
      let renderedReview = null;
      if (boundary.decision.status === 'accepted') {
        const [reviewText, adr, readme] = await Promise.all([
          readFile(reviewRecordPath, 'utf8'),
          readFile(adrPath, 'utf8'),
          readFile(readmePath, 'utf8'),
        ]);
        validateGovernanceDocumentStatus(boundary, adr, readme);
        const review = validateGovernanceReview(JSON.parse(reviewText), boundary);
        renderedReview = renderGovernanceReview(review);
      }
      await writeFile(appendixPath, renderSecurityBoundaryAppendix(boundary), 'utf8');
      if (renderedReview !== null) await writeFile(reviewReportPath, renderedReview, 'utf8');
      await loadGovernanceArtifacts();
      console.log('Governance artifacts generated and validated.');
    } else {
      await loadGovernanceArtifacts();
      console.log(
        JSON.stringify({
          decision: boundary.decision.id,
          status: boundary.decision.status,
          chainId: boundary.environment.chainId,
          deploymentWritesEnabled: boundary.environment.writePlanes.deployment.enabled,
          applicationWritesEnabled: boundary.environment.writePlanes.application.enabled,
          roles: boundary.roles.length,
          trustBoundaries: boundary.trustBoundaries.length,
          semanticDigest: semanticBoundaryDigest(boundary),
        }),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Governance validation failed');
    process.exitCode = 1;
  }
}
