/** Decimal text only. No floating-point amounts or silently discarded fractional units. */
export function decimalRaw(value: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) || value.length > 100) throw new Error('AMOUNT_INVALID');
  const [integer, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('AMOUNT_PRECISION');
  const raw = BigInt(integer!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (raw >= 2n ** 256n) throw new Error('AMOUNT_INVALID');
  return String(raw);
}
export function formAction(
  fields: Readonly<Record<string, string>>,
  unitNav: string | null,
): Record<string, unknown> {
  const kind = fields.kind,
    required = (key: string) => {
      const value = fields[key];
      if (!value) throw new Error('ACTION_FIELD_REQUIRED');
      return value;
    };
  const integer = (key: string) => {
    const value = required(key);
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('ACTION_FIELD_INVALID');
    return value;
  };
  if (['DEPOSIT', 'WITHDRAW', 'ALLOCATE', 'DEALLOCATE', 'APPROVE_PASS', 'APPROVE_USDC'].includes(kind ?? ''))
    return { kind, amountUsdc: decimalRaw(required('amount'), 6) };
  if (['STOP', 'REVOKE', 'CLOSE', 'RESCUE_NATIVE'].includes(kind ?? '')) return { kind };
  if (kind === 'RESCUE_TOKEN') return { kind, token: required('token') };
  if (kind === 'RECOVERY_SELL')
    return {
      kind,
      stock: required('stock'),
      amountRaw: decimalRaw(required('amount'), 18),
      minAmountOut: decimalRaw(required('minimum'), 6),
      deadline: integer('deadline'),
    };
  if (kind === 'AUTHORIZE')
    return {
      kind,
      executor: required('executor'),
      expiresAt: integer('expiresAt'),
      liquidationWindow: integer('liquidationWindow'),
      maxOrderUsdc: decimalRaw(required('maxOrder'), 6),
      maxTotalBuyUsdc: decimalRaw(required('maxTotal'), 6),
      maxSlippageBps: integer('maxSlippageBps'),
    };
  if (kind === 'BOUNDS') {
    const lower = fields.lower ?? '',
      upper = fields.upper ?? '';
    let low: string, high: string;
    if (fields.boundMode === 'PERCENT') {
      if (unitNav === null || BigInt(unitNav) <= 0n) throw new Error('NAV_REQUIRED');
      const loss = lower ? BigInt(decimalRaw(lower, 4)) : 0n,
        gain = upper ? BigInt(decimalRaw(upper, 4)) : 0n;
      if (loss >= 1000000n) throw new Error('LOWER_PERCENT_INVALID');
      low = loss === 0n ? '0' : String((BigInt(unitNav) * (1000000n - loss)) / 1000000n);
      high = gain === 0n ? '0' : String((BigInt(unitNav) * (1000000n + gain) + 999999n) / 1000000n);
    } else if (fields.boundMode === 'ABSOLUTE') {
      low = lower ? decimalRaw(lower, 6) : '0';
      high = upper ? decimalRaw(upper, 6) : '0';
    } else throw new Error('BOUND_MODE_REQUIRED');
    const prices = (prefix: string) =>
      ['MSFT', 'NVDA', 'AAPL'].map((symbol) =>
        fields[prefix + symbol] ? decimalRaw(fields[prefix + symbol]!, 6) : '0',
      );
    return {
      kind,
      lowerUnitNav: low,
      upperUnitNav: high,
      lowerPrices: prices('lower'),
      upperPrices: prices('upper'),
    };
  }
  throw new Error('ACTION_UNSUPPORTED');
}
