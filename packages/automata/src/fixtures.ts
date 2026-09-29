import type { Frame } from './model.ts';

export const DATASETS = Object.freeze([
  { id: 'ema-cycle', title: 'EMA 合成周期', description: '先横盘、后上涨再下跌；合成周期，不代表日线。' },
  { id: 'trend', title: '合成上涨行情', description: '100 起步，逐步上涨；用于验证上限清仓。' },
  { id: 'decline', title: '合成下跌行情', description: '100 起步，逐步下跌；用于验证下限清仓。' },
  {
    id: 'liquidity',
    title: '合成流动性受阻',
    description: '第 3–6 帧无成交容量，随后恢复；用于验证清仓恢复。',
  },
]);
export function datasetFrames(id: string): Frame[] {
  if (!DATASETS.some((d) => d.id === id)) throw new Error('UNKNOWN_DATASET');
  return Array.from({ length: 120 }, (_, index) => {
    const seq = index + 1;
    const at = seq * 1000;
    const shift = BigInt(Math.min(index, 60)) * 500000n;
    const price = (
      id === 'ema-cycle'
        ? BigInt(index < 30 ? 100 : index < 60 ? 100 + index - 29 : Math.max(70, 130 - (index - 59) * 2)) *
          1000000n
        : id === 'decline'
          ? 100000000n - shift
          : id === 'trend'
            ? 100000000n + shift
            : 100000000n
    ).toString();
    return {
      seq,
      at,
      quotes: ['rwa-a', 'rwa-b'].map((assetId) => ({
        assetId,
        bid: price,
        ask: price,
        reference: '100000000',
        observedAt: at,
        expiresAt: at + 1000,
        capacity: id === 'liquidity' && seq >= 3 && seq <= 6 ? '0' : '1000000000',
        slippageBps: 0,
        available: true,
      })),
    };
  });
}
