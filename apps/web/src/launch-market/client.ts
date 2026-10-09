import { Interface, hexlify, toUtf8Bytes, verifyMessage } from 'ethers';
import { asAddress, asHexData } from '../../../../packages/chain-adapter/src/types.ts';
import { validateManifest, uint } from '../../../../packages/launch-market/src/config.ts';
import { validateQuoteTransaction } from '../../../../packages/launch-market/src/abi.ts';
import type {
  MarketTrackedOperation,
  MarketStreamUpdate,
} from '../../../../packages/launch-market/src/types.ts';
import {
  Eip1193Wallet,
  Eip1193WalletConnection,
  PreparedActionFactory,
  type Eip1193Provider,
} from '../chain-wallet.ts';
import {
  LAUNCH_CHAIN_ID,
  type ChainLocation,
  type LaunchClientState,
  type LaunchConfig,
  type LaunchQuote,
  type LaunchSnapshot,
  type LaunchWallet,
  type QuoteRequest,
} from './model.ts';
import { actionable } from './presentation.ts';

const prefix = '/api/launch-market';
const tokenInterface = new Interface(['function approve(address spender,uint256 amount) returns (bool)']);
const terminalStates = new Set(['COMPLETED', 'REVERTED', 'REJECTED', 'EXPIRED', 'DROPPED']);
const states = new Set([
  'CREATED',
  'QUOTED',
  'AWAITING_WALLET',
  'SUBMITTED',
  'INCLUDED',
  'CONFIRMED_L2',
  'COMPLETED',
  'EXPIRED',
  'REJECTED',
  'REVERTED',
  'DROPPED',
  'REORGED',
  'RECOVERY_REQUIRED',
]);
export type LaunchApi = <T>(path: string, body?: unknown) => Promise<T>;
export class MarketApiError extends Error {
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.status = status;
  }
}

/** The existing website session supplies CSRF; no browser email is an authentication assertion. */
export function createLaunchApi(fetcher: typeof fetch = fetch): LaunchApi {
  let csrf: string | null = null;
  return async <T>(path: string, body?: unknown): Promise<T> => {
    if (body !== undefined && !csrf) {
      const auth = await fetcher('/auth/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!auth.ok) throw new MarketApiError('VERIFIED_ACCOUNT_REQUIRED', auth.status);
      const session = (await auth.json()) as { csrfToken?: unknown };
      if (
        typeof session.csrfToken !== 'string' ||
        session.csrfToken.length < 16 ||
        session.csrfToken.length > 256
      )
        throw new MarketApiError('ACCOUNT_SESSION_INVALID', 401);
      csrf = session.csrfToken;
    }
    const response = await fetcher(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': csrf! },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) csrf = null;
      const result = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
      const code =
        typeof result?.code === 'string'
          ? result.code
          : typeof result?.error === 'string'
            ? result.error
            : 'MARKET_API_UNAVAILABLE';
      throw new MarketApiError(code, response.status);
    }
    return response.json() as Promise<T>;
  };
}

export function validLocation(location: ChainLocation): void {
  if (
    !location ||
    location.chainId !== LAUNCH_CHAIN_ID ||
    !/^0x[0-9a-fA-F]{64}$/.test(location.blockHash) ||
    (location.transactionHash !== null && !/^0x[0-9a-fA-F]{64}$/.test(location.transactionHash)) ||
    (location.logIndex !== null && (!Number.isSafeInteger(location.logIndex) || location.logIndex < 0)) ||
    !Number.isSafeInteger(location.confirmations) ||
    location.confirmations < 0
  )
    throw new Error('INVALID_CHAIN_EVIDENCE');
  uint(location.blockNumber);
  uint(location.version);
}

/** Same-height conflicting hashes require explicit reorg recovery. Older messages never replace a newer read. */
export function newerLocation(next: ChainLocation, previous: ChainLocation | null): boolean {
  validLocation(next);
  if (!previous) return true;
  if (BigInt(next.blockNumber) < BigInt(previous.blockNumber)) return false;
  if (
    next.blockNumber === previous.blockNumber &&
    next.blockHash.toLowerCase() !== previous.blockHash.toLowerCase()
  )
    return false;
  return BigInt(next.version) >= BigInt(previous.version);
}

function validateSnapshot(snapshot: LaunchSnapshot): void {
  validLocation(snapshot.location);
  for (const id of ['TSLA', 'AMZN'] as const) {
    const market = snapshot.markets[id];
    if (!market || !['PREPARING', 'MINTING', 'SOLD_OUT', 'LAUNCHED'].includes(market.state))
      throw new Error('INVALID_MARKET_SNAPSHOT');
    for (const raw of [
      market.totalSupplyRaw,
      market.publicSupplyRaw,
      market.soldRaw,
      market.remainingRaw,
      market.mintPriceUsdcRaw,
      market.lpPassRaw,
      market.lpUsdcRaw,
      market.reservePassRaw,
      market.reserveUsdcRaw,
    ])
      uint(raw);
    if (uint(market.soldRaw) + uint(market.remainingRaw) !== uint(market.publicSupplyRaw))
      throw new Error('INVALID_MINT_INVENTORY');
    if (
      market.state === 'LAUNCHED' &&
      (!market.pool || uint(market.reservePassRaw) === 0n || uint(market.reserveUsdcRaw) === 0n)
    )
      throw new Error('INVALID_LAUNCH_EVIDENCE');
  }
  if (
    snapshot.claim.maxClaims !== 100 ||
    !Number.isSafeInteger(snapshot.claim.successfulClaims) ||
    !Number.isSafeInteger(snapshot.claim.remainingClaims) ||
    snapshot.claim.successfulClaims < 0 ||
    snapshot.claim.remainingClaims < 0 ||
    snapshot.claim.remainingClaims + snapshot.claim.successfulClaims !== 100
  )
    throw new Error('INVALID_CLAIM_INVENTORY');
  uint(snapshot.claim.amountUsdcRaw);
  uint(snapshot.conversion.ethReserveRaw);
  uint(snapshot.conversion.usdcReserveRaw);
}

function validateWallet(wallet: LaunchWallet, owner: string): void {
  validLocation(wallet.location);
  if (asAddress(wallet.owner).toLowerCase() !== owner.toLowerCase())
    throw new Error('WALLET_IDENTITY_CHANGED');
  uint(wallet.ethBalanceRaw);
  uint(wallet.usdcBalanceRaw);
  for (const id of ['TSLA', 'AMZN'] as const) {
    const pass = wallet.passes[id];
    if (!pass || uint(pass.availableRaw) + uint(pass.lockedRaw) !== uint(pass.balanceRaw))
      throw new Error('INVALID_PASS_BALANCE');
  }
  if (!Array.isArray(wallet.vaults)) throw new Error('INVALID_VAULT_SNAPSHOT');
}

const idleTransaction = () => ({
  id: null,
  hash: null,
  state: 'IDLE' as const,
  confirmations: 0,
  approval: false,
  owner: null,
});
export class LaunchMarketClient {
  readonly #api: LaunchApi;
  readonly #provider: Eip1193Provider | undefined;
  readonly #connection: Eip1193WalletConnection | undefined;
  readonly #now: () => number;
  readonly #origin: string;
  readonly #listeners = new Set<(state: LaunchClientState) => void>();
  #generation = 0;
  #pendingRegistration: { quote: LaunchQuote; hash: string } | null = null;
  #refreshing = false;
  #state: LaunchClientState = {
    enabled: false,
    config: null,
    snapshot: null,
    wallet: null,
    owner: null,
    connecting: false,
    busy: false,
    quote: null,
    quoteRequest: null,
    transaction: idleTransaction(),
    error: null,
    notice: null,
  };

  constructor(
    options: { api?: LaunchApi; provider?: Eip1193Provider; now?: () => number; origin?: string } = {},
  ) {
    this.#api = options.api ?? createLaunchApi();
    this.#provider = options.provider;
    this.#connection = options.provider
      ? new Eip1193WalletConnection(options.provider, LAUNCH_CHAIN_ID)
      : undefined;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.#origin = options.origin ?? globalThis.location?.origin ?? 'http://127.0.0.1:4180';
    if (options.provider)
      for (const event of ['accountsChanged', 'chainChanged', 'disconnect'] as const)
        options.provider.on(event, () => this.invalidateWallet());
  }

  get state(): LaunchClientState {
    return structuredClone(this.#state);
  }
  subscribe(listener: (state: LaunchClientState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }
  #update(patch: Partial<LaunchClientState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.state);
  }
  setError(error: unknown): void {
    const code = error instanceof Error ? error.message : 'MARKET_REQUEST_FAILED';
    const messages: Record<string, string> = {
      WALLET_REJECTED: 'Wallet confirmation cancelled. No transaction was submitted.',
      WALLET_WRONG_CHAIN: 'Switch your wallet to Robinhood Chain Testnet.',
      WALLET_IDENTITY_CHANGED: 'Your wallet changed. Reconnect and review a new quote.',
      WALLET_SIMULATION_FAILED: 'The contract simulation failed. Refresh chain state and review a new quote.',
      VERIFIED_ACCOUNT_REQUIRED: 'Sign in with your verified Google account to continue.',
      TRUSTED_EMAIL_REQUIRED: 'Sign in with your verified Google account to continue.',
      LINKED_WALLET_REQUIRED: 'Link the connected wallet to your verified account before continuing.',
      ALREADY_CLAIMED: 'This verified account has already claimed its AF-USDC.',
      CLAIM_LIMIT_REACHED: 'All 100 claims have been allocated.',
      INSUFFICIENT_CONVERSION_RESERVE: 'This ETH conversion path has insufficient liquidity. Choose AF-USDC.',
      QUOTE_REQUEST_MISMATCH: 'The quote does not match your reviewed request. Request a new quote.',
      QUOTE_TRANSACTION_MISMATCH: 'The contract transaction does not match the quote. Request a new quote.',
      MARKET_ACTION_UNAVAILABLE:
        'This action is currently unavailable. Check the wallet, reserves and market state.',
    };
    // Read failures cannot release the lock held by an outstanding wallet confirmation.
    this.#update({ error: messages[code] ?? code });
  }
  invalidateWallet(): void {
    ++this.#generation;
    const tx = this.#state.transaction;
    this.#update({
      owner: null,
      wallet: null,
      quote: null,
      quoteRequest: null,
      connecting: false,
      transaction: tx.hash && !terminalStates.has(tx.state) ? { ...tx, state: 'RECOVERY_REQUIRED' } : tx,
      notice:
        'Wallet or network changed. Reconnect to read your assets; existing assets stay with their original wallet.',
    });
  }
  clearQuote(): void {
    this.#update({ quote: null, quoteRequest: null });
  }

  async initialize(): Promise<boolean> {
    try {
      const config = await this.#api<LaunchConfig>(`${prefix}/config`);
      if (config.mode !== 'ONCHAIN_TESTNET') return false;
      if (
        config.chainId !== LAUNCH_CHAIN_ID ||
        config.confirmations !== 3 ||
        (config.deployment === 'CONFIGURED') !== (config.manifest !== null)
      )
        throw new Error('INVALID_MARKET_CONFIGURATION');
      if (config.manifest) validateManifest(config.manifest);
      this.#update({ enabled: true, config });
      if (config.deployment === 'CONFIGURED') await this.refresh();
      return true;
    } catch (error) {
      if (error instanceof MarketApiError && error.status === 404) return false;
      this.setError(error);
      return this.#state.enabled;
    }
  }

  async #assertOwner(owner: string, generation = this.#generation): Promise<void> {
    const session = await this.#connection?.observe();
    if (generation !== this.#generation || !session || session.account.toLowerCase() !== owner.toLowerCase())
      throw new Error('WALLET_IDENTITY_CHANGED');
    if (session.chainId !== LAUNCH_CHAIN_ID) throw new Error('WALLET_WRONG_CHAIN');
  }

  async connect(): Promise<void> {
    if (!this.#connection) throw new Error('Open this page in a browser wallet to continue.');
    if (this.#state.busy) throw new Error('TRANSACTION_ALREADY_PENDING');
    const generation = ++this.#generation;
    this.#update({ connecting: true, error: null, quote: null, quoteRequest: null });
    try {
      const session = await this.#connection.connect();
      if (generation !== this.#generation) throw new Error('WALLET_IDENTITY_CHANGED');
      this.#update({ owner: session.account, connecting: false, notice: null });
      await this.refresh();
    } catch (error) {
      this.#update({ owner: null, wallet: null, connecting: false });
      throw error;
    }
  }

  /** Explicit, separately reviewed account linkage; this signature cannot authorize any asset transfer. */
  async bindWallet(): Promise<void> {
    const owner = this.#state.owner;
    if (!owner || !this.#provider) throw new Error('WALLET_CONNECTION_REQUIRED');
    if (this.#state.busy) throw new Error('TRANSACTION_ALREADY_PENDING');
    this.#update({ busy: true, error: null });
    const generation = this.#generation;
    try {
      await this.#assertOwner(owner, generation);
      const challenge = await this.#api<{ nonce: string; message: string; expiresAt: number }>(
        `${prefix}/wallet/challenge`,
        { owner },
      );
      const account = /Link this wallet to AlphaForge account ([a-f0-9-]{36})\./.exec(challenge.message)?.[1];
      const issued = /^Issued At: (.+)$/m.exec(challenge.message)?.[1];
      const issuedAt = issued ? Date.parse(issued) / 1000 : NaN;
      const expected = `${new URL(this.#origin).host} wants you to link your Ethereum account:\n${owner.toLowerCase()}\n\nLink this wallet to AlphaForge account ${account}. This signature authorizes account linkage only. It does not move assets or authorize transactions.\n\nURI: ${this.#origin}\nVersion: 1\nChain ID: ${LAUNCH_CHAIN_ID}\nNonce: ${challenge.nonce}\nIssued At: ${issued}\nExpiration Time: ${new Date(challenge.expiresAt * 1000).toISOString()}`;
      if (
        !account ||
        !/^[a-f0-9]{48}$/.test(challenge.nonce) ||
        challenge.message.length > 2048 ||
        challenge.message !== expected ||
        !Number.isSafeInteger(challenge.expiresAt) ||
        challenge.expiresAt <= this.#now() ||
        challenge.expiresAt - this.#now() > 300 ||
        !Number.isSafeInteger(issuedAt) ||
        issuedAt > this.#now() ||
        issuedAt < this.#now() - 300
      )
        throw new Error('WALLET_CHALLENGE_INVALID');
      await this.#assertOwner(owner, generation);
      let signature: unknown;
      try {
        signature = await this.#provider.request({
          method: 'personal_sign',
          params: [hexlify(toUtf8Bytes(challenge.message)), owner],
        });
      } catch (error) {
        if ((error as { code?: unknown })?.code === 4001) throw new Error('WALLET_REJECTED', { cause: error });
        throw error;
      }
      await this.#assertOwner(owner, generation);
      if (
        typeof signature !== 'string' ||
        verifyMessage(challenge.message, signature).toLowerCase() !== owner.toLowerCase()
      )
        throw new Error('WALLET_SIGNATURE_INVALID');
      await this.#api(`${prefix}/wallet/bind`, { nonce: challenge.nonce, signature });
      await this.#assertOwner(owner, generation);
      this.#update({
        busy: false,
        notice: 'Your verified account is linked to this wallet. No assets were transferred.',
      });
      await this.refresh();
    } catch (error) {
      this.#update({ busy: false });
      throw error;
    }
  }

  async refresh(): Promise<void> {
    if (this.#refreshing || this.#state.config?.deployment !== 'CONFIGURED') return;
    this.#refreshing = true;
    const generation = this.#generation;
    try {
      const snapshot = await this.#api<LaunchSnapshot>(`${prefix}/snapshot`);
      validateSnapshot(snapshot);
      if (newerLocation(snapshot.location, this.#state.snapshot?.location ?? null))
        this.#update({ snapshot });
      const owner = this.#state.owner;
      if (owner) {
        await this.#assertOwner(owner, generation);
        const wallet = await this.#api<LaunchWallet>(`${prefix}/wallet?owner=${encodeURIComponent(owner)}`);
        validateWallet(wallet, owner);
        await this.#assertOwner(owner, generation);
        if (newerLocation(wallet.location, this.#state.wallet?.location ?? null)) this.#update({ wallet });
        if (this.#state.transaction.state === 'IDLE') {
          const recent = await this.#api<{ operations: MarketTrackedOperation[] }>(
            `${prefix}/operations?owner=${encodeURIComponent(owner)}`,
          );
          await this.#assertOwner(owner, generation);
          if (!Array.isArray(recent.operations)) throw new Error('INVALID_TRANSACTION_EVIDENCE');
          const pending = recent.operations.find(
            (operation) =>
              operation.owner.toLowerCase() === owner.toLowerCase() && !terminalStates.has(operation.state),
          );
          if (pending) {
            if (
              !pending.id ||
              !/^0x[0-9a-fA-F]{64}$/.test(pending.transactionHash) ||
              !states.has(pending.state)
            )
              throw new Error('INVALID_TRANSACTION_EVIDENCE');
            this.#update({
              quote: null,
              quoteRequest: null,
              transaction: {
                id: pending.id,
                hash: pending.transactionHash,
                state: 'SUBMITTED',
                confirmations: 0,
                approval: false,
                owner: pending.owner,
              },
              notice:
                'An existing transaction is being recovered from the server. No new transaction was sent.',
            });
          }
        }
      }
      await this.refreshTransaction();
    } finally {
      this.#refreshing = false;
    }
  }

  async review(request: Omit<QuoteRequest, 'owner'>): Promise<void> {
    const owner = this.#state.owner;
    if (!owner || !actionable(this.#state, request.strategyId, request.operation, request.asset))
      throw new Error('MARKET_ACTION_UNAVAILABLE');
    const generation = this.#generation;
    const full: QuoteRequest = { ...request, owner };
    uint(request.amountRaw);
    if (![50, 100, 300].includes(request.slippageBps)) throw new Error('INVALID_SLIPPAGE');
    this.#update({ busy: true, error: null, quote: null, quoteRequest: null });
    try {
      await this.#assertOwner(owner, generation);
      const quote = await this.#api<LaunchQuote>(`${prefix}/quote`, full);
      this.#validateQuote(quote, full);
      await this.#assertOwner(owner, generation);
      this.#update({ busy: false, quote, quoteRequest: full });
    } catch (error) {
      this.#update({ busy: false });
      throw error;
    }
  }

  #validateQuote(quote: LaunchQuote, request: QuoteRequest): void {
    const manifest = this.#state.config?.manifest;
    if (
      !manifest ||
      quote.owner.toLowerCase() !== request.owner.toLowerCase() ||
      quote.operation !== request.operation ||
      quote.asset !== request.asset ||
      quote.strategyId !== request.strategyId ||
      (quote.operation === 'MINT'
        ? quote.estimatedOutRaw !== request.amountRaw
        : quote.operation === 'CLAIM' || quote.operation === 'CLOSE'
          ? request.amountRaw !== '0'
          : quote.amountInRaw !== request.amountRaw) ||
      !Number.isSafeInteger(quote.expiresAt) ||
      quote.expiresAt <= this.#now() ||
      quote.expiresAt - this.#now() > 300 ||
      !Number.isSafeInteger(quote.priceImpactBps) ||
      quote.priceImpactBps < 0 ||
      quote.priceImpactBps > 10000
    )
      throw new Error('QUOTE_REQUEST_MISMATCH');
    validLocation(quote.location);
    for (const value of [
      quote.amountInRaw,
      quote.estimatedOutRaw,
      quote.minOutRaw,
      quote.feeUsdcRaw,
      quote.conversionFeeUsdcRaw,
      quote.transaction.value,
    ])
      uint(value);
    if (quote.simulation === 'READY') {
      if (quote.gasEstimateRaw === null || uint(quote.gasEstimateRaw) === 0n || quote.allowance !== null)
        throw new Error('INVALID_SIMULATION_EVIDENCE');
    } else if (quote.simulation !== 'APPROVAL_REQUIRED' || !quote.allowance || quote.gasEstimateRaw !== null)
      throw new Error('INVALID_SIMULATION_EVIDENCE');
    if (uint(quote.minOutRaw) > uint(quote.estimatedOutRaw)) throw new Error('INVALID_MINIMUM_OUTPUT');
    if (quote.operation === 'BUY' || quote.operation === 'SELL') {
      const bound = (uint(quote.estimatedOutRaw) * BigInt(10000 - request.slippageBps)) / 10000n;
      if (uint(quote.minOutRaw) < bound) throw new Error('QUOTE_SLIPPAGE_MISMATCH');
    }
    validateQuoteTransaction(
      quote,
      manifest,
      this.#state.snapshot ?? undefined,
      this.#state.wallet ?? undefined,
    );
  }

  async confirm(): Promise<void> {
    const quote = this.#state.quote;
    const request = this.#state.quoteRequest;
    if (!quote || !request || !this.#provider || this.#state.busy) throw new Error('QUOTE_REVIEW_REQUIRED');
    this.#validateQuote(quote, request);
    const approval = quote.allowance !== null;
    const transaction = approval
      ? {
          to: quote.allowance!.token,
          data: tokenInterface.encodeFunctionData('approve', [
            quote.allowance!.spender,
            quote.allowance!.amountRaw,
          ]),
          value: '0',
        }
      : quote.transaction;
    const factory = new PreparedActionFactory<LaunchQuote>({
      chainId: LAUNCH_CHAIN_ID,
      target: asAddress(transaction.to),
      operationId: (q) => `launch-${approval ? 'approve-' : ''}${q.id}`,
      encode: () => ({ data: asHexData(transaction.data), value: uint(transaction.value) }),
    });
    const wallet = new Eip1193Wallet(this.#provider, {
      chainId: LAUNCH_CHAIN_ID,
      target: asAddress(transaction.to),
      actionAuthority: factory.authority,
    });
    this.#update({
      busy: true,
      error: null,
      transaction: {
        id: null,
        hash: null,
        state: 'AWAITING_WALLET',
        confirmations: 0,
        approval,
        owner: quote.owner,
      },
    });
    try {
      const submission = await wallet.submit(factory.prepare(quote, asAddress(quote.owner)), () => {
        this.#validateQuote(quote, request);
        if (this.#state.owner?.toLowerCase() !== quote.owner.toLowerCase())
          throw new Error('WALLET_IDENTITY_CHANGED');
      });
      this.#update({
        quote: null,
        quoteRequest: null,
        busy: false,
        transaction: {
          id: null,
          hash: submission.txHash,
          state: submission.state === 'SUBMISSION_AMBIGUOUS' ? 'RECOVERY_REQUIRED' : 'SUBMITTED',
          confirmations: 0,
          approval,
          owner: quote.owner,
        },
      });
      if (!submission.txHash) return;
      if (!approval) {
        this.#pendingRegistration = { quote, hash: submission.txHash };
        await this.#register();
      }
      await this.refreshTransaction();
    } catch (error) {
      if (this.#state.transaction.state === 'AWAITING_WALLET')
        this.#update({ busy: false, transaction: { ...this.#state.transaction, state: 'REJECTED' } });
      else
        this.#update({
          busy: false,
          transaction: { ...this.#state.transaction, state: 'RECOVERY_REQUIRED' },
        });
      throw error;
    }
  }

  async #register(): Promise<void> {
    const pending = this.#pendingRegistration;
    if (!pending) return;
    const result = await this.#api<MarketTrackedOperation>(`${prefix}/submissions`, {
      quoteId: pending.quote.id,
      transactionHash: pending.hash,
      owner: pending.quote.owner,
    });
    if (
      !result.id ||
      result.transactionHash.toLowerCase() !== pending.hash.toLowerCase() ||
      result.owner.toLowerCase() !== pending.quote.owner.toLowerCase()
    )
      throw new Error('TRANSACTION_REGISTRATION_MISMATCH');
    this.#pendingRegistration = null;
    this.#update({ transaction: { ...this.#state.transaction, id: result.id } });
  }

  async refreshTransaction(): Promise<void> {
    if (this.#pendingRegistration) await this.#register();
    const tx = this.#state.transaction;
    if (!tx.hash || terminalStates.has(tx.state)) return;
    if (tx.approval) {
      if (
        !this.#provider ||
        String(await this.#provider.request({ method: 'eth_chainId' })).toLowerCase() !== '0xb626'
      )
        return;
      const receipt = (await this.#provider.request({
        method: 'eth_getTransactionReceipt',
        params: [tx.hash],
      })) as {
        transactionHash: string;
        blockNumber: string;
        blockHash: string;
        status: string;
        from: string;
      } | null;
      if (!receipt) {
        if (tx.confirmations > 0)
          this.#update({ transaction: { ...tx, state: 'REORGED', confirmations: 0 } });
        return;
      }
      if (
        receipt.transactionHash?.toLowerCase() !== tx.hash.toLowerCase() ||
        receipt.from?.toLowerCase() !== tx.owner?.toLowerCase() ||
        !/^0x[0-9a-fA-F]+$/.test(receipt.blockNumber) ||
        !/^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash) ||
        !['0x0', '0x1'].includes(receipt.status)
      )
        throw new Error('INVALID_APPROVAL_RECEIPT');
      const block = (await this.#provider.request({
        method: 'eth_getBlockByNumber',
        params: [receipt.blockNumber, false],
      })) as { hash: string } | null;
      const tip = String(await this.#provider.request({ method: 'eth_blockNumber' }));
      if (
        !block ||
        block.hash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
        !/^0x[0-9a-fA-F]+$/.test(tip)
      ) {
        this.#update({ transaction: { ...tx, state: 'REORGED', confirmations: 0 } });
        return;
      }
      const depth = BigInt(tip) - BigInt(receipt.blockNumber) + 1n;
      const confirmations = depth > 0n ? Number(depth < 3n ? depth : 3n) : 0;
      this.#update({
        transaction: {
          ...tx,
          confirmations,
          state: confirmations >= 3 ? (receipt.status === '0x1' ? 'COMPLETED' : 'REVERTED') : 'INCLUDED',
        },
        ...(confirmations >= 3 && receipt.status === '0x1'
          ? {
              notice:
                'Token approval confirmed. Review a fresh quote to continue; the asset operation has not been sent.',
            }
          : {}),
      });
      return;
    }
    if (!tx.id) return;
    const operation = await this.#api<MarketTrackedOperation>(
      `${prefix}/operations/${encodeURIComponent(tx.id)}`,
    );
    if (
      operation.transactionHash?.toLowerCase() !== tx.hash.toLowerCase() ||
      operation.owner?.toLowerCase() !== tx.owner?.toLowerCase() ||
      !states.has(operation.state) ||
      !Number.isSafeInteger(operation.confirmations) ||
      operation.confirmations < 0
    )
      throw new Error('INVALID_TRANSACTION_EVIDENCE');
    if (operation.location) validLocation(operation.location);
    if (
      ['CONFIRMED_L2', 'COMPLETED'].includes(operation.state) &&
      (!operation.location || operation.confirmations < 3)
    )
      throw new Error('INSUFFICIENT_CONFIRMATION_EVIDENCE');
    this.#update({ transaction: { ...tx, state: operation.state, confirmations: operation.confirmations } });
  }

  async stream(update: MarketStreamUpdate): Promise<void> {
    validLocation(update.location);
    if (update.type === 'REORG') {
      this.#update({
        snapshot: null,
        wallet: null,
        quote: null,
        quoteRequest: null,
        transaction: this.#state.transaction.hash
          ? { ...this.#state.transaction, state: 'REORGED', confirmations: 0 }
          : this.#state.transaction,
        notice: 'Chain reorganization detected. Reading authoritative state again.',
      });
      await this.refresh();
      return;
    }
    if (update.type === 'SNAPSHOT' && update.snapshot) {
      validateSnapshot(update.snapshot);
      if (newerLocation(update.snapshot.location, this.#state.snapshot?.location ?? null))
        this.#update({ snapshot: update.snapshot });
    }
    if (update.type === 'OPERATION') await this.refreshTransaction();
  }
}
