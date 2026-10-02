import type { ReadonlyRpc } from '../../../packages/chain-adapter/src/rpc.ts';
import type { DeploymentManifest } from '../../../packages/chain-adapter/src/manifest.ts';
import { asAddress, asBlockHash, asHexData } from '../../../packages/chain-adapter/src/types.ts';
import { captureReferenceBatch, type BatchPolicy } from '../../../packages/market-data/src/batch.ts';
import type { ReadTransport } from '../../../packages/market-data/src/capture.ts';
import { BatchJournal } from '../../../packages/market-data/src/batch-journal.ts';
import {
  createReferenceEngine,
  advanceReferenceEngine,
  type ReferenceTerms,
} from '../../../packages/testnet/src/reference-engine.ts';
import { OrderJournal, type OrderIntent } from '../../../packages/testnet/src/order-journal.ts';
import type { ExecutorConfig } from '../../../packages/testnet/src/execution-config.ts';
import type { TradingInventory } from '../../../packages/testnet/src/trading-inventory.ts';
import { readTradingSnapshot, type TradingSnapshot } from '../../../packages/testnet/src/trading-reader.ts';
import {
  evidenceHash,
  riskNeedsLiquidation,
  type TradeRequest,
} from '../../../packages/testnet/src/executor-plan.ts';
import { prepareExecutorOrder } from '../../../packages/testnet/src/executor-prepare.ts';
import { feedInterface, tradingInterface } from '../../../packages/testnet/src/trading-abi.ts';
import {
  submitRestrictedIntent,
  type RestrictedSigner,
  type RestrictedTransport,
} from '../../../packages/testnet/src/restricted-submission.ts';

export interface ExecutorDeployment {
  readonly id: string;
  readonly manifest: DeploymentManifest;
  readonly inventory: TradingInventory;
}
export interface ExecutorServiceOptions {
  readonly config: ExecutorConfig;
  readonly terms: readonly ReferenceTerms[];
  readonly rpc: ReadonlyRpc;
  readonly deployments: readonly ExecutorDeployment[];
  readonly orders: OrderJournal;
  readonly batches: BatchJournal;
  readonly now?: () => number;
  readonly captureTransport?: ReadTransport;
  readonly canWrite: () => boolean;
  readonly reviewValid: () => boolean;
  /** Absent means read/prepare only. No inferred signing authority. */
  readonly submission?: {
    readonly transport: RestrictedTransport;
    readonly executor: RestrictedSigner;
    readonly keeper: RestrictedSigner;
  };
  readonly reconcile: () => Promise<void>;
}
/** Pure structural admission runs before private storage or any key unlock. */
export function qualifyExecutorDeployments(
  options: Pick<ExecutorServiceOptions, 'config' | 'terms' | 'deployments'>,
) {
  createReferenceEngine(options.terms);
  if (
    options.deployments.length !== options.config.vaults.length ||
    options.deployments.some(
      (d) =>
        d.inventory.owner === options.config.executor ||
        d.inventory.owner === options.config.keeper ||
        d.inventory.stocks.some(
          (stock, i) =>
            stock.keeper !== options.config.keeper ||
            stock.referenceIdentity !== evidenceHash(options.terms[i]),
        ),
    )
  )
    throw new Error('EXECUTOR_DEPLOYMENT_IDENTITY');
  if (
    options.deployments.some(
      (d) =>
        JSON.stringify(d.inventory.stocks) !== JSON.stringify(options.deployments[0]!.inventory.stocks) ||
        d.inventory.usdc !== options.deployments[0]!.inventory.usdc ||
        d.inventory.factory !== options.deployments[0]!.inventory.factory ||
        d.inventory.router !== options.deployments[0]!.inventory.router,
    )
  )
    throw new Error('EXECUTOR_SHARED_VENUE_IDENTITY');
  if (
    options.deployments.some(
      (d) =>
        !options.config.vaults.some(
          (b) =>
            b.id === d.id &&
            b.vaultAddress === d.manifest.contractAddress &&
            b.manifestDigest === d.manifest.manifestDigest,
        ),
    )
  )
    throw new Error('EXECUTOR_DEPLOYMENT_IDENTITY');
}
/** One serialized private loop; no HTTP interface, owner funds controls or automatic nonce recovery. */
export class TestnetExecutorService {
  readonly options: ExecutorServiceOptions;
  readonly policy: BatchPolicy;
  engine;
  status = 'NOT_STARTED';
  candidate: OrderIntent | null = null;
  #tail: Promise<void> = Promise.resolve();
  #closed = false;
  #cursor = 0;
  #feedTarget:
    readonly { identity: string; priceUsdc: string; observedAt: string; sourceDigest: string }[] | null =
    null;
  constructor(options: ExecutorServiceOptions) {
    this.options = options;
    this.engine = createReferenceEngine(options.terms);
    this.policy = {
      selections: options.terms.map((t) => {
        const [chainId, contractAddress] = t.identity.split(':');
        return {
          chainId: Number(chainId) as 4663 | 46630,
          contractAddress: contractAddress!,
          symbol: t.symbol,
        };
      }),
      maxAgeMs: 30000,
      maxQuoteSkewMs: 10000,
      maxCaptureSpanMs: 30000,
    };
    qualifyExecutorDeployments(options);
    for (let entry = options.batches.next(0); entry; entry = options.batches.next(entry.id))
      this.engine = advanceReferenceEngine(this.engine, entry.batch).state;
  }
  async #submit(intent: OrderIntent, validate: () => Promise<void>) {
    if (this.#closed) throw new Error('EXECUTOR_CLOSED');
    this.candidate = intent;
    if (!this.options.submission) {
      this.status = 'PREPARED_SIGNING_DISABLED';
      return;
    }
    if (
      BigInt(this.options.orders.attempts() + 1) * BigInt(this.options.config.gas.maxGasCostWei) >
      BigInt(this.options.config.maxTotalGasCostWei)
    ) {
      this.status = 'PAUSED_GAS_BUDGET';
      return;
    }
    if (!this.options.canWrite() || !this.options.reviewValid())
      throw new Error('EXECUTOR_STORAGE_OR_REVIEW_BLOCKED');
    const signer =
      intent.purpose === 'FEED_UPDATE' ? this.options.submission.keeper : this.options.submission.executor;
    await submitRestrictedIntent(
      this.options.orders,
      intent,
      this.options.config.gas,
      signer,
      this.options.submission.transport,
      async () => {
        if (this.#closed || !this.options.canWrite() || !this.options.reviewValid())
          throw new Error('EXECUTOR_STORAGE_OR_REVIEW_BLOCKED');
        await validate();
      },
    );
    this.status = 'BROADCAST_UNCERTAIN';
  }
  #intent(
    d: ExecutorDeployment,
    s: TradingSnapshot,
    purpose: 'FEED_UPDATE' | 'RISK_CHECK',
    calldata: string,
    sourceDigest: string,
    feed?: string,
  ): OrderIntent {
    const basis = {
      purpose,
      ...(feed ? { feed } : {}),
      chainId: 46630,
      owner: d.inventory.owner,
      executor: purpose === 'FEED_UPDATE' ? this.options.config.keeper : this.options.config.executor,
      vault: d.manifest.contractAddress,
      manifestDigest: d.manifest.manifestDigest,
      sourceDigest,
      grantVersion: s.grantVersion,
      stateVersion: s.stateVersion,
      snapshotHash: evidenceHash(s),
      calldata,
      createdAt: this.options.now?.() ?? Date.now(),
    };
    return { id: evidenceHash(basis).slice(2), ...basis };
  }
  async #tick() {
    if (this.#closed) throw new Error('EXECUTOR_CLOSED');
    this.candidate = null;
    if (!this.options.canWrite()) {
      this.status = 'PAUSED_STORAGE';
      return;
    }
    if (!this.options.reviewValid()) {
      this.status = 'PAUSED_REFERENCE_REVIEW';
      return;
    }
    await this.options.reconcile();
    const now = this.options.now ?? Date.now;
    const batch = await captureReferenceBatch(this.policy, this.options.captureTransport, now);
    if (this.#closed || !this.options.canWrite()) {
      this.status = 'PAUSED_STORAGE';
      return;
    }
    this.options.batches.append(batch);
    const next = advanceReferenceEngine(this.engine, batch);
    this.engine = next.state;
    if (this.engine.paused) {
      this.status = 'PAUSED_TERMS_CHANGED';
      return;
    }
    if (!next.quotes || !next.sourceDigest) {
      this.status = 'PAUSED_REFERENCE_DATA';
      return;
    }
    if (
      this.options.orders.blocked(this.options.config.executor) ||
      this.options.orders.blocked(this.options.config.keeper)
    ) {
      this.status = 'PAUSED_UNCERTAIN_SUBMISSION';
      return;
    }
    const views = await Promise.all(
      this.options.deployments.map(async (d) => ({
        d,
        s: await readTradingSnapshot(this.options.rpc, d.manifest, d.inventory),
      })),
    );
    const first = views.find((v) => !v.s.closed);
    if (!first) {
      this.status = 'NO_ACTIVE_VAULT';
      return;
    }
    // Complete one archived reference batch before publishing another. Otherwise five-second
    // captures could continuously preempt the strategy and leave mixed timestamps on the feeds.
    const sharedSource = first.s.stocks[0]!.sourceDigest;
    const knownSource = this.options.batches.database
      .prepare('SELECT 1 FROM reference_batches WHERE sha256=? LIMIT 1')
      .get(sharedSource.slice(2));
    if (
      this.#feedTarget &&
      this.#feedTarget.some((q) => BigInt(first.s.blockTimestamp) - BigInt(q.observedAt) > 30n)
    )
      this.#feedTarget = null;
    if (
      !this.#feedTarget &&
      (!knownSource || first.s.stocks.some((s) => !s.priceValid || s.sourceDigest !== sharedSource))
    )
      this.#feedTarget = next.quotes;
    const needed = this.#feedTarget
      ? first.s.stocks
          .map((stock, i) => ({ stock, index: i, quote: this.#feedTarget![i]! }))
          .filter(
            (v) =>
              v.stock.sourceDigest !== v.quote.sourceDigest ||
              v.stock.priceUsdc !== v.quote.priceUsdc ||
              v.stock.observedAt !== v.quote.observedAt,
          )
      : [];
    if (
      needed.some(
        (v) =>
          BigInt(v.quote.observedAt) <= BigInt(v.stock.observedAt) ||
          BigInt(v.quote.observedAt) > BigInt(first.s.blockTimestamp),
      )
    ) {
      this.#feedTarget = null;
      this.status = 'PAUSED_REFERENCE_NEEDS_NEW_SAMPLE';
      return;
    }
    if (needed.length) {
      const { stock, quote } = needed[0]!,
        calldata = feedInterface.encodeFunctionData('update', [
          quote.priceUsdc,
          quote.observedAt,
          quote.sourceDigest,
        ]);
      await this.#submit(
        this.#intent(first.d, first.s, 'FEED_UPDATE', calldata, quote.sourceDigest, stock.feed),
        async () => {
          const fresh = await readTradingSnapshot(this.options.rpc, first.d.manifest, first.d.inventory);
          const current = fresh.stocks.find((s) => s.feed === stock.feed)!;
          if (
            BigInt(current.observedAt) >= BigInt(quote.observedAt) ||
            BigInt(quote.observedAt) > BigInt(fresh.blockTimestamp) ||
            BigInt(fresh.blockTimestamp) - BigInt(quote.observedAt) > 30n
          )
            throw new Error('EXECUTOR_REFERENCE_CHANGED');
          await this.options.rpc.call(
            {
              from: asAddress(this.options.config.keeper),
              to: asAddress(stock.feed),
              data: asHexData(calldata),
            },
            { blockHash: asBlockHash(fresh.blockHash), requireCanonical: true },
          );
        },
      );
      return;
    }
    this.#feedTarget = null;
    let expired = false;
    for (let offset = 0; offset < views.length; offset++) {
      const { d, s } = views[(this.#cursor + offset) % views.length]!;
      if (s.closed || s.grant.executor !== this.options.config.executor) continue;
      if (riskNeedsLiquidation(s) && !s.liquidating) {
        const calldata = tradingInterface.encodeFunctionData('checkRisk');
        await this.#submit(this.#intent(d, s, 'RISK_CHECK', calldata, sharedSource), async () => {
          const fresh = await readTradingSnapshot(this.options.rpc, d.manifest, d.inventory);
          if (
            fresh.stateVersion !== s.stateVersion ||
            fresh.grantVersion !== s.grantVersion ||
            fresh.grant.executor !== this.options.config.executor
          )
            throw new Error('EXECUTOR_STATE_CHANGED');
          await this.options.rpc.call(
            {
              from: asAddress(this.options.config.executor),
              to: asAddress(s.vault),
              data: asHexData(calldata),
            },
            { blockHash: asBlockHash(fresh.blockHash), requireCanonical: true },
          );
        });
        return;
      }
      const liquidate = riskNeedsLiquidation(s);
      const authorizedUntil = s.liquidating
        ? BigInt(s.liquidationUntil)
        : BigInt(s.grant.expiresAt) + (liquidate ? BigInt(s.grant.liquidationWindow) : 0n);
      if (BigInt(s.blockTimestamp) >= authorizedUntil) {
        expired = true;
        continue;
      }
      for (let i = 0; i < 3; i++) {
        const stock = s.stocks[i]!;
        if (!stock.priceValid) continue;
        const signal = liquidate ? 'SELL' : this.engine.signals[i];
        if (
          signal === 'WARMUP' ||
          (!liquidate && (this.engine.lastMinute === null || now() - this.engine.lastMinute > 90000))
        )
          continue;
        const position = BigInt(stock.position),
          price = BigInt(stock.priceUsdc),
          maxOrder = BigInt(s.grant.maxOrderUsdc);
        let amount: bigint;
        if (signal === 'SELL')
          amount = position < (maxOrder * 10n ** 18n) / price ? position : (maxOrder * 10n ** 18n) / price;
        else {
          if (s.runtimeEquity === null) continue;
          const budgets = [
            BigInt(s.runtimeEquity) / 3n - (position * price) / 10n ** 18n,
            BigInt(s.runtimeCash),
            maxOrder,
            BigInt(s.grant.maxTotalBuyUsdc) - BigInt(s.totalBuyUsdc),
          ];
          amount = budgets.reduce((a, b) => (a < b ? a : b));
          if (amount < BigInt(this.options.config.minOrderUsdc)) continue;
        }
        if (amount <= 0n || (signal === 'SELL' && (amount * price) / 10n ** 18n === 0n)) continue;
        const last = s.liquidating
          ? BigInt(s.liquidationUntil)
          : BigInt(s.grant.expiresAt) +
            (BigInt(s.blockTimestamp) >= BigInt(s.grant.expiresAt) ? BigInt(s.grant.liquidationWindow) : 0n);
        const deadline = BigInt(s.blockTimestamp) + BigInt(this.options.config.deadlineSeconds);
        if (last < BigInt(s.blockTimestamp)) {
          this.status = 'PAUSED_AUTHORIZATION_EXPIRED';
          continue;
        }
        const request: TradeRequest = {
          stockIndex: i,
          side: signal === 'BUY' ? 'BUY' : 'SELL',
          amountIn: String(amount),
          deadline: String(deadline < last ? deadline : last),
          sourceDigest: sharedSource,
          createdAt: now(),
          executor: this.options.config.executor,
        };
        const plan = await prepareExecutorOrder(this.options.rpc, d.manifest, d.inventory, request);
        if (!plan.intent) {
          this.status = plan.state;
          this.#cursor = (this.#cursor + offset + 1) % views.length;
          return;
        }
        await this.#submit(plan.intent, async () => {
          const checked = await prepareExecutorOrder(this.options.rpc, d.manifest, d.inventory, {
            ...request,
            createdAt: now(),
          });
          if (
            !checked.intent ||
            checked.intent.calldata !== plan.intent!.calldata ||
            checked.intent.grantVersion !== plan.intent!.grantVersion ||
            checked.snapshot.stocks[i]!.sourceDigest !== plan.snapshot.stocks[i]!.sourceDigest
          )
            throw new Error('EXECUTOR_STATE_CHANGED');
        });
        this.#cursor = (this.#cursor + offset + 1) % views.length;
        return;
      }
    }
    this.status = expired
      ? 'PAUSED_AUTHORIZATION_EXPIRED'
      : this.engine.signals.includes('WARMUP')
        ? 'WARMUP'
        : 'NO_ACTION';
  }
  tick() {
    const next = this.#tail.then(() => this.#tick());
    this.#tail = next.catch(() => {
      this.status = 'PAUSED_EXECUTOR_ERROR';
    });
    return next;
  }
  async close() {
    this.#closed = true;
    await this.#tail;
  }
}
