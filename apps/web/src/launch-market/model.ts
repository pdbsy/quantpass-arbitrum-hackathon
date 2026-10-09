export { LAUNCH_CHAIN_ID } from '../../../../packages/launch-market/src/config.ts';
export type {
  ChainLocation,
  StrategyId,
  SettlementAsset as PaymentAsset,
  MarketOperation,
  MarketConfiguration as LaunchConfig,
  StrategyMarketSnapshot as LaunchMarket,
  MarketSnapshot as LaunchSnapshot,
  MarketWalletSnapshot as LaunchWallet,
  QuoteRequest,
  MarketQuote as LaunchQuote,
} from '../../../../packages/launch-market/src/types.ts';
import type {
  MarketConfiguration,
  MarketSnapshot,
  MarketWalletSnapshot,
  MarketQuote,
  QuoteRequest,
  OperationState,
} from '../../../../packages/launch-market/src/types.ts';

export type TransactionState = OperationState | 'IDLE';
export interface LaunchTransaction {
  readonly id: string | null;
  readonly hash: string | null;
  readonly state: TransactionState;
  readonly confirmations: number;
  readonly approval: boolean;
  readonly owner: string | null;
}
export interface LaunchClientState {
  readonly enabled: boolean;
  readonly config: MarketConfiguration | null;
  readonly snapshot: MarketSnapshot | null;
  readonly wallet: MarketWalletSnapshot | null;
  readonly owner: string | null;
  readonly connecting: boolean;
  readonly busy: boolean;
  readonly quote: MarketQuote | null;
  readonly quoteRequest: QuoteRequest | null;
  readonly transaction: LaunchTransaction;
  readonly error: string | null;
  readonly notice: string | null;
}
