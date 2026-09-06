import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const boundaryPath = resolve(root, 'planning/security-boundary.json');
const roadmapPath = resolve(root, 'planning/roadmap.json');
const adrPath = resolve(root, 'docs/adr/0001-testnet-mvp-scope-and-authority.md');
const appendixPath = resolve(root, 'docs/adr/0001-security-boundary.generated.md');

// This digest excludes only review state and date. Every other byte of semantic JSON is a closed,
// review-required baseline; changing it requires updating this constant and the mutation tests.
const CLOSED_SECURITY_BASELINE_SHA256 = 'b4d6640068666d94b26945977a8426012f0157391269313d96c55849e2bed9fa';

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

export function semanticBoundaryDigest(boundary) {
  const normalized = structuredClone(boundary);
  normalized.updatedAt = '__DATE__';
  if (normalized.decision) normalized.decision.status = '__REVIEW_STATE__';
  return createHash('sha256').update(canonicalJson(normalized), 'utf8').digest('hex');
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
    ['executor', 'untrusted-relay-low-balance-account', ['relay_dual_signed_execution']],
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
    ['executor-private-key', 'untrusted-low-balance-relay', ['managed-key-provider']],
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
      'executor',
      ['risk-execution-permit', 'owner-execution-intent'],
      ['dual-signature', 'full-call-binding', 'independent-nonce', 'short-deadline'],
    ],
    [
      'TB-05',
      'executor',
      'vault-contract',
      ['signed-transaction', 'dual-signed-execution'],
      ['contract-revalidation', 'atomic-nonce-consumption', 'typed-call', 'fixed-target-selector'],
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
      ['content-addressed-manifest', 'build-provenance', 'clean-rebuild', 'cross-component-hash-check'],
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
      'nonceDomains',
      'signatures',
      'secrets',
      'trustBoundaries',
      'prohibited',
    ],
    'root',
  );
  requireCondition(boundary.schemaVersion === 2, 'schemaVersion must be 2');
  requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(boundary.updatedAt), 'updatedAt must be YYYY-MM-DD');
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
    ],
    'assetPolicy.rejectedBehaviors',
  );

  validateClosedRoles(boundary);
  requireExactKeys(
    boundary.roleLifecycle,
    [
      'zeroAddressAllowed',
      'securityRoleAddressesPairwiseDistinct',
      'inPlaceRotation',
      'replacement',
      'deployerRetainsPostDeploymentPrivilege',
    ],
    'roleLifecycle',
  );
  requireCondition(boundary.roleLifecycle.zeroAddressAllowed === false, 'zero role addresses are forbidden');
  requireExactArray(
    boundary.roleLifecycle.securityRoleAddressesPairwiseDistinct,
    ['risk-signer', 'snapshot-signer', 'executor', 'pause-guardian', 'deployer'],
    'roleLifecycle.securityRoleAddressesPairwiseDistinct',
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
      'asyncExternalPositionsAllowed',
      'unpauseOrAdminMigrationAllowed',
    ],
    'safeExit',
  );
  requireCondition(boundary.safeExit.availableDuringPause === true, 'safe exit must remain available');
  requireExactArray(
    boundary.safeExit.riskIncreasingActionsBlocked,
    ['deposit', 'new_execution_intent', 'new_external_call'],
    'safeExit.riskIncreasingActionsBlocked',
  );
  requireExactArray(
    boundary.safeExit.ownerActionsAlwaysAllowed,
    ['revoke_pending_intent', 'withdraw_test_asset'],
    'safeExit.ownerActionsAlwaysAllowed',
  );
  requireCondition(
    boundary.safeExit.asyncExternalPositionsAllowed === false,
    'async external positions are forbidden',
  );
  requireCondition(
    boundary.safeExit.unpauseOrAdminMigrationAllowed === false,
    'unpause/admin migration is forbidden',
  );

  requireCondition(
    Array.isArray(boundary.nonceDomains) && boundary.nonceDomains.length === 3,
    'nonce domains must be closed',
  );
  const expectedNonces = [
    ['owner-intent', 'vault-contract', 'on-chain-atomic'],
    ['risk-permit', 'vault-contract', 'on-chain-atomic'],
    ['strategy-decision', 'risk-service', 'durable-transactional'],
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
  requireExactArray(
    boundary.prohibited,
    [
      'mainnet-or-unknown-network',
      'real-value-assets',
      'unattended-or-autonomous-trading',
      'application-custody-of-user-keys',
      'automatic-hidden-or-batch-wallet-signing',
      'arbitrary-target-calldata-or-delegatecall',
      'proxy-upgrade-path',
      'non-owner-withdrawal-or-arbitrary-recipient-transfer',
      'unlimited-token-approval',
      'caller-supplied-trust-root',
      'in-memory-only-replay-protection',
      'pending-transaction-presented-as-success',
      'local-simulation-role-promotion-reaching-testnet',
      'async-external-custody-or-pending-position',
      'admin-mint-confiscate-blacklist-or-burn-from-vault',
      'admin-bulk-migration-or-silent-address-replacement',
    ],
    'prohibited',
  );

  requireCondition(
    semanticBoundaryDigest(boundary) === CLOSED_SECURITY_BASELINE_SHA256,
    'closed security baseline digest changed; independent review is required',
  );
  return boundary;
}

export function validateRoadmapAlignment(boundary, roadmap) {
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
    requireCondition(governance.status === 'in_progress', 'review decision requires GOV-001 in progress');
  } else {
    requireCondition(governance.status === 'done', 'accepted decision requires GOV-001 done');
    for (const evidence of [
      'docs/adr/0001-testnet-mvp-scope-and-authority.md',
      'docs/adr/0001-security-boundary.generated.md',
      'docs/reviews/GOV-001.md',
      'planning/security-boundary.json',
      'tools/check-governance-v2.mjs',
      'test/governance.test.mjs',
    ]) {
      requireCondition(governance.evidence.includes(evidence), `GOV-001 evidence missing ${evidence}`);
    }
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
  return `# ADR-0001 机器约束附录\n\n> 自动生成文件。唯一事实源为 \`planning/security-boundary.json\`；禁止手工修改。\n\n- Schema：${boundary.schemaVersion}\n- 决策状态：\`${boundary.decision.status}\`\n- Chain ID：\`${boundary.environment.chainId}\`\n- 执行模式：\`${boundary.operatingModel.execution}\`\n- 无人值守执行：${boundary.operatingModel.unattendedExecution ? '允许' : '禁止'}\n- 语义摘要：\`${semanticBoundaryDigest(boundary)}\`\n\n## 写平面\n\n${planes}\n\n## 角色与唯一能力\n\n${roles}\n\n## 签名与域绑定\n\n${signatures}\n\n## 秘密清单\n\n${secrets}\n\n## 信任边界\n\n${trust}\n\n## 当前资产策略\n\n- Active allowlist：空；\`ASSET-001\` 完成前没有任何可写入 Testnet 的资产。\n- 候选：${boundary.assetPolicy.eligibleAfterAssetReview.map((item) => `\`${item}\``).join('、')}\n- Deposit：\`${boundary.assetPolicy.depositAccounting}\`\n- 拒绝：${boundary.assetPolicy.rejectedBehaviors.map((item) => `\`${item}\``).join('、')}\n\n## 暂停、退出与迁移\n\n- Pause：\`${boundary.contract.pauseMode}\`；不允许 unpause。\n- Pause 后 owner 始终可执行：${boundary.safeExit.ownerActionsAlwaysAllowed.map((item) => `\`${item}\``).join('、')}。\n- 外部异步托管：禁止。允许执行必须在同一交易中原子结束并把资产留在 Vault。\n- 迁移：\`${boundary.contract.migration}\`。\n\n## 禁止项\n\n${boundary.prohibited.map((item) => `- \`${item}\``).join('\n')}\n`;
}

export async function loadGovernanceArtifacts() {
  const [boundaryText, roadmapText, adr, appendix] = await Promise.all([
    readFile(boundaryPath, 'utf8'),
    readFile(roadmapPath, 'utf8'),
    readFile(adrPath, 'utf8'),
    readFile(appendixPath, 'utf8').catch(() => ''),
  ]);
  const boundary = validateSecurityBoundary(JSON.parse(boundaryText));
  const roadmap = validateRoadmapAlignment(boundary, JSON.parse(roadmapText));
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
  return { boundary, roadmap, adr, appendix };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const boundary = validateSecurityBoundary(JSON.parse(await readFile(boundaryPath, 'utf8')));
    if (process.argv.includes('--write')) {
      await writeFile(appendixPath, renderSecurityBoundaryAppendix(boundary), 'utf8');
      console.log('Governance appendix generated.');
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
