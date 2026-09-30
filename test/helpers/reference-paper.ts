import type { ReadTransport } from '../../packages/market-data/src/capture.ts';
import { captureReferenceBatch } from '../../packages/market-data/src/batch.ts';
export const symbols = ['MSFT', 'NVDA', 'AAPL'];
export const assets = symbols.map((symbol, i) => ({
  id: '0x' + String(i + 1).repeat(64),
  tokenSymbol: symbol,
  tokenDecimals: 18,
  status: 'ASSET_STATUS_ACTIVE',
  currentMultiplier: '1',
  pendingMultiplier: '',
  deployments: [{ chainId: 4663, contractAddress: '0x' + String(i + 1).repeat(40) }],
}));
export function fixtureConfig() {
  return {
    version: 'alphaforge-reference-paper-1',
    mode: 'REFERENCE_PAPER',
    market: {
      selections: assets.map((a) => ({
        chainId: 4663,
        contractAddress: a.deployments[0]!.contractAddress,
        symbol: a.tokenSymbol,
      })),
      maxAgeMs: 30000,
      maxQuoteSkewMs: 10000,
      maxCaptureSpanMs: 30000,
    },
    minuteCloseMaxAgeMs: 30000,
    gapPolicy: 'retain',
    feeBps: 30,
    slippageBps: 10,
    initialCash6: '1000000000',
    limits: { mode: 'off' },
  };
}
export function fixtureTransport(
  at: () => number,
  options: { halted?: boolean; denied?: boolean; price?: string } = {},
): ReadTransport {
  return async (url) => {
    if (options.denied) return new Response('', { status: 403 });
    if (url.endsWith('/assets')) return new Response(JSON.stringify({ assets }));
    const a = assets.find((a) => url.endsWith('/' + a.tokenSymbol))!;
    return new Response(
      JSON.stringify({
        quotes: [
          {
            tokenSymbol: a.tokenSymbol,
            deployments: a.deployments,
            bid: options.price ?? '100',
            ask: options.price ?? '100',
            currency: 'USD',
            isTradingHalt: options.halted ?? false,
            generatedAt: new Date(at()).toISOString(),
          },
        ],
      }),
    );
  };
}
export function fixtureBatch(at: number, options: { halted?: boolean; price?: string } = {}) {
  return captureReferenceBatch(
    fixtureConfig().market,
    fixtureTransport(() => at, options),
    () => at,
  );
}
