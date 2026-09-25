import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

interface MockExchangeState {
  cash: number;
  positions: Record<string, { qty: number; cost: number }>;
  allocations?: Record<string, number>;
  funding: { asset: 'USDC'; cash: number; initialCapital: number; allocations: Record<string, number> };
  legacyEthFunding?: { refunded: number; allocations: Record<string, number> };
}
interface MockExchange {
  read(): MockExchangeState;
  review(input: { strategy: string; side: string; qty: number }): unknown;
  execute(review: unknown): unknown;
  totals(): { equity: number };
  reviewFunding(input: { strategy: string; kind: string; amount: number }, now?: number): unknown;
  executeFunding(review: unknown, now?: number): unknown;
  fundingSnapshot(strategy: string): {
    cash: number;
    allocated: number;
    passQty: number;
    frozen: number;
    available: number;
    maxDeposit: number;
  };
}

/** Execute the actual exchange IIFE with isolated storage and fixed market inputs. */
export function mockExchangeFixture(saved?: string) {
  const source = readFileSync(
    new URL('../../apps/web/prototype/AlphaForge_v3_EN.html', import.meta.url),
    'utf8',
  );
  const marker = source.indexOf('/* Isolated, fictional Pass exchange');
  const start = source.indexOf('(() => {', marker);
  const end = source.indexOf('\n})();', start) + '\n})();'.length;
  if (marker < 0 || start < 0 || end <= start) throw Error('Exchange fixture source unavailable');
  const storage = new Map<string, string>(saved ? [['alphaforge.passmarket.v3', saved]] : []);
  const strategies = [
    { id: 'trend', name: 'Trend' },
    { id: 'factor', name: 'Factor' },
  ];
  const AF = {
    strategies,
    strategy: (id: string) => strategies.find((s) => s.id === id),
    store: { quota: 100000 },
    marketData: {
      fmt: (n: number) => (n / 100).toFixed(2),
      metrics: () => ({ price: 342, liquidity: 18400000 }),
    },
  };
  runInNewContext(source.slice(start, end), {
    AF,
    structuredClone,
    crypto: { randomUUID },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  return {
    exchange: (AF as typeof AF & { exchange: MockExchange }).exchange,
    storage,
  };
}
