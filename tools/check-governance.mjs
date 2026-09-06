import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const boundaryPath = resolve(root, 'planning/security-boundary.json');
const adrPath = resolve(root, 'docs/adr/0001-testnet-mvp-scope-and-authority.md');

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

function requireMembers(values, required, field) {
  for (const value of required) {
    requireCondition(values.includes(value), `${field} must include ${value}`);
  }
}

function requireExactMembers(values, expected, field) {
  requireStringArray(values, field, expected.length);
  requireCondition(
    values.length === expected.length,
    `${field} must contain exactly ${expected.length} items`,
  );
  requireMembers(values, expected, field);
}

export function validateSecurityBoundary(boundary) {
  requireCondition(boundary && typeof boundary === 'object', 'root must be an object');
  requireCondition(boundary.schemaVersion === 1, 'schemaVersion must be 1');
  requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(boundary.updatedAt), 'updatedAt must be YYYY-MM-DD');
  requireCondition(boundary.decision?.id === 'ADR-0001', 'decision.id must be ADR-0001');
  requireCondition(boundary.decision?.status === 'accepted', 'ADR-0001 must be accepted');

  const environment = boundary.environment;
  requireExactMembers(
    environment?.allowed,
    ['local-simulation', 'robinhood-chain-testnet'],
    'environment.allowed',
  );
  requireCondition(environment.chainId === 46_630, 'only Robinhood Chain Testnet 46630 is allowed');
  requireCondition(environment.mainnetSupported === false, 'mainnet must remain unsupported');
  requireCondition(environment.realFundsSupported === false, 'real funds must remain unsupported');
  requireCondition(environment.testnetWrites?.enabled === false, 'testnet writes must remain disabled');
  requireCondition(environment.testnetWrites?.failClosed === true, 'testnet writes must fail closed');
  requireMembers(
    environment.testnetWrites.requiresCompletedTasks,
    ['THREAT-001', 'CONFIG-001', 'ASSET-001', 'SEC-002', 'KEY-001', 'DEPLOY-001'],
    'environment.testnetWrites.requiresCompletedTasks',
  );
  requireExactMembers(environment.testnetWrites.requiresPassedGates, ['G1', 'G2'], 'required gates');

  const custody = boundary.custody;
  requireCondition(custody?.model === 'protocol-contract-custody', 'custody model must be explicit');
  requireCondition(custody.applicationHoldsUserKeys === false, 'application must not hold user keys');
  requireCondition(custody.operatorCanWithdraw === false, 'operator must not withdraw');
  requireCondition(custody.executorCanWithdraw === false, 'executor must not withdraw');
  requireCondition(custody.ownerExitDuringPause === true, 'owner exit must remain available during pause');

  const contract = boundary.contract;
  requireCondition(contract?.upgradeability === 'immutable-v1', 'v1 contract must be immutable');
  requireCondition(contract.proxyAllowed === false, 'proxy must be forbidden');
  requireCondition(contract.delegatecallAllowed === false, 'delegatecall must be forbidden');
  requireCondition(contract.arbitraryCallAllowed === false, 'arbitrary call must be forbidden');
  requireCondition(
    contract.targetPolicy === 'immutable-explicit-allowlist',
    'target allowlist must be immutable',
  );
  requireCondition(
    contract.selectorPolicy === 'immutable-explicit-allowlist',
    'selector allowlist must be immutable',
  );
  requireCondition(contract.approvalPolicy === 'exact-amount-reset-to-zero', 'token approvals must be exact');

  const assetPolicy = boundary.assetPolicy;
  requireCondition(assetPolicy?.assetCountPerVault === 1, 'each vault must support exactly one asset');
  requireCondition(assetPolicy.selection === 'immutable-at-deployment', 'asset must be immutable');
  requireMembers(
    assetPolicy.requiredProperties,
    [
      'erc20-return-values-checked',
      'decimals-pinned-and-validated',
      'deposit-accounted-by-balance-delta',
      'runtime-bytecode-hash-pinned',
      'address-and-chain-id-pinned',
    ],
    'assetPolicy.requiredProperties',
  );
  requireMembers(
    assetPolicy.rejectedBehaviors,
    [
      'fee-on-transfer',
      'rebasing',
      'erc777-or-callback-hooks',
      'unknown-or-changing-decimals',
      'unverified-runtime-bytecode',
      'hidden-transfer-tax',
    ],
    'assetPolicy.rejectedBehaviors',
  );

  requireCondition(Array.isArray(boundary.roles), 'roles must be an array');
  const expectedRoles = [
    'owner',
    'strategy-runtime',
    'risk-signer',
    'executor',
    'pause-guardian',
    'deployer',
    'indexer',
  ];
  const roles = new Map();
  for (const role of boundary.roles) {
    requireString(role.id, 'role.id');
    requireCondition(!roles.has(role.id), `duplicate role ${role.id}`);
    requireString(role.authority, `${role.id}.authority`);
    requireStringArray(role.can, `${role.id}.can`);
    requireStringArray(role.cannot, `${role.id}.cannot`);
    requireCondition(
      role.can.every((capability) => !role.cannot.includes(capability)),
      `${role.id} grants and denies the same capability`,
    );
    roles.set(role.id, role);
  }
  requireExactMembers([...roles.keys()], expectedRoles, 'roles');
  requireMembers(
    roles.get('executor').cannot,
    ['withdraw_assets', 'transfer_assets', 'upgrade_contract'],
    'executor.cannot',
  );
  requireMembers(
    roles.get('pause-guardian').cannot,
    ['withdraw_assets', 'block_owner_exit'],
    'pause-guardian.cannot',
  );
  requireMembers(roles.get('deployer').cannot, ['withdraw_assets', 'upgrade_contract'], 'deployer.cannot');
  requireMembers(
    roles.get('strategy-runtime').cannot,
    ['submit_transaction', 'hold_user_key'],
    'strategy-runtime.cannot',
  );
  requireMembers(
    roles.get('risk-signer').cannot,
    ['submit_transaction', 'withdraw_assets'],
    'risk-signer.cannot',
  );

  requireExactMembers(boundary.capabilityOwners?.withdraw_assets, ['owner'], 'withdraw capability owners');
  requireExactMembers(
    boundary.capabilityOwners?.submit_bounded_execution,
    ['executor'],
    'execution capability owners',
  );
  requireExactMembers(
    boundary.capabilityOwners?.sign_bounded_execution_permit,
    ['risk-signer'],
    'permit capability owners',
  );
  requireExactMembers(
    boundary.capabilityOwners?.pause_risk_increasing_actions,
    ['pause-guardian'],
    'pause capability owners',
  );

  const safeExit = boundary.safeExit;
  requireCondition(safeExit?.availableDuringPause === true, 'safe exit must remain available during pause');
  requireMembers(
    safeExit.riskReducingActionsAllowed,
    ['stop_strategy', 'cancel_pending_intent', 'deallocate', 'withdraw_idle_asset', 'revoke_executor_permit'],
    'safeExit.riskReducingActionsAllowed',
  );
  requireCondition(
    safeExit.timeoutOrFallbackRequiredForStuckExecution === true,
    'stuck execution needs a timeout or fallback',
  );

  requireCondition(
    Array.isArray(boundary.signatures) && boundary.signatures.length >= 3,
    'signatures are incomplete',
  );
  const signatures = new Map(boundary.signatures.map((signature) => [signature.id, signature]));
  requireCondition(signatures.size === boundary.signatures.length, 'signature IDs must be unique');
  const ownerAuthorization = signatures.get('owner-authorization');
  requireCondition(ownerAuthorization?.scheme === 'EIP-712', 'owner authorization must use EIP-712');
  requireMembers(
    ownerAuthorization.requiredBindings,
    [
      'chainId',
      'verifyingContract',
      'vault',
      'owner',
      'executor',
      'asset',
      'target',
      'calldataHash',
      'value',
      'nonce',
      'deadline',
      'policyHash',
      'slippageBps',
    ],
    'owner-authorization.requiredBindings',
  );

  requireCondition(
    Array.isArray(boundary.secrets) && boundary.secrets.length >= 5,
    'secret inventory is incomplete',
  );
  const secrets = new Set();
  for (const secret of boundary.secrets) {
    requireString(secret.id, 'secret.id');
    requireCondition(!secrets.has(secret.id), `duplicate secret ${secret.id}`);
    secrets.add(secret.id);
    requireString(secret.holder, `${secret.id}.holder`);
    requireStringArray(secret.allowedStorage, `${secret.id}.allowedStorage`);
    requireStringArray(secret.forbiddenStorage, `${secret.id}.forbiddenStorage`);
    requireMembers(
      secret.forbiddenStorage,
      ['repository', 'browser-storage', 'logs', 'ci'],
      `${secret.id}.forbiddenStorage`,
    );
  }

  requireCondition(
    Array.isArray(boundary.trustBoundaries) && boundary.trustBoundaries.length >= 7,
    'trust boundary inventory is incomplete',
  );
  const trustBoundaryIds = new Set();
  for (const item of boundary.trustBoundaries) {
    requireCondition(/^TB-\d{2}$/.test(item.id), `${item.id} has an invalid trust boundary ID`);
    requireCondition(!trustBoundaryIds.has(item.id), `duplicate trust boundary ${item.id}`);
    trustBoundaryIds.add(item.id);
    requireString(item.from, `${item.id}.from`);
    requireString(item.to, `${item.id}.to`);
    requireStringArray(item.data, `${item.id}.data`);
    requireString(item.rule, `${item.id}.rule`);
  }

  requireMembers(
    boundary.prohibited,
    [
      'mainnet-or-unknown-network',
      'real-value-assets',
      'application-custody-of-user-keys',
      'arbitrary-call-or-delegatecall',
      'proxy-upgrade-path',
      'executor-withdrawal-or-transfer',
      'caller-supplied-trust-root',
      'in-memory-only-replay-protection',
      'treating-pending-transaction-as-success',
      'reusing-local-simulation-role-promotion-in-testnet',
    ],
    'prohibited',
  );
  return boundary;
}

export function validateAdrCoverage(boundary, adr) {
  requireString(adr, 'ADR contents');
  for (const role of boundary.roles) {
    requireCondition(adr.includes(role.id), `ADR must identify role ${role.id}`);
  }
  for (const item of boundary.trustBoundaries) {
    requireCondition(adr.includes(item.id) || adr.includes(item.rule), `ADR must cover ${item.id}`);
  }
  requireCondition(adr.includes('Chain ID `46630`'), 'ADR must state the exact testnet Chain ID');
  requireCondition(
    adr.includes('本 ADR 不开启 Testnet 写入'),
    'ADR must state that it does not enable writes',
  );
  return adr;
}

export async function loadGovernanceArtifacts() {
  const [boundaryText, adr] = await Promise.all([readFile(boundaryPath, 'utf8'), readFile(adrPath, 'utf8')]);
  const boundary = validateSecurityBoundary(JSON.parse(boundaryText));
  validateAdrCoverage(boundary, adr);
  return { boundary, adr };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { boundary } = await loadGovernanceArtifacts();
    console.log(
      JSON.stringify({
        decision: boundary.decision.id,
        status: boundary.decision.status,
        chainId: boundary.environment.chainId,
        testnetWritesEnabled: boundary.environment.testnetWrites.enabled,
        roles: boundary.roles.length,
        trustBoundaries: boundary.trustBoundaries.length,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Governance validation failed');
    process.exitCode = 1;
  }
}
