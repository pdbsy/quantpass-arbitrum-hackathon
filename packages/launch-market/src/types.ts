export type StrategyId = 'TSLA' | 'AMZN';
export type SettlementAsset = 'ETH' | 'AF_USDC';
export type MarketOperation =
  'MINT' | 'BUY' | 'SELL' | 'CLAIM' | 'CREATE_VAULT' | 'DEPOSIT' | 'WITHDRAW' | 'CLOSE';
export type LaunchState = 'PREPARING' | 'MINTING' | 'SOLD_OUT' | 'LAUNCHED';
export type OperationState =
  | 'CREATED'
  | 'QUOTED'
  | 'AWAITING_WALLET'
  | 'SUBMITTED'
  | 'INCLUDED'
  | 'CONFIRMED_L2'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'REJECTED'
  | 'REVERTED'
  | 'DROPPED'
  | 'REORGED'
  | 'RECOVERY_REQUIRED';

/** All amounts are integer base units: PASS 18, AF-USDC 6, native ETH 18. */
export interface ChainLocation {
  readonly chainId: number;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly transactionHash: string | null;
  readonly logIndex: number | null;
  readonly version: string;
  readonly confirmations: number;
}
export interface LaunchMarketManifest {
  readonly schemaVersion: 1;
  readonly chainId: number;
  readonly deploymentBlock: string;
  readonly usdc: string;
  readonly claim: string;
  readonly conversionReserve: string;
  readonly router: string;
  readonly poolFactory: string;
  readonly vaultFactory: string | null;
  readonly strategies: Readonly<
    Record<
      StrategyId,
      {
        readonly pass: string;
        readonly launch: string | null;
        readonly pool: string | null;
        readonly lpRecipient: string;
      }
    >
  >;
  /** Runtime hashes are required before enabling a real reader. */
  readonly runtimeCodeHashes: Readonly<Record<string, string>>;
}
export interface MarketConfiguration {
  readonly mode: 'ONCHAIN_TESTNET';
  readonly deployment: 'NOT_DEPLOYED' | 'CONFIGURED';
  readonly chainId: number;
  readonly confirmations: 3;
  readonly manifest: LaunchMarketManifest | null;
}
export interface StrategyMarketSnapshot {
  readonly state: LaunchState;
  readonly pass: string;
  readonly totalSupplyRaw: string;
  readonly publicSupplyRaw: string;
  readonly soldRaw: string;
  readonly remainingRaw: string;
  readonly mintPriceUsdcRaw: string;
  readonly lpPassRaw: string;
  readonly lpUsdcRaw: string;
  readonly pool: string | null;
  readonly reservePassRaw: string;
  readonly reserveUsdcRaw: string;
  readonly ammFeeBps: number;
}
export interface MarketSnapshot {
  readonly location: ChainLocation;
  readonly markets: Readonly<Record<StrategyId, StrategyMarketSnapshot>>;
  readonly claim: {
    readonly amountUsdcRaw: string;
    readonly successfulClaims: number;
    readonly maxClaims: 100;
    readonly remainingClaims: number;
    readonly funded: boolean;
  };
  readonly conversion: {
    readonly ethReserveRaw: string;
    readonly usdcReserveRaw: string;
    readonly ethBuyAvailable: boolean;
    readonly ethSellAvailable: boolean;
    readonly ethMintAvailable?: boolean;
    readonly feeBps: number;
    readonly epoch: string;
  };
}
export interface VaultSnapshot {
  readonly strategyId: StrategyId;
  readonly address: string;
  readonly principalBasisRaw: string;
  readonly equityRaw: string | null;
  readonly cashRaw: string;
  readonly lockedPassRaw: string;
  readonly realizedPnlRaw: string;
  readonly unrealizedPnlRaw: string | null;
  readonly valuationState: 'FRESH' | 'UNAVAILABLE';
  readonly withdrawableProfitRaw: string;
  readonly withdrawablePrincipalRaw: string;
  readonly status: 'OPEN' | 'CLOSED';
  readonly holdings: readonly { readonly token: string; readonly amountRaw: string }[];
}
export interface MarketWalletSnapshot {
  readonly owner: string;
  readonly accountId: string | null;
  readonly location: ChainLocation;
  readonly ethBalanceRaw: string;
  readonly usdcBalanceRaw: string;
  readonly passes: Readonly<
    Record<
      StrategyId,
      {
        readonly balanceRaw: string;
        readonly lockedRaw: string;
        readonly availableRaw: string;
      }
    >
  >;
  readonly vaults: readonly VaultSnapshot[];
}
export interface QuoteRequest {
  readonly owner: string;
  readonly strategyId: StrategyId;
  readonly operation: MarketOperation;
  readonly asset: SettlementAsset;
  readonly amountRaw: string;
  readonly slippageBps: number;
}
export interface MarketTransaction {
  readonly to: string;
  readonly data: string;
  readonly value: string;
}
export interface MarketQuote {
  readonly id: string;
  readonly owner: string;
  readonly strategyId: StrategyId;
  readonly operation: MarketOperation;
  readonly asset: SettlementAsset;
  readonly amountInRaw: string;
  readonly estimatedOutRaw: string;
  readonly minOutRaw: string;
  readonly feeUsdcRaw: string;
  readonly conversionFeeUsdcRaw: string;
  readonly priceImpactBps: number;
  readonly expiresAt: number;
  readonly reference: { readonly ethUsdPriceRaw: string; readonly observedAt: number } | null;
  readonly transaction: MarketTransaction;
  readonly allowance: { readonly token: string; readonly spender: string; readonly amountRaw: string } | null;
  readonly gasEstimateRaw: string | null;
  readonly simulation: 'READY' | 'APPROVAL_REQUIRED';
  readonly location: ChainLocation;
}
export interface MarketTrackedOperation {
  readonly id: string;
  readonly quoteId: string;
  readonly owner: string;
  readonly transactionHash: string;
  readonly state: OperationState;
  readonly confirmations: number;
  readonly location: ChainLocation | null;
  readonly error: string | null;
}
export interface MarketStreamUpdate {
  readonly type: 'SNAPSHOT' | 'REORG' | 'OPERATION';
  readonly location: ChainLocation;
  readonly snapshot?: MarketSnapshot;
  readonly operation?: MarketTrackedOperation;
}
/** Issued only by a trusted server authentication adapter. Never deserialize this from request JSON. */
export interface TrustedEmailIdentity {
  readonly email: string;
  readonly subject: string;
  readonly emailVerified: true;
}
export interface MarketAccount {
  readonly id: string;
  readonly accountKey: string;
  readonly email: string;
  readonly wallet: string | null;
}
export class LaunchMarketError extends Error {
  readonly code: string;
  readonly status: number;
  readonly statusCode: number;
  constructor(code: string, status = 409) {
    super(code);
    this.name = 'LaunchMarketError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
  }
}
