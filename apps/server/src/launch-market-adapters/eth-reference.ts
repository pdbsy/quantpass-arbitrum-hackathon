// Public reference prices value test ETH only. This does not promise real-world redemption.
export interface EthReference {
  priceRaw: string;
  observedAt: number;
  fetchedAt: number;
  primaryPriceRaw: string;
  validationPriceRaw: string;
  deviationBps: number;
  sources: readonly string[];
}

const COINBASE = 'https://api.exchange.coinbase.com/products/ETH-USD/ticker';
// Recent trades includes an exchange timestamp; a ticker fetch time is not price age.
const KRAKEN = 'https://api.kraken.com/0/public/Trades?pair=ETHUSD&count=1';

export function priceToRaw(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,18})?$/.test(value))
    throw new Error('INVALID_REFERENCE_PRICE');
  const [whole, fraction = ''] = value.split('.');
  const raw = BigInt(whole!) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
  if (raw <= 0n) throw new Error('INVALID_REFERENCE_PRICE');
  return raw;
}

async function json(fetcher: typeof fetch, url: string): Promise<unknown> {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(3000),
    redirect: 'error',
    headers: { Accept: 'application/json', 'User-Agent': 'AlphaForge-Testnet-Reference/1' },
  });
  if (!response.ok || !response.body) throw new Error('REFERENCE_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 262144) throw new Error('REFERENCE_RESPONSE_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_REFERENCE_RESPONSE');
  return value as Record<string, unknown>;
}

export class VerifiedEthReference {
  #cached: EthReference | undefined;
  #pending: Promise<EthReference> | undefined;
  readonly #fetcher: typeof fetch;
  readonly #now: () => number;
  readonly maxAgeSeconds: number;
  readonly maxDeviationBps: number;

  constructor(
    options: {
      fetcher?: typeof fetch;
      now?: () => number;
      maxAgeSeconds?: number;
      maxDeviationBps?: number;
    } = {},
  ) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.maxAgeSeconds = options.maxAgeSeconds ?? 30;
    this.maxDeviationBps = options.maxDeviationBps ?? 200;
    if (
      !Number.isInteger(this.maxAgeSeconds) ||
      this.maxAgeSeconds < 1 ||
      this.maxAgeSeconds > 60 ||
      !Number.isInteger(this.maxDeviationBps) ||
      this.maxDeviationBps < 0 ||
      this.maxDeviationBps > 500
    )
      throw new Error('INVALID_REFERENCE_POLICY');
  }

  async read(): Promise<EthReference> {
    const now = this.#now();
    if (
      this.#cached &&
      now >= this.#cached.fetchedAt &&
      now - this.#cached.fetchedAt < 5 &&
      now >= this.#cached.observedAt &&
      now - this.#cached.observedAt <= this.maxAgeSeconds
    )
      return this.#cached;
    if (this.#pending) return this.#pending;
    this.#pending = this.#refresh().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async #refresh(): Promise<EthReference> {
    this.#cached = undefined;
    const [coinbaseBody, krakenBody] = await Promise.all([
      json(this.#fetcher, COINBASE),
      json(this.#fetcher, KRAKEN),
    ]);
    const primary = object(coinbaseBody);
    const validation = object(krakenBody);
    if (!Array.isArray(validation.error) || validation.error.length !== 0)
      throw new Error('REFERENCE_UNAVAILABLE');
    const result = object(validation.result);
    const pairs = Object.keys(result).filter((key) => key !== 'last');
    if (pairs.length !== 1 || !['XETHZUSD', 'ETHUSD'].includes(pairs[0]!))
      throw new Error('REFERENCE_PAIR_MISMATCH');
    const trades = result[pairs[0]!];
    if (!Array.isArray(trades) || !Array.isArray(trades.at(-1)))
      throw new Error('INVALID_REFERENCE_RESPONSE');
    const last = trades.at(-1) as unknown[];
    const primaryRaw = priceToRaw(primary.price);
    const validationRaw = priceToRaw(last[0]);
    const primaryAt = typeof primary.time === 'string' ? Math.floor(Date.parse(primary.time) / 1000) : NaN;
    const validationAt = typeof last[2] === 'number' ? Math.floor(last[2]) : NaN;
    const now = this.#now();
    for (const at of [primaryAt, validationAt])
      if (!Number.isSafeInteger(at) || at > now || now - at > this.maxAgeSeconds)
        throw new Error('STALE_REFERENCE_PRICE');
    const difference = primaryRaw > validationRaw ? primaryRaw - validationRaw : validationRaw - primaryRaw;
    // Compare without flooring so 200.001 bps is not admitted as 200 bps.
    if (difference * 10000n > primaryRaw * BigInt(this.maxDeviationBps))
      throw new Error('REFERENCE_PRICE_DEVIATION');
    const reference: EthReference = Object.freeze({
      priceRaw: primaryRaw.toString(),
      observedAt: Math.min(primaryAt, validationAt),
      fetchedAt: now,
      primaryPriceRaw: primaryRaw.toString(),
      validationPriceRaw: validationRaw.toString(),
      deviationBps: Number((difference * 10000n) / primaryRaw),
      sources: Object.freeze([COINBASE, KRAKEN]),
    });
    this.#cached = reference;
    return reference;
  }
}
