import { address, parseRegistry } from './robinhood.ts';

export interface AllowedUnderlyingAsset {
  assetId: string;
  symbol: string;
  robinhoodTokenAddress: `0x${string}`;
  chainId: 4663 | 46630;
  underlyingType: 'COMMON_STOCK';
  exchange: 'NASDAQ' | 'NYSE' | 'NYSE_AMERICAN';
  robinhoodStatus: 'ACTIVE';
  oracleAddress: `0x${string}`;
  enabled: boolean;
}
export type UnderlyingAssetAssessment =
  { status: 'BLOCKED'; reason: string } | { status: 'ELIGIBLE'; asset: AllowedUnderlyingAsset };

function requireEvidence(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
function object(value: unknown): Record<string, unknown> {
  requireEvidence(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_EVIDENCE');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min = 0): number {
  requireEvidence(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min,
    'INVALID_INTEGER',
  );
  return value;
}
function text(value: unknown): string {
  requireEvidence(
    typeof value === 'string' && value.trim().length > 0 && value.length <= 2048,
    'INVALID_TEXT',
  );
  return value;
}
function uint(value: unknown, bits: number): bigint {
  requireEvidence(typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value), 'INVALID_POSITIVE_INTEGER');
  const n = BigInt(value);
  requireEvidence(n < 1n << BigInt(bits), 'INTEGER_OVERFLOW');
  return n;
}
function source(value: unknown, kinds: string[]): void {
  const s = object(value);
  requireEvidence(kinds.includes(text(s.kind)), 'UNSUPPORTED_EVIDENCE_SOURCE');
  requireEvidence(typeof s.sha256 === 'string' && /^[0-9a-f]{64}$/.test(s.sha256), 'INVALID_SOURCE_DIGEST');
  const url = new URL(text(s.url));
  requireEvidence(
    url.protocol === 'https:' && !url.username && !url.password && !url.hash,
    'INVALID_SOURCE_URL',
  );
}
function fresh(value: unknown, now: number, maxAge: number): number {
  const at = integer(value, 1);
  requireEvidence(at <= now && now - at <= maxAge, 'STALE_OR_FUTURE_EVIDENCE');
  return at;
}

/**
 * Pure, offline consistency gate over trusted registry/review/RPC artifacts.
 * It does NOT authenticate the supplied artifacts, call RPC or grant execution.
 * Never pass strategy/client assertions here as if they were verified evidence.
 */
export function assessUnderlyingAsset(input: unknown): UnderlyingAssetAssessment {
  try {
    const i = object(input);
    const now = integer(i.nowMs, 1);
    const registryAge = integer(i.maxRegistryAgeMs, 1);
    const candidate = object(i.candidate);
    requireEvidence(candidate.kind === 'ROBINHOOD_OFFICIAL', 'NOT_OFFICIAL_ASSET');
    requireEvidence(candidate.enabled === true, 'DISABLED');
    const chain = candidate.chainId;
    requireEvidence(chain === 4663 || chain === 46630, 'UNSUPPORTED_CHAIN');
    const token = address(candidate.contractAddress);
    const registry = object(i.registry);
    fresh(registry.observedAtMs, now, registryAge);
    const assets = parseRegistry(registry.body);
    const matches = assets.filter((a) =>
      a.deployments.some((d) => d.chainId === chain && d.contractAddress === token),
    );
    requireEvidence(matches.length === 1, 'CANONICAL_DEPLOYMENT_MISSING');
    const asset = matches[0]!;
    requireEvidence(asset.status === 'ASSET_STATUS_ACTIVE', 'ASSET_NOT_ACTIVE');
    requireEvidence(asset.pendingMultiplier === '', 'CORPORATE_ACTION_PENDING');
    requireEvidence(
      /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/.test(asset.multiplier) &&
        BigInt(asset.multiplier.replace('.', '')) > 0n,
      'INVALID_MULTIPLIER',
    );

    requireEvidence(Array.isArray(i.reviews) && i.reviews.length <= 10000, 'INVALID_REVIEWS');
    const reviews = i.reviews
      .map(object)
      .filter((r) => r.assetId === asset.id && r.chainId === chain && address(r.contractAddress) === token);
    requireEvidence(reviews.length === 1, 'REVIEW_MISSING_OR_AMBIGUOUS');
    const review = reviews[0]!;
    requireEvidence(review.symbol === asset.symbol, 'REVIEW_SYMBOL_MISMATCH');
    requireEvidence(
      review.underlyingType === 'COMMON_STOCK' && review.listedCompany === true,
      'UNDERLYING_EXCLUDED',
    );
    const exchange = review.exchange;
    requireEvidence(
      exchange === 'NASDAQ' || exchange === 'NYSE' || exchange === 'NYSE_AMERICAN',
      'EXCHANGE_EXCLUDED',
    );
    requireEvidence(review.decision === 'APPROVED', 'REVIEW_NOT_APPROVED');
    text(review.reviewer);
    const reviewedAt = integer(review.reviewedAtMs, 1);
    const validUntil = integer(review.validUntilMs, 1);
    requireEvidence(
      reviewedAt <= now && validUntil > now && validUntil > reviewedAt,
      'REVIEW_EXPIRED_OR_FUTURE',
    );
    source(review.source, ['ISSUER', 'EXCHANGE']);

    const oracle = object(i.oracle);
    requireEvidence(
      oracle.assetId === asset.id && oracle.chainId === chain && address(oracle.tokenAddress) === token,
      'ORACLE_IDENTITY_MISMATCH',
    );
    const proxy = address(oracle.proxyAddress);
    source(oracle.source, ['ORACLE_PROVIDER']);
    uint(oracle.blockNumber, 256);
    requireEvidence(
      typeof oracle.blockHash === 'string' &&
        /^0x[0-9a-fA-F]{64}$/.test(oracle.blockHash) &&
        !/^0x0{64}$/.test(oracle.blockHash),
      'INVALID_BLOCK_HASH',
    );
    requireEvidence(
      oracle.quoteCurrency === 'USD' && oracle.priceBasis === 'TOKEN',
      'ORACLE_PRICE_BASIS_MISMATCH',
    );
    requireEvidence(oracle.paused === false, 'ORACLE_PAUSED_OR_UNKNOWN');
    uint(oracle.answer, 255);
    requireEvidence(integer(oracle.decimals) <= 255, 'INVALID_ORACLE_DECIMALS');
    const round = uint(oracle.roundId, 80);
    requireEvidence(uint(oracle.answeredInRound, 80) >= round, 'INCOMPLETE_ROUND');
    const maxAge = integer(oracle.maxAgeMs, 1);
    const observedAt = fresh(oracle.observedAtMs, now, maxAge);
    const updatedAt = fresh(oracle.updatedAtMs, now, maxAge);
    requireEvidence(updatedAt <= observedAt, 'ORACLE_TIME_INCONSISTENT');
    requireEvidence(oracle.sequencerUp === true, 'SEQUENCER_UNAVAILABLE');
    const startedAt = integer(oracle.sequencerStartedAtMs, 1);
    const grace = integer(oracle.sequencerGraceMs);
    requireEvidence(startedAt <= observedAt && observedAt - startedAt > grace, 'SEQUENCER_RECOVERY');

    return {
      status: 'ELIGIBLE',
      asset: {
        assetId: asset.id,
        symbol: asset.symbol,
        robinhoodTokenAddress: token as `0x${string}`,
        chainId: chain,
        underlyingType: 'COMMON_STOCK',
        exchange,
        robinhoodStatus: 'ACTIVE',
        oracleAddress: proxy as `0x${string}`,
        enabled: true,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { status: 'BLOCKED', reason: /^[A-Z][A-Z_]{1,80}$/.test(message) ? message : 'INVALID_EVIDENCE' };
  }
}
