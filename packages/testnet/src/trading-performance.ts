export interface PerformanceEvent {
  readonly eventName: string;
  readonly normalizedData: Readonly<Record<string, unknown>>;
}
const raw = (v: unknown) => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= 2n ** 256n)
    throw new Error('TRADING_PERFORMANCE_INPUT');
  return BigInt(v);
};
/** Recompute from canonical ordered events only. No paper fill or capital transfer creates a return. */
export function tradingPerformance(events: readonly PerformanceEvent[], vaultEquity: string | null) {
  let contributed = 0n,
    paidOut = 0n;
  const positions = new Map<string, { quantity: bigint; cost: bigint; realized: bigint }>();
  for (const event of events) {
    const e = event.normalizedData;
    if (event.eventName === 'Deposited') contributed += raw(e.amountUsdc);
    else if (event.eventName === 'Withdrawn') paidOut += raw(e.amountUsdc);
    else if (event.eventName === 'Closed') paidOut += raw(e.returnedUsdc);
    else if (event.eventName === 'SwapExecuted') {
      if (typeof e.stock !== 'string' || !/^0x[0-9a-f]{40}$/.test(e.stock) || typeof e.buy !== 'boolean')
        throw new Error('TRADING_PERFORMANCE_INPUT');
      const position = positions.get(e.stock) ?? { quantity: 0n, cost: 0n, realized: 0n },
        input = raw(e.input),
        output = raw(e.output);
      if (input === 0n || output === 0n) throw new Error('TRADING_PERFORMANCE_INPUT');
      if (e.buy) {
        position.quantity += output;
        position.cost += input;
      } else {
        if (input > position.quantity) throw new Error('TRADING_PERFORMANCE_NEGATIVE_POSITION');
        const allocatedCost =
          input === position.quantity ? position.cost : (position.cost * input) / position.quantity;
        position.quantity -= input;
        position.cost -= allocatedCost;
        position.realized += output - allocatedCost;
      }
      positions.set(e.stock, position);
    }
  }
  const net = contributed - paidOut;
  return Object.freeze({
    publicationScope: 'OWNER_ONLY_TESTNET' as const,
    testAssets: true,
    publicStrategyPerformance: 'NOT_PUBLISHED' as const,
    grossContributedUsdc: String(contributed),
    paidOutUsdc: String(paidOut),
    netContributedUsdc: String(net),
    vaultEquity,
    pnlUsdc: vaultEquity === null ? null : String(raw(vaultEquity) - net),
    costs: Object.freeze({
      dexFees: 'INCLUDED_IN_FILL_NOT_SEPARATELY_ATTRIBUTED',
      priceImpact: 'INCLUDED_IN_FILL',
      platformGas: 'PAID_BY_EXECUTOR_NOT_DEDUCTED_FROM_VAULT_USDC',
      commercialFees: 'SIMULATION_ONLY',
    }),
    positions: Object.freeze(
      [...positions].map(([stock, p]) =>
        Object.freeze({
          stock,
          quantityRaw: String(p.quantity),
          costBasisUsdc: String(p.cost),
          realizedPnlUsdc: String(p.realized),
        }),
      ),
    ),
  });
}
