import { sameAddress, type Address } from '../../../packages/chain-adapter/src/types.ts';
import type {
  BeforeWalletSend,
  BrowserWalletPort,
  PreparedAction,
  WalletSession,
  WalletSubmission,
} from './chain-wallet.ts';
import type { SimulatingRobinhoodTestnetStrategyAdapter } from './strategy-adapter.ts';

export interface M3ActionReview {
  readonly operationId: string;
  readonly owner: Address;
}

export class M3ActionSimulationFailure extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'M3ActionSimulationFailure';
    this.code = code;
  }
}

export class M3ChainActionFlow<Snapshot, Action, Observation> {
  readonly #adapter: SimulatingRobinhoodTestnetStrategyAdapter<Snapshot, Action, Observation>;
  readonly #wallet: BrowserWalletPort;
  readonly #reviews = new WeakMap<M3ActionReview, PreparedAction>();
  #session: WalletSession | null = null;

  constructor(
    adapter: SimulatingRobinhoodTestnetStrategyAdapter<Snapshot, Action, Observation>,
    wallet: BrowserWalletPort,
  ) {
    this.#adapter = adapter;
    this.#wallet = wallet;
  }

  async connect(
    assertCurrent: () => void = () => {},
  ): Promise<{ readonly session: WalletSession; readonly snapshot: Snapshot }> {
    this.#session = null;
    const session = await this.#wallet.connect();
    assertCurrent();
    const snapshot = await this.#adapter.readSnapshot({ wallet: session.account });
    assertCurrent();
    this.#session = session;
    return Object.freeze({ session, snapshot });
  }

  async #readAndSimulate(prepared: PreparedAction): Promise<Snapshot> {
    const session = this.#session;
    if (!session) throw new Error('WALLET_CONNECTION_REQUIRED');
    if (prepared.chainId !== session.chainId || !sameAddress(prepared.owner, session.account))
      throw new Error('PREPARED_ACTION_SESSION_MISMATCH');
    const snapshot = await this.#adapter.readSnapshot({ wallet: session.account });
    const simulation = await this.#adapter.simulateAction(prepared, {
      owner: session.account,
      snapshot,
    });
    if (!simulation.ok) throw new M3ActionSimulationFailure(simulation.errorCode, simulation.errorMessage);
    return snapshot;
  }

  async review(action: Action): Promise<M3ActionReview> {
    const session = this.#session;
    if (!session) throw new Error('WALLET_CONNECTION_REQUIRED');
    const snapshot = await this.#adapter.readSnapshot({ wallet: session.account });
    const prepared = await this.#adapter.prepareAction(action, { owner: session.account });
    if (prepared.chainId !== session.chainId || !sameAddress(prepared.owner, session.account))
      throw new Error('PREPARED_ACTION_SESSION_MISMATCH');
    const simulation = await this.#adapter.simulateAction(prepared, {
      owner: session.account,
      snapshot,
    });
    if (!simulation.ok) throw new M3ActionSimulationFailure(simulation.errorCode, simulation.errorMessage);
    const review = Object.freeze({ operationId: prepared.operationId, owner: session.account });
    this.#reviews.set(review, prepared);
    return review;
  }

  async confirm(review: M3ActionReview, beforeSend?: BeforeWalletSend): Promise<WalletSubmission> {
    const prepared = this.#reviews.get(review);
    if (!prepared) throw new Error('INVALID_ACTION_REVIEW');
    this.#reviews.delete(review);
    await this.#readAndSimulate(prepared);
    const wallet = beforeSend
      ? Object.freeze({
          connect: () => this.#wallet.connect(),
          submit: (action: PreparedAction) => this.#wallet.submit(action, beforeSend),
        })
      : this.#wallet;
    return this.#adapter.submitAction(prepared, wallet);
  }
}
