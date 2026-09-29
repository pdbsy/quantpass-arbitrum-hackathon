export const SCALE = 1_000_000n;
export const BPS = 10_000n;
export const ENGINE_VERSION = 'alphaforge-automata-1';
// Synthetic identities, never deployable token addresses or claims of issuer approval.
export const ASSETS = Object.freeze([
  {
    id: 'rwa-a',
    symbol: 'RWA-A',
    decimals: 6,
    chain: 'robinhood-chain-testnet',
    issuer: 'SYNTHETIC_FIXTURE',
    contract: null,
  },
  {
    id: 'rwa-b',
    symbol: 'RWA-B',
    decimals: 6,
    chain: 'robinhood-chain-testnet',
    issuer: 'SYNTHETIC_FIXTURE',
    contract: null,
  },
]);
export type Limits =
  | { mode: 'off' }
  | { mode: 'percent'; upperBps?: number; lowerBps?: number }
  | { mode: 'price'; assetId: string; upper?: string; lower?: string };
export interface Parameters {
  strategyMode?: 'rebalance' | 'external';
  weights: Record<string, number>;
  deviationBps: number;
  intervalMs: number;
  feeBps: number;
  maxSlippageBps: number;
  limits: Limits;
}
export interface Quote {
  assetId: string;
  bid: string;
  ask: string;
  reference?: string;
  observedAt: number;
  expiresAt: number;
  capacity: string;
  slippageBps: number;
  available: boolean;
}
export interface Frame {
  seq: number;
  at: number;
  quotes: Quote[];
}
export interface Trade {
  id: string;
  at: number;
  assetId: string;
  side: 'buy' | 'sell';
  quantity: string;
  price: string;
  fee: string;
  cashAfter: string;
  purpose: 'rebalance' | 'liquidation';
}
export interface Run {
  lastDecision?: {
    id: string;
    frameSeq: number;
    at: number;
    targets: Record<string, number>;
    trades: number;
  };
  version: typeof ENGINE_VERSION;
  id: string;
  parameters: Parameters;
  status: 'running' | 'paused' | 'liquidating' | 'blocked' | 'stopped';
  cursor: number;
  clock: number;
  lastFrame: string;
  nextDecisionAt: number;
  cash: string;
  positions: Record<string, { quantity: string; cost: string }>;
  quotes: Record<string, Quote>;
  usedCapacity: Record<string, string>;
  initialCash: string;
  netContributed: string;
  unitsNumerator: string;
  unitsDenominator: string;
  emptyUnitValue: { numerator: string; denominator: string };
  fees: string;
  realizedPnl: string;
  trades: Trade[];
  trigger: { reason: 'manual' | 'upper' | 'lower'; at: number; equity: string } | null;
  reason: string | null;
  history: { at: number; equity: string; returnBps: number; status: Run['status']; reason: string | null }[];
}
export type Action =
  | { type: 'decision'; id: string; frameSeq: number; targets: Record<string, number> }
  | { type: 'frame'; frame: Frame }
  | { type: 'stop' | 'pause' | 'resume' }
  | { type: 'fund'; direction: 'in' | 'out'; amount: string };
export function requireThat(ok: unknown, code: string): asserts ok {
  if (!ok) throw new Error(code);
}
export function amount(value: string): bigint {
  requireThat(typeof value === 'string' && /^(0|[1-9][0-9]{0,23})$/.test(value), 'INVALID_AMOUNT');
  return BigInt(value);
}
const integer = (v: number, min: number, max: number) => Number.isSafeInteger(v) && v >= min && v <= max;
export function validateParameters(p: Parameters) {
  requireThat(p && typeof p === 'object' && p.weights && typeof p.weights === 'object', 'INVALID_PARAMETERS');
  requireThat(
    p.strategyMode === undefined || ['rebalance', 'external'].includes(p.strategyMode),
    'INVALID_PARAMETERS',
  );
  const entries = Object.entries(p.weights);
  requireThat(
    entries.length > 0 &&
      entries.length <= ASSETS.length &&
      entries.every(([id, weight]) => ASSETS.some((a) => a.id === id) && integer(weight, 0, 10000)) &&
      entries.reduce((n, [, w]) => n + w, 0) <= 10000,
    'INVALID_PARAMETERS',
  );
  requireThat(
    integer(p.deviationBps, 1, 10000) &&
      integer(p.intervalMs, 1000, 86400000) &&
      integer(p.feeBps, 0, 1000) &&
      integer(p.maxSlippageBps, 0, 1000),
    'INVALID_PARAMETERS',
  );
  const l = p.limits;
  requireThat(l && ['off', 'percent', 'price'].includes(l.mode), 'INVALID_PARAMETERS');
  if (l.mode === 'percent') {
    requireThat(l.upperBps !== undefined || l.lowerBps !== undefined, 'INVALID_PARAMETERS');
    requireThat(l.upperBps === undefined || integer(l.upperBps, 1, 1000000), 'INVALID_PARAMETERS');
    requireThat(l.lowerBps === undefined || integer(l.lowerBps, -10000, -1), 'INVALID_PARAMETERS');
  }
  if (l.mode === 'price') {
    requireThat(Object.hasOwn(p.weights, l.assetId), 'INVALID_PARAMETERS');
    requireThat(l.upper !== undefined || l.lower !== undefined, 'INVALID_PARAMETERS');
    if (l.upper !== undefined) requireThat(amount(l.upper) > 0n, 'INVALID_PARAMETERS');
    if (l.lower !== undefined) requireThat(amount(l.lower) > 0n, 'INVALID_PARAMETERS');
    if (l.upper !== undefined && l.lower !== undefined)
      requireThat(amount(l.upper) > amount(l.lower), 'INVALID_PARAMETERS');
  }
}
