export const MAX_INTEGER = (1n << 256n) - 1n;
export const TEST_CASH = Object.freeze({ id: 'TEST_ONLY_USDT_UNIT', decimals: 6 });

export function unsigned(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(value))
    throw new Error('NON_CANONICAL_AMOUNT');
  const result = BigInt(value);
  if (result > MAX_INTEGER) throw new Error('AMOUNT_OVERFLOW');
  return result;
}

export function signed(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|-?[1-9]\d{0,77})$/.test(value))
    throw new Error('NON_CANONICAL_AMOUNT');
  const result = BigInt(value);
  if (result > MAX_INTEGER || result < -MAX_INTEGER) throw new Error('AMOUNT_OVERFLOW');
  return result;
}

export function parseUnits(value: string, decimals: number): string {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('INVALID_PRECISION');
  if (typeof value !== 'string' || value.length > 115 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new Error('INVALID_DECIMAL');
  const [whole = '', fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('EXCESS_PRECISION');
  const result = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  return unsigned(result.toString()).toString();
}

export function formatUnits(value: string, decimals: number): string {
  const amount = unsigned(value);
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('INVALID_PRECISION');
  if (decimals === 0) return amount.toString();
  const padded = amount.toString().padStart(decimals + 1, '0');
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}
