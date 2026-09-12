import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  MemoryReplayStore,
  SecurityModelError,
  hashPayload,
  issueExecutionPermit,
  signPayload,
  type AccountSnapshot,
  type AuthorizationGrant,
  type RiskPolicy,
  type StrategyDecision,
  type TrustedStrategyRelease,
} from '../src/security-model/index.ts';

const NOW = new Date('2026-09-04T08:00:00.000Z');
const MEASUREMENT = `sha256:${'ab'.repeat(32)}`;

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const userKeys = keyPair();
const runtimeKeys = keyPair();
const riskKeys = keyPair();

function policy(overrides: Partial<RiskPolicy> = {}): RiskPolicy {
  return {
    schemaVersion: 1,
    allowedVenues: ['binance-subaccount-1'],
    allowedInstruments: ['BTC-USDT', 'ETH-USDT'],
    maxPositionNotionalUsdMicros: '5000000000',
    maxOrderNotionalUsdMicros: '2000000000',
    maxGrossNotionalUsdMicros: '8000000000',
    maxLeverageBps: 20_000,
    maxDailyLossUsdMicros: '500000000',
    maxDecisionAgeMs: 30_000,
    maxAccountSnapshotAgeMs: 5_000,
    maxClockSkewMs: 1_000,
    executionPermitTtlMs: 2_000,
    ...overrides,
  };
}

function grant(riskPolicy = policy()) {
  const payload: AuthorizationGrant = {
    grantId: 'grant-7f188d',
    userId: 'user-42',
    strategyFamilyId: 'strategy-btc-momentum',
    validFrom: '2026-09-04T00:00:00.000Z',
    validUntil: '2026-10-04T00:00:00.000Z',
    permissions: {
      readAccount: true,
      readMarketData: true,
      placeOrders: true,
      withdraw: false,
      transfer: false,
    },
    policy: riskPolicy,
  };
  return signPayload(payload, 'user-key-1', userKeys.privateKeyPem);
}

function release(): TrustedStrategyRelease {
  return {
    strategyFamilyId: 'strategy-btc-momentum',
    strategyVersionId: 'v1.0.0',
    codeMeasurement: MEASUREMENT,
    signerKeyId: 'runtime-key-1',
    runtimePublicKeyPem: runtimeKeys.publicKeyPem,
  };
}

function decision(authorization = grant(), overrides: Partial<StrategyDecision> = {}) {
  const payload: StrategyDecision = {
    decisionId: 'decision-001',
    nonce: 'nonce-87f5d8d5',
    grantId: authorization.payload.grantId,
    strategyFamilyId: authorization.payload.strategyFamilyId,
    strategyVersionId: 'v1.0.0',
    codeMeasurement: MEASUREMENT,
    policyHash: hashPayload(authorization.payload.policy),
    venue: 'binance-subaccount-1',
    targets: [{ instrument: 'BTC-USDT', targetNotionalUsdMicros: '1500000000' }],
    issuedAt: '2026-09-04T07:59:59.000Z',
    expiresAt: '2026-09-04T08:00:10.000Z',
    ...overrides,
  };
  return signPayload(payload, 'runtime-key-1', runtimeKeys.privateKeyPem);
}

function account(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    snapshotId: 'snapshot-001',
    userId: 'user-42',
    venue: 'binance-subaccount-1',
    capturedAt: '2026-09-04T07:59:59.500Z',
    equityUsdMicros: '5000000000',
    dailyPnlUsdMicros: '10000000',
    positionNotionalUsdMicros: { 'BTC-USDT': '500000000' },
    ...overrides,
  };
}

function request(authorization = grant(), strategyDecision = decision(authorization), snapshot = account()) {
  return {
    grant: authorization,
    expectedUserSigningKeyId: 'user-key-1',
    userPublicKeyPem: userKeys.publicKeyPem,
    decision: strategyDecision,
    release: release(),
    account: snapshot,
    replayStore: new MemoryReplayStore(),
    riskSigner: { keyId: 'risk-key-1', privateKeyPem: riskKeys.privateKeyPem },
    now: NOW,
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SecurityModelError);
    assert.equal(error.code, code);
    return true;
  });
}

test('issues a short-lived, trade-only permit containing only the required order delta', async () => {
  const authorization = grant();
  const signedPermit = await issueExecutionPermit(request(authorization, decision(authorization)));

  assert.equal(signedPermit.signature.keyId, 'risk-key-1');
  assert.equal(signedPermit.payload.capabilityProfile, 'trade-only-v1');
  assert.deepEqual(signedPermit.payload.orders, [
    { instrument: 'BTC-USDT', deltaNotionalUsdMicros: '1000000000' },
  ]);
  assert.equal(signedPermit.payload.expiresAt, '2026-09-04T08:00:02.000Z');
  assert.equal(JSON.stringify(signedPermit).includes('strategyVersionId'), false);
  assert.equal(JSON.stringify(signedPermit).includes('codeMeasurement'), false);
});

test('rejects a decision bound to a different user risk policy', async () => {
  const authorization = grant();
  const forged = decision(authorization, { policyHash: '00'.repeat(32) });
  await expectCode(issueExecutionPermit(request(authorization, forged)), 'POLICY_HASH_MISMATCH');
});

test('atomically rejects replay of a previously consumed strategy nonce', async () => {
  const authorization = grant();
  const strategyDecision = decision(authorization);
  const replayStore = new MemoryReplayStore();
  const first = request(authorization, strategyDecision);
  const shared = { ...first, replayStore };

  await issueExecutionPermit(shared);
  await expectCode(issueExecutionPermit(shared), 'REPLAYED_DECISION');
});

test('rejects a target that exceeds the user-signed per-position limit', async () => {
  const authorization = grant();
  const oversized = decision(authorization, {
    targets: [{ instrument: 'BTC-USDT', targetNotionalUsdMicros: '6000000000' }],
  });
  await expectCode(issueExecutionPermit(request(authorization, oversized)), 'POSITION_LIMIT_EXCEEDED');
});

test('daily-loss kill switch permits closing risk but blocks increasing it', async () => {
  const authorization = grant();
  const losingAccount = account({ dailyPnlUsdMicros: '-500000000' });
  const close = decision(authorization, {
    nonce: 'nonce-close-risk',
    targets: [{ instrument: 'BTC-USDT', targetNotionalUsdMicros: '0' }],
  });
  const closePermit = await issueExecutionPermit(request(authorization, close, losingAccount));
  assert.deepEqual(closePermit.payload.orders, [
    { instrument: 'BTC-USDT', deltaNotionalUsdMicros: '-500000000' },
  ]);

  const increase = decision(authorization, {
    nonce: 'nonce-increase-risk',
    targets: [{ instrument: 'BTC-USDT', targetNotionalUsdMicros: '1000000000' }],
  });
  await expectCode(
    issueExecutionPermit(request(authorization, increase, losingAccount)),
    'DAILY_LOSS_KILL_SWITCH',
  );
});

test('rejects a signed decision after its payload is modified', async () => {
  const authorization = grant();
  const original = decision(authorization);
  const tampered = {
    ...original,
    payload: { ...original.payload, venue: 'attacker-venue' },
  };
  await expectCode(issueExecutionPermit(request(authorization, tampered)), 'INVALID_RUNTIME_SIGNATURE');
});

test('permit validity never exceeds its signed authorization window', async () => {
  const validUntil = new Date(NOW.getTime() + 1_000).toISOString();
  const authorization = signPayload({ ...grant().payload, validUntil }, 'user-key-1', userKeys.privateKeyPem);
  const permit = await issueExecutionPermit(request(authorization, decision(authorization)));
  assert.equal(permit.payload.expiresAt, validUntil);

  const expired = signPayload(
    { ...authorization.payload, validUntil: NOW.toISOString() },
    'user-key-1',
    userKeys.privateKeyPem,
  );
  await expectCode(issueExecutionPermit(request(expired, decision(expired))), 'GRANT_INACTIVE');
});
