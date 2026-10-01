import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessUnderlyingAsset } from '../packages/market-data/src/whitelist.ts';

const token = '0x' + 'ab'.repeat(20);
const assetId = '0x' + 'ab'.repeat(32);
const now = 1_800_000_000_000;
// Synthetic fixtures only: these values grant no live asset permission.
const source = () => ({ kind: 'ISSUER', url: 'https://issuer.example/investors', sha256: 'a'.repeat(64) });
function fixture() {
  return {
    nowMs: now,
    maxRegistryAgeMs: 60000,
    candidate: { chainId: 4663, contractAddress: token, kind: 'ROBINHOOD_OFFICIAL', enabled: true },
    registry: {
      observedAtMs: now - 1000,
      body: {
        assets: [
          {
            id: assetId,
            tokenSymbol: 'EXAMPLE',
            tokenDecimals: 18,
            status: 'ASSET_STATUS_ACTIVE',
            currentMultiplier: '1',
            pendingMultiplier: '',
            deployments: [{ chainId: 4663, contractAddress: token }],
          },
        ],
      },
    },
    reviews: [
      {
        assetId,
        chainId: 4663,
        contractAddress: token,
        symbol: 'EXAMPLE',
        underlyingType: 'COMMON_STOCK',
        exchange: 'NASDAQ',
        listedCompany: true,
        decision: 'APPROVED',
        reviewer: 'fixture-reviewer',
        reviewedAtMs: now - 2000,
        validUntilMs: now + 10000,
        source: source(),
      },
    ],
    oracle: {
      assetId,
      chainId: 4663,
      tokenAddress: token,
      proxyAddress: '0x' + '34'.repeat(20),
      source: { ...source(), kind: 'ORACLE_PROVIDER' },
      blockNumber: '123',
      blockHash: '0x' + '56'.repeat(32),
      observedAtMs: now - 1000,
      quoteCurrency: 'USD',
      priceBasis: 'TOKEN',
      answer: '12300000000',
      decimals: 8,
      roundId: '12',
      answeredInRound: '12',
      updatedAtMs: now - 10000,
      maxAgeMs: 60000,
      paused: false,
      sequencerUp: true,
      sequencerStartedAtMs: now - 120000,
      sequencerGraceMs: 60000,
    },
  };
}
function blocked(value: unknown, reason?: string) {
  const result = assessUnderlyingAsset(value);
  assert.equal(result.status, 'BLOCKED');
  if (result.status === 'BLOCKED' && reason) assert.equal(result.reason, reason);
}

test('complete evidence projects canonical address identity without repricing the token feed', () => {
  const f = fixture();
  f.candidate.contractAddress = token.toUpperCase().replace('0X', '0x');
  const result = assessUnderlyingAsset(f);
  assert.equal(result.status, 'ELIGIBLE');
  if (result.status === 'ELIGIBLE')
    assert.deepEqual(result.asset, {
      assetId,
      symbol: 'EXAMPLE',
      robinhoodTokenAddress: token,
      chainId: 4663,
      underlyingType: 'COMMON_STOCK',
      exchange: 'NASDAQ',
      robinhoodStatus: 'ACTIVE',
      oracleAddress: '0x' + '34'.repeat(20),
      enabled: true,
    });
});
test('same ticker, another chain or another deployment cannot acquire eligibility', () => {
  const f = fixture();
  f.candidate.contractAddress = '0x' + '78'.repeat(20);
  blocked(f);
  const g = fixture();
  g.candidate.chainId = 46630;
  blocked(g);
  const h = fixture();
  h.candidate.chainId = 1;
  blocked(h);
  const j = fixture();
  j.reviews[0]!.assetId = '0xcd';
  blocked(j);
});
test('official Testnet deployments can qualify only with independently matching evidence', () => {
  const f = fixture();
  f.candidate.chainId = 46630;
  f.registry.body.assets[0]!.deployments[0]!.chainId = 46630;
  f.reviews[0]!.chainId = 46630;
  f.oracle.chainId = 46630;
  assert.equal(assessUnderlyingAsset(f).status, 'ELIGIBLE');
});
test('every excluded underlying type is denied even with an active canonical token', () => {
  for (const type of [
    'ETF',
    'ETP',
    'ETN',
    'ADR',
    'PREFERRED_STOCK',
    'WARRANT',
    'CLOSED_END_FUND',
    'FUND',
    'INDEX',
    'CRYPTO',
    'PRIVATE_COMPANY',
    'PRE_IPO',
    'BOND',
    'OTHER_RWA',
    'SYNTHETIC',
    'UNKNOWN',
  ]) {
    const f = fixture();
    f.reviews[0]!.underlyingType = type;
    blocked(f, 'UNDERLYING_EXCLUDED');
  }
});
test('all three approved exchanges work while other exchanges and noncompany assets are denied', () => {
  for (const exchange of ['NASDAQ', 'NYSE', 'NYSE_AMERICAN']) {
    const f = fixture();
    f.reviews[0]!.exchange = exchange;
    assert.equal(assessUnderlyingAsset(f).status, 'ELIGIBLE');
  }
  for (const exchange of ['OTC', 'LSE', 'UNKNOWN']) {
    const f = fixture();
    f.reviews[0]!.exchange = exchange;
    blocked(f);
  }
  const f = fixture();
  f.reviews[0]!.listedCompany = false;
  blocked(f);
});
test('missing, ambiguous, expired or unsupported manual review evidence fails closed', () => {
  const a = fixture();
  a.reviews = [];
  blocked(a);
  const b = fixture();
  b.reviews.push(structuredClone(b.reviews[0]!));
  blocked(b);
  const c = fixture();
  c.reviews[0]!.validUntilMs = now;
  blocked(c);
  const d = fixture();
  d.reviews[0]!.reviewedAtMs = now + 1;
  blocked(d);
  const e = fixture();
  e.reviews[0]!.decision = 'PENDING';
  blocked(e);
  const f = fixture();
  f.reviews[0]!.source.kind = 'SOCIAL_MEDIA';
  blocked(f);
  const g = fixture();
  g.reviews[0]!.source.sha256 = '';
  blocked(g);
  const h = fixture();
  h.reviews[0]!.source.url = 'https://user:password@issuer.example';
  blocked(h);
  const i = fixture();
  i.reviews[0]!.symbol = 'OTHER';
  blocked(i);
});
test('inactive, ambiguous, stale registry and corporate-action transitions block admission', () => {
  const a = fixture();
  a.registry.body.assets[0]!.status = 'ASSET_STATUS_INACTIVE';
  blocked(a);
  const b = fixture();
  b.registry.body.assets.push(structuredClone(b.registry.body.assets[0]!));
  blocked(b);
  const c = fixture();
  c.registry.observedAtMs = now - 60001;
  blocked(c);
  const d = fixture();
  d.registry.observedAtMs = now + 1;
  blocked(d);
  const e = fixture();
  e.registry.body.assets[0]!.pendingMultiplier = '2';
  blocked(e);
});
test('test substitutes and operator-disabled records never enter the official allowlist', () => {
  const a = fixture();
  a.candidate.kind = 'TEST_SUBSTITUTE';
  blocked(a);
  const b = fixture();
  b.candidate.enabled = false;
  blocked(b);
});
test('oracle evidence is bound to the same asset, deployment, currency and token price basis', () => {
  for (const patch of [
    { assetId: '0xcd' },
    { chainId: 46630 },
    { tokenAddress: '0x' + '78'.repeat(20) },
    { proxyAddress: '0x' + '00'.repeat(20) },
    { quoteCurrency: 'EUR' },
    { priceBasis: 'UNDERLYING_SHARE' },
    { blockHash: '0x123' },
    { blockNumber: 'latest' },
  ]) {
    const f = fixture();
    Object.assign(f.oracle, patch);
    blocked(f);
  }
});
test('paused, invalid, stale or incomplete price rounds are not usable oracle evidence', () => {
  for (const patch of [
    { paused: true },
    { answer: '0' },
    { answer: '-1' },
    { answer: '1e8' },
    { decimals: 256 },
    { decimals: -1 },
    { roundId: '0' },
    { answeredInRound: '11' },
    { updatedAtMs: 0 },
    { updatedAtMs: now + 1 },
    { updatedAtMs: now - 60001 },
    { observedAtMs: now - 60001 },
    { observedAtMs: now + 1 },
  ]) {
    const f = fixture();
    Object.assign(f.oracle, patch);
    blocked(f);
  }
});
test('sequencer outage and recovery boundary block eligibility without a guessed grace period', () => {
  for (const patch of [
    { sequencerUp: false },
    { sequencerStartedAtMs: 0 },
    { sequencerStartedAtMs: now + 1 },
    { sequencerStartedAtMs: now - 60000 },
    { sequencerGraceMs: -1 },
    { sequencerGraceMs: NaN },
  ]) {
    const f = fixture();
    Object.assign(f.oracle, patch);
    blocked(f);
  }
});
test('malformed inputs and absent limits fail closed instead of throwing or applying defaults', () => {
  for (const x of [
    null,
    {},
    [],
    { ...fixture(), oracle: null },
    { ...fixture(), reviews: null },
    { ...fixture(), maxRegistryAgeMs: undefined },
    { ...fixture(), nowMs: NaN },
    { ...fixture(), oracle: { ...fixture().oracle, maxAgeMs: undefined } },
  ]) {
    assert.doesNotThrow(() => blocked(x));
  }
});
