// Read-only reference data. Registry membership does not grant trading permission.
export interface Selection {
  chainId: 4663 | 46630;
  contractAddress: string;
  symbol: string;
}
export interface RegistryAsset {
  id: string;
  symbol: string;
  status: string;
  multiplier: string;
  pendingMultiplier: string;
  deployments: { chainId: number; contractAddress: string }[];
}
export interface ReferenceObservation {
  kind: 'REFERENCE_ONLY';
  identity: string;
  assetId: string;
  symbol: string;
  generatedAt: number;
  receivedAt: number;
  underlyingBid: string;
  underlyingAsk: string;
  multiplier: string;
  tokenBidUsd18: string;
  tokenAskUsd18: string;
}
const SCALE = 10n ** 18n;
export function requireValue(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
function record(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_OBJECT');
  return value as Record<string, unknown>;
}
function text(value: unknown, pattern: RegExp): string {
  requireValue(typeof value === 'string' && pattern.test(value), 'INVALID_FIELD');
  return value;
}
export function address(value: unknown): string {
  const result = text(value, /^0x[0-9a-fA-F]{40}$/).toLowerCase();
  requireValue(result !== '0x' + '0'.repeat(40), 'ZERO_ADDRESS');
  return result;
}
export function symbol(value: unknown): string {
  return text(value, /^[A-Z][A-Z0-9.-]{0,23}$/);
}
function decimal(value: unknown): bigint {
  const s = text(value, /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/);
  const [whole, fraction = ''] = s.split('.');
  const result = BigInt(whole!) * SCALE + BigInt(fraction.padEnd(18, '0'));
  requireValue(result > 0n, 'NONPOSITIVE_DECIMAL');
  return result;
}
function deployments(value: unknown): RegistryAsset['deployments'] {
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= 100, 'INVALID_DEPLOYMENTS');
  const chains = new Set<number>();
  return value.map((item: unknown) => {
    const row = record(item);
    requireValue(
      typeof row.chainId === 'number' && Number.isSafeInteger(row.chainId) && row.chainId > 0,
      'INVALID_CHAIN',
    );
    requireValue(!chains.has(row.chainId), 'DUPLICATE_DEPLOYMENT');
    chains.add(row.chainId);
    return { chainId: row.chainId, contractAddress: address(row.contractAddress) };
  });
}
export function validateSelection(selection: Selection): Selection {
  requireValue(selection && [4663, 46630].includes(selection.chainId), 'INVALID_CHAIN');
  return {
    ...selection,
    symbol: symbol(selection.symbol),
    contractAddress: address(selection.contractAddress),
  };
}
export function parseRegistry(raw: unknown): RegistryAsset[] {
  const rows = record(raw).assets;
  requireValue(Array.isArray(rows) && rows.length <= 10000, 'INVALID_REGISTRY');
  const ids = new Set<string>();
  const identities = new Set<string>();
  return rows.map((item: unknown) => {
    const row = record(item);
    const id = text(row.id, /^0x[0-9a-f]{1,128}$/);
    requireValue(!ids.has(id), 'DUPLICATE_ASSET');
    ids.add(id);
    requireValue(row.tokenDecimals === 18, 'INVALID_TOKEN_DECIMALS');
    const ds = deployments(row.deployments);
    for (const d of ds) {
      const identity = `${d.chainId}:${d.contractAddress}`;
      requireValue(!identities.has(identity), 'DUPLICATE_DEPLOYMENT');
      identities.add(identity);
    }
    return {
      id,
      symbol: symbol(row.tokenSymbol),
      deployments: ds,
      status: text(row.status, /^ASSET_STATUS_(ACTIVE|INACTIVE|UNSPECIFIED)$/),
      multiplier: text(row.currentMultiplier, /^.{1,64}$/),
      pendingMultiplier: text(row.pendingMultiplier, /^.{0,64}$/),
    };
  });
}
export function normalizeReference(
  registry: RegistryAsset[],
  raw: unknown,
  requested: Selection,
  receivedAt: number,
  maxAgeMs: number,
): ReferenceObservation {
  const selection = validateSelection(requested);
  requireValue(
    Number.isSafeInteger(receivedAt) && receivedAt >= 0 && Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0,
    'INVALID_TIME_POLICY',
  );
  const matches = (d: { chainId: number; contractAddress: string }) =>
    d.chainId === selection.chainId && d.contractAddress === selection.contractAddress;
  const assets = registry.filter((a) => a.deployments.some(matches));
  requireValue(assets.length === 1 && assets[0]!.symbol === selection.symbol, 'REGISTRY_DEPLOYMENT_MISMATCH');
  const asset = assets[0]!;
  requireValue(asset.status === 'ASSET_STATUS_ACTIVE', 'ASSET_INACTIVE');
  // The REST surfaces do not promise an atomic corporate-action snapshot.
  requireValue(asset.pendingMultiplier === '', 'MULTIPLIER_TRANSITION_UNRESOLVED');
  const multiplier = decimal(asset.multiplier);
  const quotes = record(raw).quotes;
  requireValue(Array.isArray(quotes) && quotes.length === 1, 'AMBIGUOUS_QUOTES');
  const q = record(quotes[0]);
  requireValue(
    q.tokenSymbol === selection.symbol && deployments(q.deployments).some(matches),
    'QUOTE_DEPLOYMENT_MISMATCH',
  );
  requireValue(q.currency === 'USD' && q.isTradingHalt === false, 'QUOTE_UNAVAILABLE');
  const bid = decimal(q.bid),
    ask = decimal(q.ask);
  requireValue(bid <= ask, 'INVERTED_QUOTE');
  const time = text(q.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/);
  const generatedAt = Date.parse(time);
  requireValue(
    Number.isFinite(generatedAt) && new Date(generatedAt).toISOString().slice(0, 19) === time.slice(0, 19),
    'INVALID_CALENDAR_TIME',
  );
  requireValue(
    Number.isSafeInteger(generatedAt) && generatedAt <= receivedAt && receivedAt - generatedAt <= maxAgeMs,
    'STALE_OR_FUTURE_QUOTE',
  );
  const tokenBid = (bid * multiplier) / SCALE;
  requireValue(tokenBid > 0n, 'SUBPRECISION_PRICE');
  return {
    kind: 'REFERENCE_ONLY',
    identity: `${selection.chainId}:${selection.contractAddress}`,
    assetId: asset.id,
    symbol: asset.symbol,
    generatedAt,
    receivedAt,
    underlyingBid: q.bid as string,
    underlyingAsk: q.ask as string,
    multiplier: asset.multiplier,
    tokenBidUsd18: tokenBid.toString(),
    tokenAskUsd18: ((ask * multiplier + SCALE - 1n) / SCALE).toString(),
  };
}
