const maximumRaw = 2n ** 256n - 1n;
function raw(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= maximumRaw ? amount : null;
}

/** AF-USDC has 6 decimals and PASS has 18. Round their exact ratio to 12 decimals. */
export function formatPoolSpotPrice(reserveUsdcRaw: unknown, reservePassRaw: unknown): string | null {
  const usdc = raw(reserveUsdcRaw);
  const pass = raw(reservePassRaw);
  if (usdc === null || pass === null || usdc <= 0n || pass <= 0n) return null;
  const scaled = (usdc * 10n ** 24n + pass / 2n) / pass;
  const digits = scaled.toString().padStart(13, '0');
  const fraction = digits.slice(-12).replace(/0+$/, '').padEnd(2, '0');
  return `${digits.slice(0, -12)}.${fraction}`;
}
