import { formatUnits } from '../../../packages/domain/src/money.ts';

export interface MockWalletSnapshot {
  readonly address: string;
  readonly ethBalance?: string;
  readonly ethValueUsdc?: string;
  readonly usdcBalance?: string;
  readonly holdings?: readonly {
    readonly id: string;
    readonly name: string;
    readonly quantity: number;
    readonly allocatedUsdc?: string;
    readonly frozenPass?: string;
    readonly availablePass?: string;
  }[];
}
const storageKey = 'alphaforge.mock-wallet.v1';
// A display identifier only. There is no private key, provider or chain authority.
const address = '0x000000000000000000000000000000000000de00';
// Fixed by the user for this local demonstration, not a live market quote.
export const MOCK_ETH_USDC_RATE = 2688;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const formatMockUsdc = (value: number): string =>
  formatUnits(String(value), 6)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');

/** An explicit local presentation of the existing simulated exchange ledger. */
export function createMockWalletSession(
  readExchange: () => unknown,
  strategies: readonly { readonly id: string; readonly name: string }[],
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
) {
  let connected = false;
  try {
    connected = storage?.getItem(storageKey) === 'connected';
  } catch {
    /* Session-only mode. */
  }
  return {
    connect() {
      connected = true;
      try {
        storage?.setItem(storageKey, 'connected');
      } catch {
        /* Keep the in-memory choice. */
      }
    },
    disconnect() {
      connected = false;
      try {
        storage?.removeItem(storageKey);
      } catch {
        /* Keep the in-memory choice. */
      }
    },
    snapshot(): MockWalletSnapshot | undefined {
      if (!connected) return undefined;
      try {
        const ledger = readExchange();
        if (!record(ledger) || !amount(ledger.cash) || !record(ledger.positions)) return { address };
        const funding = record(ledger.funding) ? ledger.funding : undefined;
        if (
          ledger.funding !== undefined &&
          (!funding || funding.asset !== 'USDC' || !amount(funding.cash) || !record(funding.allocations))
        )
          return { address };
        const holdings: {
          id: string;
          name: string;
          quantity: number;
          allocatedUsdc?: string;
          frozenPass?: string;
          availablePass?: string;
        }[] = [];
        for (const strategy of strategies) {
          const position = ledger.positions[strategy.id];
          if (!Object.hasOwn(ledger.positions, strategy.id) || !record(position) || !amount(position.qty))
            return { address };
          const allocated =
            funding && record(funding.allocations) ? funding.allocations[strategy.id] : undefined;
          if (funding && (!amount(allocated) || allocated > position.qty * 1000000)) return { address };
          if (position.qty > 0)
            holdings.push({
              id: strategy.id,
              name: strategy.name,
              quantity: position.qty,
              ...(!amount(allocated)
                ? {}
                : {
                    allocatedUsdc: formatMockUsdc(allocated),
                    frozenPass: formatMockUsdc(allocated),
                    availablePass: formatMockUsdc(position.qty * 1000000 - allocated),
                  }),
            });
        }
        return {
          address,
          ethBalance: formatUnits(String(ledger.cash), 2),
          ethValueUsdc: formatUnits(String(BigInt(ledger.cash) * BigInt(MOCK_ETH_USDC_RATE)), 2),
          ...(funding && amount(funding.cash) ? { usdcBalance: formatMockUsdc(funding.cash) } : {}),
          holdings,
        };
      } catch {
        return { address };
      }
    },
  };
}
