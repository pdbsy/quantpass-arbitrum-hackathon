import { Interface } from 'ethers';
import { marketInterfaces } from '../../packages/launch-market/src/abi.ts';
import type {
  MarketConfiguration,
  MarketQuote,
  MarketSnapshot,
  MarketTrackedOperation,
  MarketWalletSnapshot,
  QuoteRequest,
} from '../../packages/launch-market/src/types.ts';
import type { Eip1193Provider, Eip1193Request } from '../../apps/web/src/chain-wallet.ts';
import { MarketApiError, type LaunchApi } from '../../apps/web/src/launch-market/client.ts';
import type { LaunchConfig, LaunchAccount } from '../../apps/web/src/launch-market/model.ts';
export const OWNER = '0x1111111111111111111111111111111111111111';
export const OTHER = '0x2222222222222222222222222222222222222222';
export const HASH = `0x${'aa'.repeat(32)}`;
export const BLOCK = `0x${'bb'.repeat(32)}`;
export const NOW = 1_792_000_000;
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const P = 10n ** 18n;
export const location = (number = 100, version = number) => ({
  chainId: 46630,
  blockNumber: String(number),
  blockHash: BLOCK,
  transactionHash: null,
  logIndex: null,
  version: String(version),
  confirmations: 3,
});
export function config(): MarketConfiguration {
  const manifest = {
    schemaVersion: 1 as const,
    chainId: 46630,
    deploymentBlock: '1',
    usdc: addr(1),
    claim: addr(2),
    conversionReserve: addr(3),
    router: addr(4),
    poolFactory: addr(5),
    vaultFactory: addr(6),
    strategies: {
      TSLA: { pass: addr(7), launch: addr(8), pool: null, lpRecipient: addr(9) },
      AMZN: { pass: addr(10), launch: null, pool: addr(11), lpRecipient: addr(9) },
    },
    runtimeCodeHashes: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 10, 11].map((n) => [addr(n), BLOCK])),
  };
  return { mode: 'ONCHAIN_TESTNET', deployment: 'CONFIGURED', chainId: 46630, confirmations: 3, manifest };
}
export function snapshot(): MarketSnapshot {
  const common = {
    pass: addr(7),
    totalSupplyRaw: String(1_000_000n * P),
    publicSupplyRaw: String(500_000n * P),
    soldRaw: String(499_999n * P),
    remainingRaw: String(P),
    mintPriceUsdcRaw: '500000',
    lpPassRaw: String(500_000n * P),
    lpUsdcRaw: '250000000000',
    pool: null,
    reservePassRaw: '0',
    reserveUsdcRaw: '0',
    ammFeeBps: 30,
  };
  return {
    location: location(),
    markets: {
      TSLA: { ...common, state: 'MINTING' },
      AMZN: {
        ...common,
        state: 'LAUNCHED',
        pass: addr(10),
        publicSupplyRaw: '0',
        soldRaw: '0',
        remainingRaw: '0',
        pool: addr(11),
        reservePassRaw: String(500_000n * P),
        reserveUsdcRaw: '250000000000',
      },
    },
    claim: {
      amountUsdcRaw: '1000000000',
      successfulClaims: 0,
      maxClaims: 100,
      remainingClaims: 100,
      funded: true,
    },
    conversion: {
      ethReserveRaw: String(100n * P),
      usdcReserveRaw: '1000000000000',
      ethBuyAvailable: true,
      ethSellAvailable: true,
      feeBps: 30,
      epoch: '1',
    },
  };
}
export function wallet(): MarketWalletSnapshot {
  const pass = { balanceRaw: String(1000n * P), lockedRaw: '0', availableRaw: String(1000n * P) };
  return {
    owner: OWNER,
    accountId: 'verified-account',
    location: location(),
    ethBalanceRaw: String(10n * P),
    usdcBalanceRaw: '1000000000',
    passes: { TSLA: pass, AMZN: pass },
    vaults: [],
  };
}
export function account(): LaunchAccount {
  return {
    id: 'verified-account',
    accountKey: HASH,
    wallet: OWNER,
    emailVerified: true,
    claimStatus: 'ELIGIBLE',
  };
}
export function quote(request: QuoteRequest): MarketQuote {
  const cfg = config().manifest!;
  const deadline = NOW + 60;
  const output = request.operation === 'MINT' ? request.amountRaw : String(19n * P);
  const minOut = String((BigInt(output) * 9950n) / 10000n);
  let transaction;
  if (request.operation === 'MINT')
    transaction = {
      to: cfg.strategies.TSLA.launch!,
      data: marketInterfaces.launch.encodeFunctionData('subscribeUsdc', [request.amountRaw, deadline]),
      value: '0',
    };
  else if (request.asset === 'AF_USDC')
    transaction = {
      to: cfg.strategies.AMZN.pool!,
      data: marketInterfaces.pool.encodeFunctionData(request.operation === 'SELL' ? 'sell' : 'buy', [
        request.amountRaw,
        minOut,
        request.owner,
        deadline,
      ]),
      value: '0',
    };
  else {
    const q = {
      router: cfg.router,
      payer: request.owner,
      accountId: HASH,
      operation: 1,
      pass: cfg.strategies.AMZN.pass,
      amountIn: request.amountRaw,
      usdcAmount: '20000000',
      minOut,
      ethAmount: request.amountRaw,
      ethUsdPrice: '2000000000',
      nonce: '1',
      issuedAt: NOW,
      deadline,
      epoch: '1',
    };
    transaction = {
      to: cfg.router,
      data: marketInterfaces.router.encodeFunctionData('buyNative', [q, '0x']),
      value: request.amountRaw,
    };
  }
  return {
    id: 'quote_a',
    owner: request.owner,
    strategyId: request.strategyId,
    operation: request.operation,
    asset: request.asset,
    amountInRaw: request.amountRaw,
    estimatedOutRaw: output,
    minOutRaw: minOut,
    feeUsdcRaw: '30000',
    conversionFeeUsdcRaw: '0',
    priceImpactBps: 10,
    expiresAt: deadline,
    reference: request.asset === 'ETH' ? { ethUsdPriceRaw: '2000000000', observedAt: NOW } : null,
    transaction,
    allowance: null,
    gasEstimateRaw: '250000',
    simulation: 'READY',
    location: location(),
  };
}
export class ProviderFixture implements Eip1193Provider {
  readonly calls: Eip1193Request[] = [];
  readonly listeners = new Map<string, Set<(value: unknown) => void>>();
  owner = OWNER;
  chainId = '0xb626';
  sendError: unknown = null;
  sendResult: unknown = HASH;
  sendResponse: Promise<unknown> | null = null;
  readonly sendStarted = Promise.withResolvers<void>();
  receipt: unknown = null;
  tip = '0x66';
  async request(input: Eip1193Request): Promise<unknown> {
    this.calls.push(input);
    if (input.method === 'eth_accounts' || input.method === 'eth_requestAccounts') return [this.owner];
    if (input.method === 'eth_chainId') return this.chainId;
    if (input.method === 'eth_call') return '0x';
    if (input.method === 'eth_sendTransaction') {
      this.sendStarted.resolve();
      if (this.sendError) throw this.sendError;
      if (this.sendResponse) return this.sendResponse;
      return this.sendResult;
    }
    if (input.method === 'eth_getTransactionReceipt') return this.receipt;
    if (input.method === 'eth_getBlockByNumber') return { hash: BLOCK };
    if (input.method === 'eth_blockNumber') return this.tip;
    throw new Error(`Unexpected wallet method ${input.method}`);
  }
  on(event: string, listener: (value: unknown) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }
  removeListener(event: string, listener: (value: unknown) => void) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string, value: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}
export function fixture() {
  const provider = new ProviderFixture();
  const state = {
    config: config() as LaunchConfig,
    snapshot: snapshot(),
    wallet: wallet(),
    account: account() as LaunchAccount | null,
    quote: null as MarketQuote | null,
    operation: {
      id: 'operation_a',
      quoteId: 'quote_a',
      owner: OWNER,
      transactionHash: HASH,
      state: 'SUBMITTED',
      confirmations: 0,
      location: null,
      error: null,
    } as MarketTrackedOperation,
    registrationError: false,
    operations: [] as MarketTrackedOperation[],
    requests: [] as { path: string; body?: unknown }[],
  };
  const api: LaunchApi = async <T>(path: string, body?: unknown): Promise<T> => {
    state.requests.push({ path, ...(body === undefined ? {} : { body }) });
    let result: unknown;
    if (path.endsWith('/config')) result = state.config;
    else if (path.endsWith('/account')) {
      if (!state.account) throw new MarketApiError('VERIFIED_EMAIL_REQUIRED', 401);
      result = state.account;
    } else if (path.endsWith('/snapshot')) result = state.snapshot;
    else if (path.includes('/wallet?')) result = state.wallet;
    else if (path.includes('/operations?')) result = { operations: state.operations };
    else if (path.endsWith('/quote')) result = state.quote ?? quote(body as QuoteRequest);
    else if (path.endsWith('/submissions')) {
      if (state.registrationError) throw new Error('SYNC_UNAVAILABLE');
      result = state.operation;
    } else if (path.includes('/operations/')) result = state.operation;
    else throw new Error(`Unexpected API ${path}`);
    return structuredClone(result) as T;
  };
  return {
    provider,
    state,
    api,
    tokenInterface: new Interface(['function approve(address spender,uint256 amount) returns(bool)']),
  };
}
