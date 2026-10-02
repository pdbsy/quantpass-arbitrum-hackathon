import { createHash } from 'node:crypto';
import { walletAddress } from './wallet-auth.ts';

export interface TestStockIdentity {
  readonly symbol: 'MSFT' | 'NVDA' | 'AAPL';
  readonly token: string;
  readonly feed: string;
  readonly pool: string;
  readonly referenceIdentity: string;
  readonly keeper: string;
}
export interface TradingInventory {
  readonly schemaVersion: 1;
  readonly chainId: 46630;
  readonly kind: 'TEST_SUBSTITUTES';
  readonly deploymentManifestDigest: string;
  readonly owner: string;
  readonly passLocker: string;
  readonly usdc: string;
  readonly router: string;
  readonly quoter: string;
  readonly factory: string;
  readonly maxPriceAge: number;
  readonly stocks: readonly TestStockIdentity[];
  readonly codeHashes: readonly Readonly<{ address: string; hash: string }>[];
}
const hash = (v: unknown): string => {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(v) || /^0x0+$/.test(v)) throw new Error();
  return v.toLowerCase();
};
const object = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw new Error();
  return v as Record<string, unknown>;
};
export function validateTradingInventory(
  input: unknown,
  expectedDigest: string,
  manifestDigest: string,
): TradingInventory {
  try {
    if ('0x' + createHash('sha256').update(JSON.stringify(input)).digest('hex') !== hash(expectedDigest))
      throw new Error();
    const v = object(input, [
      'schemaVersion',
      'chainId',
      'kind',
      'deploymentManifestDigest',
      'owner',
      'passLocker',
      'usdc',
      'router',
      'quoter',
      'factory',
      'maxPriceAge',
      'stocks',
      'codeHashes',
    ]);
    if (
      v.schemaVersion !== 1 ||
      v.chainId !== 46630 ||
      v.kind !== 'TEST_SUBSTITUTES' ||
      hash(v.deploymentManifestDigest) !== hash(manifestDigest) ||
      typeof v.maxPriceAge !== 'number' ||
      !Number.isSafeInteger(v.maxPriceAge) ||
      v.maxPriceAge < 1 ||
      v.maxPriceAge > 4294967295 ||
      !Array.isArray(v.stocks) ||
      v.stocks.length !== 3 ||
      !Array.isArray(v.codeHashes)
    )
      throw new Error();
    const address = (key: string) => walletAddress(String(v[key]));
    const passLocker = address('passLocker'),
      usdc = address('usdc'),
      router = address('router'),
      quoter = address('quoter'),
      factory = address('factory');
    const identities = [passLocker, usdc, router, quoter, factory];
    const symbols = ['MSFT', 'NVDA', 'AAPL'] as const;
    const stocks = v.stocks.map((raw, index): TestStockIdentity => {
      const s = object(raw, ['symbol', 'token', 'feed', 'pool', 'referenceIdentity', 'keeper']);
      if (s.symbol !== symbols[index]) throw new Error();
      const token = walletAddress(String(s.token)),
        feed = walletAddress(String(s.feed)),
        pool = walletAddress(String(s.pool));
      identities.push(token, feed, pool);
      return Object.freeze({
        symbol: s.symbol as TestStockIdentity['symbol'],
        token,
        feed,
        pool,
        referenceIdentity: hash(s.referenceIdentity),
        keeper: walletAddress(String(s.keeper)),
      });
    });
    if (new Set(identities).size !== identities.length || v.codeHashes.length !== identities.length)
      throw new Error();
    const seen = new Set<string>();
    const codeHashes = v.codeHashes.map((raw) => {
      const c = object(raw, ['address', 'hash']),
        address = walletAddress(String(c.address));
      if (!identities.includes(address) || seen.has(address)) throw new Error();
      seen.add(address);
      return Object.freeze({ address, hash: hash(c.hash) });
    });
    return Object.freeze({
      schemaVersion: 1,
      chainId: 46630,
      kind: 'TEST_SUBSTITUTES',
      deploymentManifestDigest: hash(manifestDigest),
      owner: address('owner'),
      passLocker,
      usdc,
      router,
      quoter,
      factory,
      maxPriceAge: v.maxPriceAge,
      stocks: Object.freeze(stocks),
      codeHashes: Object.freeze(codeHashes),
    });
  } catch {
    throw new Error('TRADING_INVENTORY_REJECTED');
  }
}
