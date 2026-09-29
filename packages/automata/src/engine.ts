import { amount, requireThat, validateParameters, ASSETS, ENGINE_VERSION, SCALE, BPS } from './model.ts';
import type { Action, Frame, Parameters, Quote, Run, Trade } from './model.ts';
import { validateTargets } from './strategy-protocol.ts';

const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const min = (a: bigint, b: bigint) => (a < b ? a : b);
function fresh(run: Run, q: Quote | undefined): q is Quote {
  return !!q && q.available && q.observedAt <= run.clock && run.clock <= q.expiresAt;
}
export function equity(run: Run): bigint {
  return (
    amount(run.cash) +
    Object.entries(run.positions).reduce(
      (sum, [id, p]) => sum + (amount(p.quantity) * amount(run.quotes[id]?.bid ?? '0')) / SCALE,
      0n,
    )
  );
}
export function returnBps(run: Run): number {
  const units = BigInt(run.unitsNumerator);
  return units
    ? Number(((equity(run) * BigInt(run.unitsDenominator) - units) * BPS) / units)
    : Number(
        ((BigInt(run.emptyUnitValue.numerator) - BigInt(run.emptyUnitValue.denominator)) * BPS) /
          BigInt(run.emptyUnitValue.denominator),
      );
}
export function createRun(id: string, cash: string, parameters: Parameters): Run {
  requireThat(/^[a-zA-Z0-9_-]{1,80}$/.test(id), 'INVALID_ID');
  requireThat(amount(cash) > 0n, 'NO_ACTIVE_FUNDS');
  validateParameters(parameters);
  return {
    version: ENGINE_VERSION,
    id,
    parameters: structuredClone(parameters),
    status: 'running',
    cursor: 0,
    clock: 0,
    lastFrame: '',
    nextDecisionAt: 0,
    cash,
    positions: {},
    quotes: {},
    usedCapacity: {},
    initialCash: cash,
    netContributed: cash,
    unitsNumerator: cash,
    unitsDenominator: '1',
    emptyUnitValue: { numerator: '1', denominator: '1' },
    fees: '0',
    realizedPnl: '0',
    trades: [],
    trigger: null,
    reason: null,
    history: [],
  };
}
function validateFrame(run: Run, frame: Frame) {
  requireThat(
    Number.isSafeInteger(frame.seq) &&
      frame.seq === run.cursor + 1 &&
      Number.isSafeInteger(frame.at) &&
      frame.at > run.clock,
    'FRAME_ORDER',
  );
  requireThat(Array.isArray(frame.quotes) && frame.quotes.length <= ASSETS.length, 'INVALID_QUOTE');
  const seen = new Set<string>();
  for (const q of frame.quotes) {
    try {
      requireThat(ASSETS.some((a) => a.id === q.assetId) && !seen.has(q.assetId), 'INVALID_QUOTE');
      requireThat(amount(q.bid) > 0n && amount(q.ask) >= amount(q.bid), 'INVALID_QUOTE');
      amount(q.capacity);
      if (q.reference !== undefined) requireThat(amount(q.reference) > 0n, 'INVALID_QUOTE');
      requireThat(
        Number.isSafeInteger(q.observedAt) &&
          q.observedAt >= 0 &&
          q.observedAt <= frame.at &&
          Number.isSafeInteger(q.expiresAt) &&
          q.expiresAt >= q.observedAt &&
          Number.isSafeInteger(q.slippageBps) &&
          q.slippageBps >= 0 &&
          q.slippageBps <= 10000 &&
          typeof q.available === 'boolean',
        'INVALID_QUOTE',
      );
      const before = run.quotes[q.assetId];
      requireThat(!before || q.observedAt >= before.observedAt, 'INVALID_QUOTE');
      if (before && q.observedAt === before.observedAt)
        requireThat(JSON.stringify(q) === JSON.stringify(before), 'INVALID_QUOTE');
      seen.add(q.assetId);
    } catch {
      throw new Error('INVALID_QUOTE');
    }
  }
}
function valuationsFresh(run: Run) {
  return Object.entries(run.positions).every(
    ([id, p]) => amount(p.quantity) === 0n || fresh(run, run.quotes[id]),
  );
}
function trigger(run: Run, reason: 'manual' | 'upper' | 'lower') {
  run.trigger ??= { reason, at: run.clock, equity: equity(run).toString() };
  run.status = 'liquidating';
}
function limits(run: Run) {
  if (run.trigger || run.status === 'stopped') return;
  const l = run.parameters.limits;
  if (l.mode === 'percent' && run.unitsNumerator !== '0' && valuationsFresh(run)) {
    const numerator = (equity(run) * BigInt(run.unitsDenominator) - BigInt(run.unitsNumerator)) * BPS;
    const denominator = BigInt(run.unitsNumerator);
    if (l.lowerBps !== undefined && numerator <= BigInt(l.lowerBps) * denominator) trigger(run, 'lower');
    else if (l.upperBps !== undefined && numerator >= BigInt(l.upperBps) * denominator) trigger(run, 'upper');
  } else if (l.mode === 'price') {
    const q = run.quotes[l.assetId];
    if (!fresh(run, q)) return;
    if (l.lower !== undefined && amount(q.bid) <= amount(l.lower)) trigger(run, 'lower');
    else if (l.upper !== undefined && amount(q.bid) >= amount(l.upper)) trigger(run, 'upper');
  }
}
function trade(run: Run, id: string, side: 'buy' | 'sell', requested: bigint, purpose: Trade['purpose']) {
  if (requested <= 0n) return;
  const q = run.quotes[id];
  if (!fresh(run, q)) {
    run.reason = '报价缺失、过期或交易场所不可用';
    return;
  }
  if (q.slippageBps > run.parameters.maxSlippageBps) {
    run.reason = '滑点超出配置上限';
    return;
  }
  const capacity = amount(q.capacity) - amount(run.usedCapacity[id] ?? '0');
  const position = run.positions[id] ?? { quantity: '0', cost: '0' };
  const price =
    side === 'buy'
      ? ceil(amount(q.ask) * (BPS + BigInt(q.slippageBps)), BPS)
      : (amount(q.bid) * (BPS - BigInt(q.slippageBps))) / BPS;
  if (price <= 0n) {
    run.reason = '无有效成交价格';
    return;
  }
  let quantity = min(requested, capacity);
  if (side === 'sell') quantity = min(quantity, amount(position.quantity));
  else
    quantity = min(
      quantity,
      (amount(run.cash) * BPS * SCALE) / (price * (BPS + BigInt(run.parameters.feeBps))),
    );
  if (quantity <= 0n) {
    run.reason = '报价容量或可用资金不足';
    return;
  }
  let gross = side === 'buy' ? ceil(quantity * price, SCALE) : (quantity * price) / SCALE;
  let fee = ceil(gross * BigInt(run.parameters.feeBps), BPS);
  if (side === 'buy' && gross + fee > amount(run.cash)) {
    quantity--;
    gross = ceil(quantity * price, SCALE);
    fee = ceil(gross * BigInt(run.parameters.feeBps), BPS);
  }
  if (quantity <= 0n || gross <= fee || (side === 'buy' && gross + fee > amount(run.cash))) {
    run.reason = '最小成交单位或费用约束阻止成交';
    return;
  }
  if (side === 'buy') {
    run.cash = (amount(run.cash) - gross - fee).toString();
    position.quantity = (amount(position.quantity) + quantity).toString();
    position.cost = (amount(position.cost) + gross + fee).toString();
  } else {
    const cost =
      quantity === amount(position.quantity)
        ? amount(position.cost)
        : (amount(position.cost) * quantity) / amount(position.quantity);
    position.quantity = (amount(position.quantity) - quantity).toString();
    position.cost = (amount(position.cost) - cost).toString();
    run.cash = (amount(run.cash) + gross - fee).toString();
    run.realizedPnl = (BigInt(run.realizedPnl) + gross - fee - cost).toString();
  }
  run.positions[id] = position;
  run.fees = (amount(run.fees) + fee).toString();
  run.usedCapacity[id] = (amount(run.usedCapacity[id] ?? '0') + quantity).toString();
  run.trades.push({
    id: `${run.id}-${run.trades.length + 1}`,
    at: run.clock,
    assetId: id,
    side,
    quantity: quantity.toString(),
    price: price.toString(),
    fee: fee.toString(),
    cashAfter: run.cash,
    purpose,
  });
}
function liquidate(run: Run) {
  run.status = 'liquidating';
  for (const id of Object.keys(run.positions).sort())
    trade(run, id, 'sell', amount(run.positions[id]!.quantity), 'liquidation');
  if (Object.values(run.positions).every((p) => amount(p.quantity) === 0n)) {
    run.status = 'stopped';
    run.reason = null;
  } else {
    run.status = 'blocked';
    run.reason ??= '清仓未完成，等待下一份有效报价';
  }
}
function rebalance(run: Run, targets = run.parameters.weights, scheduled = true) {
  if (scheduled) {
    if (run.clock < run.nextDecisionAt) return;
    run.nextDecisionAt = run.clock + run.parameters.intervalMs;
  }
  if (!valuationsFresh(run)) {
    run.reason = '组合估值不完整，暂停新增交易';
    return;
  }
  const nav = equity(run);
  const intents: { id: string; side: 'buy' | 'sell'; quantity: bigint }[] = [];
  for (const id of Object.keys(run.parameters.weights).sort()) {
    const weight = targets[id] ?? 0;
    const q = run.quotes[id];
    if (!fresh(run, q)) {
      run.reason = '报价缺失、过期或交易场所不可用';
      continue;
    }
    const current = (amount(run.positions[id]?.quantity ?? '0') * amount(q.bid)) / SCALE;
    const difference = (nav * BigInt(weight)) / BPS - current;
    const magnitude = difference < 0n ? -difference : difference;
    if (magnitude * BPS < nav * BigInt(run.parameters.deviationBps) || magnitude === 0n) continue;
    const side = difference > 0n ? 'buy' : 'sell';
    intents.push({ id, side, quantity: (magnitude * SCALE) / amount(side === 'buy' ? q.ask : q.bid) });
  }
  for (const side of ['sell', 'buy'] as const)
    for (const intent of intents.filter((i) => i.side === side)) {
      trade(run, intent.id, side, intent.quantity, 'rebalance');
      limits(run);
      if (run.trigger) {
        liquidate(run);
        return;
      }
    }
}
function changeUnits(run: Run, cash: bigint, direction: 'in' | 'out') {
  const nav = equity(run);
  if (nav === 0n && run.unitsNumerator === '0' && direction === 'in') {
    run.unitsNumerator = (cash * BigInt(run.emptyUnitValue.denominator)).toString();
    run.unitsDenominator = run.emptyUnitValue.numerator;
    return;
  }
  requireThat(nav > 0n && (direction === 'in' || cash <= nav), 'FUNDING_NAV');
  if (direction === 'out' && cash === nav) {
    run.emptyUnitValue = {
      numerator: (nav * BigInt(run.unitsDenominator)).toString(),
      denominator: run.unitsNumerator,
    };
    run.unitsNumerator = '0';
    run.unitsDenominator = '1';
    return;
  }
  let n = BigInt(run.unitsNumerator) * (direction === 'in' ? nav + cash : nav - cash);
  let d = BigInt(run.unitsDenominator) * nav;
  let a = n,
    b = d;
  while (b) [a, b] = [b, a % b];
  n /= a;
  d /= a;
  requireThat(n.toString().length <= 4096 && d.toString().length <= 4096, 'UNIT_PRECISION_LIMIT');
  run.unitsNumerator = n.toString();
  run.unitsDenominator = d.toString();
}
// The Vault's full-settlement policy can release realized excess, including after stop.
// Adjust units exactly as a withdrawal so this bookkeeping cannot change performance.
export function releaseSettlementExcess(previous: Run, excess: bigint): Run {
  requireThat(excess >= 0n && excess <= amount(previous.cash), 'INVALID_AMOUNT');
  requireThat(
    Object.values(previous.positions).every((p) => amount(p.quantity) === 0n),
    'INVALID_STATUS',
  );
  if (excess === 0n) return previous;
  const run = structuredClone(previous);
  changeUnits(run, excess, 'out');
  run.cash = (amount(run.cash) - excess).toString();
  run.netContributed = (BigInt(run.netContributed) - excess).toString();
  run.history.push({
    at: run.clock,
    equity: run.cash,
    returnBps: returnBps(run),
    status: run.status,
    reason: '全额结算后超额度现金归还闲置余额',
  });
  return run;
}
export function transition(previous: Run, action: Action): Run {
  if (action.type === 'frame' && action.frame.seq === previous.cursor) {
    requireThat(JSON.stringify(action.frame) === previous.lastFrame, 'FRAME_CONFLICT');
    return previous;
  }
  if (previous.status === 'stopped' && (action.type === 'stop' || action.type === 'frame')) return previous;
  const run = structuredClone(previous);
  run.reason = null;
  if (action.type === 'frame') {
    validateFrame(run, action.frame);
    run.cursor = action.frame.seq;
    run.clock = action.frame.at;
    run.lastFrame = JSON.stringify(action.frame);
    for (const q of action.frame.quotes) {
      if (run.quotes[q.assetId]?.observedAt !== q.observedAt) run.usedCapacity[q.assetId] = '0';
      run.quotes[q.assetId] = structuredClone(q);
    }
    limits(run);
    if (run.trigger) liquidate(run);
    else if (run.status === 'running' && run.parameters.strategyMode !== 'external') rebalance(run);
  } else if (action.type === 'decision') {
    requireThat(!run.trigger && run.status === 'running', 'INVALID_STATUS');
    requireThat(run.parameters.strategyMode === 'external', 'STRATEGY_MODE');
    requireThat(
      Number.isSafeInteger(action.frameSeq) && action.frameSeq > 0 && action.frameSeq === run.cursor,
      'STRATEGY_FRAME',
    );
    requireThat(typeof action.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(action.id), 'INVALID_ID');
    validateTargets(action.targets, Object.keys(run.parameters.weights));
    requireThat(valuationsFresh(run), 'STALE_VALUATION');
    const before = run.trades.length;
    limits(run);
    if (run.trigger) liquidate(run);
    else rebalance(run, action.targets, false);
    run.lastDecision = {
      id: action.id,
      frameSeq: action.frameSeq,
      at: run.clock,
      targets: structuredClone(action.targets),
      trades: run.trades.length - before,
    };
  } else if (action.type === 'stop') {
    trigger(run, 'manual');
    liquidate(run);
  } else if (action.type === 'pause' || action.type === 'resume') {
    requireThat(!run.trigger && ['running', 'paused'].includes(run.status), 'INVALID_STATUS');
    run.status = action.type === 'pause' ? 'paused' : 'running';
  } else if (action.type === 'fund') {
    requireThat(!run.trigger && ['running', 'paused'].includes(run.status), 'INVALID_STATUS');
    requireThat(valuationsFresh(run), 'STALE_VALUATION');
    const cash = amount(action.amount);
    requireThat(cash > 0n, 'INVALID_AMOUNT');
    requireThat(action.direction === 'in' || action.direction === 'out', 'INVALID_DIRECTION');
    if (action.direction === 'out') requireThat(cash <= amount(run.cash), 'INSUFFICIENT_BOT_CASH');
    changeUnits(run, cash, action.direction);
    const delta = action.direction === 'in' ? cash : -cash;
    run.cash = (amount(run.cash) + delta).toString();
    run.netContributed = (BigInt(run.netContributed) + delta).toString();
  } else throw new Error('INVALID_ACTION');
  requireThat(run.trades.length <= 2000 && run.history.length < 2000, 'RUN_HISTORY_LIMIT');
  amount(run.cash);
  const cost = Object.values(run.positions).reduce((n, p) => n + amount(p.cost), 0n);
  requireThat(
    amount(run.cash) + cost === BigInt(run.netContributed) + BigInt(run.realizedPnl),
    'RUN_CONSERVATION',
  );
  run.history.push({
    at: run.clock,
    equity: equity(run).toString(),
    returnBps: returnBps(run),
    status: run.status,
    reason: run.reason,
  });
  return run;
}
