import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface Signature {
  readonly algorithm: 'Ed25519';
  readonly keyId: string;
  readonly value: string;
}

export interface Signed<T> {
  readonly payload: T;
  readonly signature: Signature;
}

export interface ExecutionPermissions {
  readonly readAccount: boolean;
  readonly readMarketData: boolean;
  readonly placeOrders: boolean;
  readonly withdraw: boolean;
  readonly transfer: boolean;
}

export interface RiskPolicy {
  readonly schemaVersion: 1;
  readonly allowedVenues: readonly string[];
  readonly allowedInstruments: readonly string[];
  readonly maxPositionNotionalUsdMicros: string;
  readonly maxOrderNotionalUsdMicros: string;
  readonly maxGrossNotionalUsdMicros: string;
  readonly maxLeverageBps: number;
  readonly maxDailyLossUsdMicros: string;
  readonly maxDecisionAgeMs: number;
  readonly maxAccountSnapshotAgeMs: number;
  readonly maxClockSkewMs: number;
  readonly executionPermitTtlMs: number;
}

export interface AuthorizationGrant {
  readonly grantId: string;
  readonly userId: string;
  readonly strategyFamilyId: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly permissions: ExecutionPermissions;
  readonly policy: RiskPolicy;
}

export interface PositionTarget {
  readonly instrument: string;
  readonly targetNotionalUsdMicros: string;
}

export interface StrategyDecision {
  readonly decisionId: string;
  readonly nonce: string;
  readonly grantId: string;
  readonly strategyFamilyId: string;
  readonly strategyVersionId: string;
  readonly codeMeasurement: string;
  readonly policyHash: string;
  readonly venue: string;
  readonly targets: readonly PositionTarget[];
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface TrustedStrategyRelease {
  readonly strategyFamilyId: string;
  readonly strategyVersionId: string;
  readonly codeMeasurement: string;
  readonly signerKeyId: string;
  readonly runtimePublicKeyPem: string;
}

export interface AccountSnapshot {
  readonly snapshotId: string;
  readonly userId: string;
  readonly venue: string;
  readonly capturedAt: string;
  readonly equityUsdMicros: string;
  readonly dailyPnlUsdMicros: string;
  readonly positionNotionalUsdMicros: Readonly<Record<string, string>>;
}

export interface ExecutionOrder {
  readonly instrument: string;
  readonly deltaNotionalUsdMicros: string;
}

export interface ExecutionPermit {
  readonly schemaVersion: 1;
  readonly permitId: string;
  readonly grantId: string;
  readonly userId: string;
  readonly venue: string;
  readonly orders: readonly ExecutionOrder[];
  readonly decisionCommitment: string;
  readonly policyHash: string;
  readonly accountSnapshotHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly capabilityProfile: 'trade-only-v1';
}

export interface ReplayStore {
  consume(scope: string, nonce: string, expiresAtEpochMs: number, nowEpochMs: number): Promise<boolean>;
}

export interface RiskSigner {
  readonly keyId: string;
  readonly privateKeyPem: string;
}

export interface IssueExecutionPermitInput {
  readonly grant: Signed<AuthorizationGrant>;
  readonly expectedUserSigningKeyId: string;
  readonly userPublicKeyPem: string;
  readonly decision: Signed<StrategyDecision>;
  readonly release: TrustedStrategyRelease;
  readonly account: AccountSnapshot;
  readonly replayStore: ReplayStore;
  readonly riskSigner: RiskSigner;
  readonly now?: Date;
}

export class SecurityModelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SecurityModelError';
    this.code = code;
  }
}

export class MemoryReplayStore implements ReplayStore {
  readonly #seen = new Map<string, number>();

  async consume(
    scope: string,
    nonce: string,
    expiresAtEpochMs: number,
    nowEpochMs: number,
  ): Promise<boolean> {
    for (const [key, expiry] of this.#seen) {
      if (expiry < nowEpochMs) this.#seen.delete(key);
    }

    const key = `${scope}:${nonce}`;
    if (this.#seen.has(key)) return false;
    this.#seen.set(key, expiresAtEpochMs);
    return true;
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new SecurityModelError('INVALID_CANONICAL_NUMBER', 'Signed numeric fields must be safe integers');
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new SecurityModelError('INVALID_CANONICAL_VALUE', 'Payload contains an unsupported value');
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

export function signPayload<T>(payload: T, keyId: string, privateKey: string | KeyObject): Signed<T> {
  assertIdentifier('keyId', keyId);
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  const signature = cryptoSign(null, Buffer.from(canonicalJson(payload), 'utf8'), key);
  return {
    payload,
    signature: { algorithm: 'Ed25519', keyId, value: signature.toString('base64url') },
  };
}

export function verifySignedPayload<T>(
  signed: Signed<T>,
  expectedKeyId: string,
  publicKey: string | KeyObject,
): boolean {
  if (signed.signature.algorithm !== 'Ed25519' || signed.signature.keyId !== expectedKeyId) return false;
  try {
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
    return cryptoVerify(
      null,
      Buffer.from(canonicalJson(signed.payload), 'utf8'),
      key,
      Buffer.from(signed.signature.value, 'base64url'),
    );
  } catch {
    return false;
  }
}

export async function issueExecutionPermit(
  input: IssueExecutionPermitInput,
): Promise<Signed<ExecutionPermit>> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) fail('INVALID_TIME', 'The risk-engine clock is invalid');

  if (!verifySignedPayload(input.grant, input.expectedUserSigningKeyId, input.userPublicKeyPem)) {
    fail('INVALID_USER_SIGNATURE', 'The authorization grant signature is invalid');
  }
  validateGrant(input.grant.payload, nowMs);

  const { decision } = input;
  if (!verifySignedPayload(decision, input.release.signerKeyId, input.release.runtimePublicKeyPem)) {
    fail('INVALID_RUNTIME_SIGNATURE', 'The strategy runtime signature is invalid');
  }
  validateReleaseBinding(decision.payload, input.release);
  validateDecisionBinding(decision.payload, input.grant.payload, nowMs);
  validateAccount(input.account, input.grant.payload, nowMs);

  const expectedPolicyHash = hashPayload(input.grant.payload.policy);
  if (decision.payload.policyHash !== expectedPolicyHash) {
    fail('POLICY_HASH_MISMATCH', 'The strategy decision is not bound to the active risk policy');
  }

  const orders = evaluateRisk(decision.payload, input.account, input.grant.payload.policy);

  const decisionExpiryMs = parseTimestamp('decision.expiresAt', decision.payload.expiresAt);
  const consumed = await input.replayStore.consume(
    `${input.grant.payload.grantId}:${input.release.strategyVersionId}`,
    decision.payload.nonce,
    decisionExpiryMs,
    nowMs,
  );
  if (!consumed) fail('REPLAYED_DECISION', 'The strategy decision nonce has already been consumed');

  const policy = input.grant.payload.policy;
  const expiresAtMs = Math.min(decisionExpiryMs, nowMs + policy.executionPermitTtlMs);
  const issuedAt = now.toISOString();
  const decisionCommitment = hashPayload(decision);
  const accountSnapshotHash = hashPayload(input.account);
  const permitId = hashPayload({
    accountSnapshotHash,
    decisionCommitment,
    grantId: input.grant.payload.grantId,
    issuedAt,
  });

  const permit: ExecutionPermit = {
    schemaVersion: 1,
    permitId,
    grantId: input.grant.payload.grantId,
    userId: input.grant.payload.userId,
    venue: decision.payload.venue,
    orders,
    decisionCommitment,
    policyHash: expectedPolicyHash,
    accountSnapshotHash,
    issuedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    capabilityProfile: 'trade-only-v1',
  };

  return signPayload(permit, input.riskSigner.keyId, input.riskSigner.privateKeyPem);
}

function validateGrant(grant: AuthorizationGrant, nowMs: number): void {
  assertIdentifier('grant.grantId', grant.grantId);
  assertIdentifier('grant.userId', grant.userId);
  assertIdentifier('grant.strategyFamilyId', grant.strategyFamilyId);
  const validFromMs = parseTimestamp('grant.validFrom', grant.validFrom);
  const validUntilMs = parseTimestamp('grant.validUntil', grant.validUntil);
  if (validUntilMs <= validFromMs) fail('INVALID_GRANT_WINDOW', 'The grant validity window is invalid');
  if (nowMs < validFromMs || nowMs > validUntilMs)
    fail('GRANT_INACTIVE', 'The authorization grant is not active');

  const permissions = grant.permissions;
  if (
    permissions.readAccount !== true ||
    permissions.readMarketData !== true ||
    permissions.placeOrders !== true ||
    permissions.withdraw !== false ||
    permissions.transfer !== false
  ) {
    fail('UNSAFE_PERMISSIONS', 'Only the non-custodial trade-only permission profile is accepted');
  }
  validatePolicy(grant.policy);
}

function validatePolicy(policy: RiskPolicy): void {
  if (policy.schemaVersion !== 1) fail('UNSUPPORTED_POLICY', 'Unsupported risk policy version');
  assertUniqueIdentifiers('policy.allowedVenues', policy.allowedVenues, 16);
  assertUniqueIdentifiers('policy.allowedInstruments', policy.allowedInstruments, 128);
  parsePositiveAmount('policy.maxPositionNotionalUsdMicros', policy.maxPositionNotionalUsdMicros);
  parsePositiveAmount('policy.maxOrderNotionalUsdMicros', policy.maxOrderNotionalUsdMicros);
  parsePositiveAmount('policy.maxGrossNotionalUsdMicros', policy.maxGrossNotionalUsdMicros);
  parsePositiveAmount('policy.maxDailyLossUsdMicros', policy.maxDailyLossUsdMicros);
  assertBoundedInteger('policy.maxLeverageBps', policy.maxLeverageBps, 1, 100_000);
  assertBoundedInteger('policy.maxDecisionAgeMs', policy.maxDecisionAgeMs, 100, 3_600_000);
  assertBoundedInteger('policy.maxAccountSnapshotAgeMs', policy.maxAccountSnapshotAgeMs, 100, 60_000);
  assertBoundedInteger('policy.maxClockSkewMs', policy.maxClockSkewMs, 0, 60_000);
  assertBoundedInteger('policy.executionPermitTtlMs', policy.executionPermitTtlMs, 100, 60_000);
  if (policy.executionPermitTtlMs > policy.maxDecisionAgeMs) {
    fail('INVALID_POLICY', 'Execution permit TTL cannot exceed decision age');
  }
}

function validateReleaseBinding(decision: StrategyDecision, release: TrustedStrategyRelease): void {
  assertIdentifier('release.strategyFamilyId', release.strategyFamilyId);
  assertIdentifier('release.strategyVersionId', release.strategyVersionId);
  assertIdentifier('release.signerKeyId', release.signerKeyId);
  assertMeasurement('release.codeMeasurement', release.codeMeasurement);
  if (
    decision.strategyFamilyId !== release.strategyFamilyId ||
    decision.strategyVersionId !== release.strategyVersionId ||
    decision.codeMeasurement !== release.codeMeasurement
  ) {
    fail('UNTRUSTED_RELEASE', 'The decision does not match a trusted strategy release');
  }
}

function validateDecisionBinding(decision: StrategyDecision, grant: AuthorizationGrant, nowMs: number): void {
  assertIdentifier('decision.decisionId', decision.decisionId);
  assertIdentifier('decision.nonce', decision.nonce);
  assertIdentifier('decision.grantId', decision.grantId);
  assertIdentifier('decision.strategyFamilyId', decision.strategyFamilyId);
  assertIdentifier('decision.strategyVersionId', decision.strategyVersionId);
  assertMeasurement('decision.codeMeasurement', decision.codeMeasurement);
  assertIdentifier('decision.venue', decision.venue);
  assertHash('decision.policyHash', decision.policyHash);
  if (decision.grantId !== grant.grantId || decision.strategyFamilyId !== grant.strategyFamilyId) {
    fail('DECISION_GRANT_MISMATCH', 'The strategy decision is not bound to this authorization grant');
  }
  if (!grant.policy.allowedVenues.includes(decision.venue)) {
    fail('VENUE_NOT_ALLOWED', 'The requested venue is outside the authorization policy');
  }

  const issuedAtMs = parseTimestamp('decision.issuedAt', decision.issuedAt);
  const expiresAtMs = parseTimestamp('decision.expiresAt', decision.expiresAt);
  if (issuedAtMs > nowMs + grant.policy.maxClockSkewMs) {
    fail('DECISION_FROM_FUTURE', 'The strategy decision timestamp is ahead of the accepted clock skew');
  }
  if (nowMs - issuedAtMs > grant.policy.maxDecisionAgeMs || expiresAtMs < nowMs) {
    fail('STALE_DECISION', 'The strategy decision is stale or expired');
  }
  if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > grant.policy.maxDecisionAgeMs) {
    fail('INVALID_DECISION_WINDOW', 'The strategy decision validity window is invalid');
  }
  if (decision.targets.length > 128) fail('TOO_MANY_TARGETS', 'The strategy decision has too many targets');
}

function validateAccount(account: AccountSnapshot, grant: AuthorizationGrant, nowMs: number): void {
  assertIdentifier('account.snapshotId', account.snapshotId);
  assertIdentifier('account.userId', account.userId);
  assertIdentifier('account.venue', account.venue);
  if (account.userId !== grant.userId)
    fail('ACCOUNT_USER_MISMATCH', 'The account snapshot belongs to another user');
  if (!grant.policy.allowedVenues.includes(account.venue)) {
    fail('ACCOUNT_VENUE_NOT_ALLOWED', 'The account venue is outside the authorization policy');
  }
  const capturedAtMs = parseTimestamp('account.capturedAt', account.capturedAt);
  if (capturedAtMs > nowMs + grant.policy.maxClockSkewMs) {
    fail('ACCOUNT_SNAPSHOT_FROM_FUTURE', 'The account snapshot timestamp is invalid');
  }
  if (nowMs - capturedAtMs > grant.policy.maxAccountSnapshotAgeMs) {
    fail('STALE_ACCOUNT_SNAPSHOT', 'The account snapshot is stale');
  }
  parsePositiveAmount('account.equityUsdMicros', account.equityUsdMicros);
  parseAmount('account.dailyPnlUsdMicros', account.dailyPnlUsdMicros);
  const positions = Object.entries(account.positionNotionalUsdMicros);
  if (positions.length > 1_000) fail('TOO_MANY_POSITIONS', 'The account snapshot has too many positions');
  for (const [instrument, amount] of positions) {
    assertIdentifier('account.position.instrument', instrument);
    parseAmount(`account.position.${instrument}`, amount);
  }
}

function evaluateRisk(
  decision: StrategyDecision,
  account: AccountSnapshot,
  policy: RiskPolicy,
): readonly ExecutionOrder[] {
  if (decision.venue !== account.venue) fail('VENUE_MISMATCH', 'The decision and account venue do not match');

  const currentPositions = new Map<string, bigint>();
  for (const [instrument, amount] of Object.entries(account.positionNotionalUsdMicros)) {
    currentPositions.set(instrument, parseAmount(`account.position.${instrument}`, amount));
  }
  const resultingPositions = new Map(currentPositions);
  const seenTargets = new Set<string>();
  const orders: ExecutionOrder[] = [];
  const maxPosition = parsePositiveAmount(
    'policy.maxPositionNotionalUsdMicros',
    policy.maxPositionNotionalUsdMicros,
  );
  const maxOrder = parsePositiveAmount('policy.maxOrderNotionalUsdMicros', policy.maxOrderNotionalUsdMicros);

  for (const target of decision.targets) {
    assertIdentifier('decision.target.instrument', target.instrument);
    if (seenTargets.has(target.instrument))
      fail('DUPLICATE_TARGET', 'The strategy decision repeats an instrument');
    seenTargets.add(target.instrument);
    if (!policy.allowedInstruments.includes(target.instrument)) {
      fail('INSTRUMENT_NOT_ALLOWED', 'A target instrument is outside the authorization policy');
    }
    const targetAmount = parseAmount(
      'decision.target.targetNotionalUsdMicros',
      target.targetNotionalUsdMicros,
    );
    if (abs(targetAmount) > maxPosition) {
      fail('POSITION_LIMIT_EXCEEDED', 'A target position exceeds the per-instrument limit');
    }
    const currentAmount = currentPositions.get(target.instrument) ?? 0n;
    const delta = targetAmount - currentAmount;
    if (abs(delta) > maxOrder) fail('ORDER_LIMIT_EXCEEDED', 'A requested order exceeds the order limit');
    resultingPositions.set(target.instrument, targetAmount);
    if (delta !== 0n)
      orders.push({ instrument: target.instrument, deltaNotionalUsdMicros: delta.toString() });
  }

  const currentGross = grossNotional(currentPositions.values());
  const resultingGross = grossNotional(resultingPositions.values());
  const maxGross = parsePositiveAmount('policy.maxGrossNotionalUsdMicros', policy.maxGrossNotionalUsdMicros);
  if (resultingGross > maxGross)
    fail('GROSS_LIMIT_EXCEEDED', 'The resulting portfolio exceeds the gross limit');

  const equity = parsePositiveAmount('account.equityUsdMicros', account.equityUsdMicros);
  if (resultingGross * 10_000n > equity * BigInt(policy.maxLeverageBps)) {
    fail('LEVERAGE_LIMIT_EXCEEDED', 'The resulting portfolio exceeds the leverage limit');
  }

  const dailyPnl = parseAmount('account.dailyPnlUsdMicros', account.dailyPnlUsdMicros);
  const maxDailyLoss = parsePositiveAmount('policy.maxDailyLossUsdMicros', policy.maxDailyLossUsdMicros);
  if (dailyPnl <= -maxDailyLoss) {
    if (resultingGross >= currentGross || !isReductionOnly(decision.targets, currentPositions)) {
      fail('DAILY_LOSS_KILL_SWITCH', 'The daily loss limit permits exposure reduction only');
    }
  }

  return orders;
}

function isReductionOnly(targets: readonly PositionTarget[], current: ReadonlyMap<string, bigint>): boolean {
  return targets.every((target) => {
    const before = current.get(target.instrument) ?? 0n;
    const after = parseAmount('decision.target.targetNotionalUsdMicros', target.targetNotionalUsdMicros);
    if (abs(after) > abs(before)) return false;
    if (after === 0n) return true;
    return before !== 0n && after > 0n === before > 0n;
  });
}

function grossNotional(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += abs(value);
  return total;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function parseAmount(name: string, value: string): bigint {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value)) {
    fail('INVALID_AMOUNT', `${name} must be a canonical integer string`);
  }
  return BigInt(value);
}

function parsePositiveAmount(name: string, value: string): bigint {
  const amount = parseAmount(name, value);
  if (amount <= 0n) fail('INVALID_AMOUNT', `${name} must be positive`);
  return amount;
}

function parseTimestamp(name: string, value: string): number {
  if (typeof value !== 'string') fail('INVALID_TIMESTAMP', `${name} must be an ISO timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail('INVALID_TIMESTAMP', `${name} must be a canonical ISO timestamp`);
  }
  return parsed;
}

function assertIdentifier(name: string, value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(value)) {
    fail('INVALID_IDENTIFIER', `${name} is invalid`);
  }
}

function assertUniqueIdentifiers(name: string, values: readonly string[], limit: number): void {
  if (!Array.isArray(values) || values.length === 0 || values.length > limit) {
    fail('INVALID_ALLOWLIST', `${name} must contain between 1 and ${limit} entries`);
  }
  const unique = new Set<string>();
  for (const value of values) {
    assertIdentifier(name, value);
    if (unique.has(value)) fail('INVALID_ALLOWLIST', `${name} contains a duplicate entry`);
    unique.add(value);
  }
}

function assertMeasurement(name: string, value: string): void {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail('INVALID_MEASUREMENT', `${name} must be a sha256 measurement`);
  }
}

function assertHash(name: string, value: string): void {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    fail('INVALID_HASH', `${name} must be a lowercase sha256 hash`);
  }
}

function assertBoundedInteger(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('INVALID_INTEGER', `${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code: string, message: string): never {
  throw new SecurityModelError(code, message);
}
