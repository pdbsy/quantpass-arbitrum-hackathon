import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  MemoryReplayStore,
  canonicalJson,
  verifySignedPayload,
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

// These assertions catch authorization, temporal and portfolio guards being removed.
// Keys are generated solely for this offline model; no wallet or external signer is used.
test('canonical signed bytes preserve nested values and reject ambiguous numeric or object inputs', () => {
  const value = Object.assign(Object.create(null), { z: 'v', a: [true, false, null, 2] });
  assert.equal(canonicalJson(value), '{"a":[true,false,null,2],"z":"v"}');
  for (const invalid of [0.25, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => canonicalJson(invalid), { code: 'INVALID_CANONICAL_NUMBER' });
  for (const invalid of [undefined, 1n, new Date(0), new Set(), () => 1])
    assert.throws(() => canonicalJson(invalid), { code: 'INVALID_CANONICAL_VALUE' });
});

test('signature verification binds key identity and payload with both PEM and KeyObject inputs', () => {
  const signed = signPayload({ amount: '7' }, 'ephemeral', createPrivateKey(userKeys.privateKeyPem));
  assert.equal(verifySignedPayload(signed, 'ephemeral', createPublicKey(userKeys.publicKeyPem)), true);
  assert.equal(verifySignedPayload(signed, 'other', userKeys.publicKeyPem), false);
  assert.equal(verifySignedPayload(signed, 'ephemeral', runtimeKeys.publicKeyPem), false);
  assert.equal(verifySignedPayload(signed, 'ephemeral', 'invalid-pem'), false);
  assert.equal(
    verifySignedPayload({ ...signed, payload: { amount: '8' } }, 'ephemeral', userKeys.publicKeyPem),
    false,
  );
  assert.equal(
    verifySignedPayload({ ...signed, payload: undefined }, 'ephemeral', userKeys.publicKeyPem),
    false,
  );
  assert.equal(
    verifySignedPayload(
      { ...signed, signature: { ...signed.signature, algorithm: 'RSA' as 'Ed25519' } },
      'ephemeral',
      userKeys.publicKeyPem,
    ),
    false,
  );
});

function grantWith(changes: Partial<AuthorizationGrant>) {
  return signPayload({ ...grant().payload, ...changes }, 'user-key-1', userKeys.privateKeyPem);
}

const invalidGrants: { name: string; changes: Partial<AuthorizationGrant>; code: string }[] = [
  { name: 'empty grant identity', changes: { grantId: '' }, code: 'INVALID_IDENTIFIER' },
  {
    name: 'nonstring user identity',
    changes: { userId: 7 as unknown as string },
    code: 'INVALID_IDENTIFIER',
  },
  {
    name: 'reversed grant window',
    changes: { validUntil: '2026-08-04T00:00:00.000Z' },
    code: 'INVALID_GRANT_WINDOW',
  },
  {
    name: 'grant not yet active',
    changes: { validFrom: '2026-09-05T00:00:00.000Z' },
    code: 'GRANT_INACTIVE',
  },
  { name: 'noncanonical grant timestamp', changes: { validFrom: '2026-09-04' }, code: 'INVALID_TIMESTAMP' },
  { name: 'invalid timestamp text', changes: { validFrom: 'not-a-time' }, code: 'INVALID_TIMESTAMP' },
  { name: 'nonstring timestamp', changes: { validFrom: 7 as unknown as string }, code: 'INVALID_TIMESTAMP' },
];
for (const field of ['readAccount', 'readMarketData', 'placeOrders', 'withdraw', 'transfer'] as const)
  invalidGrants.push({
    name: `unsafe permission ${field}`,
    changes: {
      permissions: { ...grant().payload.permissions, [field]: ['withdraw', 'transfer'].includes(field) },
    },
    code: 'UNSAFE_PERMISSIONS',
  });
for (const { name, changes, code } of invalidGrants)
  test(`signed grant rejects ${name} before consuming its nonce`, async () => {
    const authorization = grantWith(changes);
    const seen: unknown[] = [];
    const input = {
      ...request(authorization, decision(authorization)),
      replayStore: {
        consume: async (...args: unknown[]) => {
          seen.push(args);
          return true;
        },
      },
    };
    await expectCode(issueExecutionPermit(input), code);
    assert.equal(seen.length, 0);
  });

const invalidPolicies: { name: string; changes: Partial<RiskPolicy>; code: string }[] = [
  { name: 'unknown schema', changes: { schemaVersion: 2 as 1 }, code: 'UNSUPPORTED_POLICY' },
  { name: 'empty allowlist', changes: { allowedVenues: [] }, code: 'INVALID_ALLOWLIST' },
  {
    name: 'non-array allowlist',
    changes: { allowedVenues: 'venue' as unknown as string[] },
    code: 'INVALID_ALLOWLIST',
  },
  {
    name: 'oversized allowlist',
    changes: { allowedVenues: Array.from({ length: 17 }, (_, i) => `venue-${i}`) },
    code: 'INVALID_ALLOWLIST',
  },
  {
    name: 'duplicate allowlist',
    changes: { allowedInstruments: ['BTC-USDT', 'BTC-USDT'] },
    code: 'INVALID_ALLOWLIST',
  },
  {
    name: 'invalid allowlist identity',
    changes: { allowedInstruments: ['BTC USDT'] },
    code: 'INVALID_IDENTIFIER',
  },
  { name: 'zero positive limit', changes: { maxOrderNotionalUsdMicros: '0' }, code: 'INVALID_AMOUNT' },
  { name: 'negative positive limit', changes: { maxGrossNotionalUsdMicros: '-1' }, code: 'INVALID_AMOUNT' },
  { name: 'decimal amount', changes: { maxPositionNotionalUsdMicros: '1.5' }, code: 'INVALID_AMOUNT' },
  {
    name: 'numeric amount',
    changes: { maxDailyLossUsdMicros: 100 as unknown as string },
    code: 'INVALID_AMOUNT',
  },
  { name: 'low leverage bound', changes: { maxLeverageBps: 0 }, code: 'INVALID_INTEGER' },
  { name: 'high leverage bound', changes: { maxLeverageBps: 100001 }, code: 'INVALID_INTEGER' },
  {
    name: 'wrong integer type',
    changes: { maxLeverageBps: '1000' as unknown as number },
    code: 'INVALID_INTEGER',
  },
  {
    name: 'permit longer than decision age',
    changes: { executionPermitTtlMs: 31000 },
    code: 'INVALID_POLICY',
  },
];
for (const { name, changes, code } of invalidPolicies)
  test(`signed policy rejects ${name}`, async () => {
    const authorization = grant(policy(changes));
    await expectCode(issueExecutionPermit(request(authorization, decision(authorization))), code);
  });

const invalidDecisions: { name: string; changes: Partial<StrategyDecision>; code: string }[] = [
  { name: 'foreign family', changes: { strategyFamilyId: 'other-family' }, code: 'UNTRUSTED_RELEASE' },
  { name: 'foreign version', changes: { strategyVersionId: 'v2' }, code: 'UNTRUSTED_RELEASE' },
  {
    name: 'foreign measurement',
    changes: { codeMeasurement: `sha256:${'cd'.repeat(32)}` },
    code: 'UNTRUSTED_RELEASE',
  },
  { name: 'foreign grant', changes: { grantId: 'other-grant' }, code: 'DECISION_GRANT_MISMATCH' },
  { name: 'unapproved venue', changes: { venue: 'other-venue' }, code: 'VENUE_NOT_ALLOWED' },
  { name: 'empty nonce', changes: { nonce: '' }, code: 'INVALID_IDENTIFIER' },
  { name: 'malformed policy hash', changes: { policyHash: 'NOT-A-HASH' }, code: 'INVALID_HASH' },
  { name: 'nonstring policy hash', changes: { policyHash: 1 as unknown as string }, code: 'INVALID_HASH' },
  {
    name: 'future decision',
    changes: { issuedAt: '2026-09-04T08:00:01.001Z' },
    code: 'DECISION_FROM_FUTURE',
  },
  { name: 'old decision', changes: { issuedAt: '2026-09-04T07:59:29.999Z' }, code: 'STALE_DECISION' },
  { name: 'expired decision', changes: { expiresAt: '2026-09-04T08:00:00.000Z' }, code: 'STALE_DECISION' },
  {
    name: 'reversed decision window',
    changes: { issuedAt: '2026-09-04T08:00:00.500Z', expiresAt: '2026-09-04T08:00:00.200Z' },
    code: 'INVALID_DECISION_WINDOW',
  },
  {
    name: 'overlong decision window',
    changes: { expiresAt: '2026-09-04T08:01:00.000Z' },
    code: 'INVALID_DECISION_WINDOW',
  },
  {
    name: 'too many targets',
    changes: {
      targets: Array.from({ length: 129 }, () => ({ instrument: 'BTC-USDT', targetNotionalUsdMicros: '0' })),
    },
    code: 'TOO_MANY_TARGETS',
  },
];
for (const { name, changes, code } of invalidDecisions)
  test(`runtime-signed decision rejects ${name}`, async () => {
    const authorization = grant();
    await expectCode(issueExecutionPermit(request(authorization, decision(authorization, changes))), code);
  });

const invalidAccounts: { name: string; changes: Partial<AccountSnapshot>; code: string }[] = [
  { name: 'foreign user', changes: { userId: 'other-user' }, code: 'ACCOUNT_USER_MISMATCH' },
  { name: 'unapproved venue', changes: { venue: 'other-venue' }, code: 'ACCOUNT_VENUE_NOT_ALLOWED' },
  {
    name: 'future observation',
    changes: { capturedAt: '2026-09-04T08:00:01.001Z' },
    code: 'ACCOUNT_SNAPSHOT_FROM_FUTURE',
  },
  {
    name: 'stale observation',
    changes: { capturedAt: '2026-09-04T07:59:54.999Z' },
    code: 'STALE_ACCOUNT_SNAPSHOT',
  },
  { name: 'zero equity', changes: { equityUsdMicros: '0' }, code: 'INVALID_AMOUNT' },
  { name: 'decimal pnl', changes: { dailyPnlUsdMicros: '1.5' }, code: 'INVALID_AMOUNT' },
  {
    name: 'noncanonical position amount',
    changes: { positionNotionalUsdMicros: { 'BTC-USDT': '01' } },
    code: 'INVALID_AMOUNT',
  },
  {
    name: 'too many positions',
    changes: {
      positionNotionalUsdMicros: Object.fromEntries(
        Array.from({ length: 1001 }, (_, i) => [`asset-${i}`, '0']),
      ),
    },
    code: 'TOO_MANY_POSITIONS',
  },
];
for (const { name, changes, code } of invalidAccounts)
  test(`account validation rejects ${name}`, async () => {
    await expectCode(issueExecutionPermit(request(undefined, undefined, account(changes))), code);
  });

test('a valid signature cannot bind a decision to another authorized family or account venue', async () => {
  const authorization = grant(policy({ allowedVenues: ['binance-subaccount-1', 'venue-2'] }));
  const foreignFamily = decision(authorization, { strategyFamilyId: 'other-family' });
  const input = request(authorization, foreignFamily);
  input.release = { ...release(), strategyFamilyId: 'other-family' };
  await expectCode(issueExecutionPermit(input), 'DECISION_GRANT_MISMATCH');
  await expectCode(
    issueExecutionPermit(request(authorization, decision(authorization), account({ venue: 'venue-2' }))),
    'VENUE_MISMATCH',
  );
});

test('invalid verifier clock and trusted-release measurement fail closed', async () => {
  await expectCode(issueExecutionPermit({ ...request(), now: new Date(NaN) }), 'INVALID_TIME');
  for (const measurement of ['invalid', 1 as unknown as string])
    await expectCode(
      issueExecutionPermit({ ...request(), release: { ...release(), codeMeasurement: measurement } }),
      'INVALID_MEASUREMENT',
    );
  const input = request();
  await expectCode(
    issueExecutionPermit({
      ...input,
      grant: { ...input.grant, signature: { ...input.grant.signature, value: 'broken' } },
    }),
    'INVALID_USER_SIGNATURE',
  );
});

const rejectedRisk: {
  name: string;
  targets: StrategyDecision['targets'];
  snapshot?: Partial<AccountSnapshot>;
  code: string;
}[] = [
  {
    name: 'duplicate targets',
    targets: [
      { instrument: 'BTC-USDT', targetNotionalUsdMicros: '0' },
      { instrument: 'BTC-USDT', targetNotionalUsdMicros: '0' },
    ],
    code: 'DUPLICATE_TARGET',
  },
  {
    name: 'unapproved instrument',
    targets: [{ instrument: 'DOGE-USDT', targetNotionalUsdMicros: '0' }],
    code: 'INSTRUMENT_NOT_ALLOWED',
  },
  {
    name: 'oversized order delta',
    targets: [{ instrument: 'BTC-USDT', targetNotionalUsdMicros: '3000000000' }],
    code: 'ORDER_LIMIT_EXCEEDED',
  },
  {
    name: 'gross limit including untouched positions',
    targets: [{ instrument: 'BTC-USDT', targetNotionalUsdMicros: '500000000' }],
    snapshot: { positionNotionalUsdMicros: { 'BTC-USDT': '500000000', 'ETH-USDT': '8000000000' } },
    code: 'GROSS_LIMIT_EXCEEDED',
  },
  {
    name: 'leverage ceiling',
    targets: [{ instrument: 'BTC-USDT', targetNotionalUsdMicros: '2000000000' }],
    snapshot: { equityUsdMicros: '500000000' },
    code: 'LEVERAGE_LIMIT_EXCEEDED',
  },
  {
    name: 'loss switch sign flip despite lower gross',
    targets: [{ instrument: 'BTC-USDT', targetNotionalUsdMicros: '-100000000' }],
    snapshot: { dailyPnlUsdMicros: '-500000000' },
    code: 'DAILY_LOSS_KILL_SWITCH',
  },
  {
    name: 'loss switch opens another position despite lower gross',
    targets: [
      { instrument: 'BTC-USDT', targetNotionalUsdMicros: '0' },
      { instrument: 'ETH-USDT', targetNotionalUsdMicros: '100000000' },
    ],
    snapshot: { dailyPnlUsdMicros: '-500000000' },
    code: 'DAILY_LOSS_KILL_SWITCH',
  },
];
for (const { name, targets, snapshot, code } of rejectedRisk)
  test(`portfolio risk rejects ${name}`, async () => {
    const authorization = grant();
    await expectCode(
      issueExecutionPermit(request(authorization, decision(authorization, { targets }), account(snapshot))),
      code,
    );
  });

test('unchanged targets create no order while an absent position creates only its exact delta', async () => {
  const authorization = grant();
  const permit = await issueExecutionPermit(
    request(
      authorization,
      decision(authorization, {
        targets: [
          { instrument: 'BTC-USDT', targetNotionalUsdMicros: '500000000' },
          { instrument: 'ETH-USDT', targetNotionalUsdMicros: '7000000' },
        ],
      }),
    ),
  );
  assert.deepEqual(permit.payload.orders, [{ instrument: 'ETH-USDT', deltaNotionalUsdMicros: '7000000' }]);
});

test('loss switch admits same-side short reduction and exact decision expiry caps the permit', async () => {
  const authorization = grant();
  const permit = await issueExecutionPermit(
    request(
      authorization,
      decision(authorization, {
        targets: [{ instrument: 'BTC-USDT', targetNotionalUsdMicros: '-100000000' }],
        expiresAt: '2026-09-04T08:00:00.500Z',
      }),
      account({ positionNotionalUsdMicros: { 'BTC-USDT': '-500000000' }, dailyPnlUsdMicros: '-500000000' }),
    ),
  );
  assert.deepEqual(permit.payload.orders, [{ instrument: 'BTC-USDT', deltaNotionalUsdMicros: '400000000' }]);
  assert.equal(permit.payload.expiresAt, '2026-09-04T08:00:00.500Z');
});

test('replay retention includes the expiry boundary and cleans only expired entries', async () => {
  const store = new MemoryReplayStore();
  assert.equal(await store.consume('scope', 'expired', 100, 10), true);
  assert.equal(await store.consume('scope', 'live', 1000, 10), true);
  assert.equal(await store.consume('scope', 'expired', 100, 100), false);
  assert.equal(await store.consume('scope', 'expired', 200, 101), true);
  assert.equal(await store.consume('scope', 'live', 1000, 101), false);
  assert.equal(await store.consume('other-scope', 'live', 1000, 101), true);
});

test('the real default clock does not bypass grant validation when no clock override is supplied', async () => {
  const authorization = grantWith({ grantId: '' });
  const { now, ...input } = request(authorization, decision(authorization));
  void now;
  await expectCode(issueExecutionPermit(input), 'INVALID_IDENTIFIER');
});
