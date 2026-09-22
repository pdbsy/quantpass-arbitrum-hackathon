import {
  M3SubmissionJournal,
  type PendingWalletSubmission,
  type SubmissionStorage,
} from './m3-submission-journal.ts';
import {
  asAddress,
  asBlockHash,
  asHexData,
  sameAddress,
  type Address,
  type BlockHash,
  type HexData,
  type TransactionHash,
} from '../../../packages/chain-adapter/src/types.ts';
import { decodeM3VaultCalldata } from '../../../packages/chain-adapter/src/vault-abi.ts';
import { ROBINHOOD_CHAIN_TESTNET } from '../../../packages/robinhood-chain/src/network.ts';
import {
  Eip1193Wallet,
  Eip1193WalletConnection,
  WalletFailure,
  type BeforeWalletSend,
  type Eip1193Provider,
  type PreparedAction,
  type WalletSession,
  type WalletSubmission,
} from './chain-wallet.ts';
import { M3ChainActionFlow, type M3ActionReview } from './m3-chain-action-flow.ts';
import { keccak256Evm } from './evm-keccak.ts';
import { transactionPresentationFromEvidence, type M3ProductChainPresentation } from './m3-product-shell.ts';
import {
  type M3DepositApprovalKind,
  type M3DepositApprovalReview,
  type M3ProductActionRequest,
  type M3ProductActionReview,
  type M3ProductRuntime,
  type M3PassTransferRequest,
  type M3PassTransferReview,
} from './m3-product-runtime.ts';
import { createM3PassTransferFactory } from './m3-pass-actions.ts';
import { createM3VaultActionFactory } from './m3-vault-actions.ts';
import { readM3VaultDepositAuthorization, type M3DepositAuthorization } from './m3-vault-allowance.ts';
import {
  M3VaultApiClient,
  type M3PassSnapshot,
  type M3RuntimeStatusSnapshot,
  type M3VaultSnapshot,
} from './m3-vault-client.ts';
import { readM3VaultLiveSnapshot } from './m3-vault-live-reader.ts';
import {
  type ProductOperationEvidence,
  type SimulatingRobinhoodTestnetStrategyAdapter,
} from './strategy-adapter.ts';

export interface M3BrowserDeploymentConfig {
  readonly source: 'reviewed-deployment-manifest';
  readonly chainId: 46_630;
  readonly vaultAddress: Address;
  readonly deploymentBlock: string;
  readonly abiVersion: string;
  readonly abiHash: BlockHash;
  readonly manifestDigest: BlockHash;
  readonly runtimeBytecodeHash: BlockHash;
  readonly strategyPassAddress: Address;
  readonly strategyPassDeploymentBlock: string;
  readonly strategyPassAbiHash: BlockHash;
  readonly strategyPassRuntimeBytecodeHash: BlockHash;
  readonly passInitialSupplyBaseUnits?: string;
  readonly passInitialRecipient?: Address;
}

export interface M3VaultReader {
  readRuntimeStatus?(): Promise<M3RuntimeStatusSnapshot>;
  readSnapshot(owner: Address): Promise<M3VaultSnapshot>;
  readPassSnapshot?(owner: Address): Promise<M3PassSnapshot>;
  registerSubmission?(input: {
    readonly operationId: string;
    readonly chainId: 46_630;
    readonly owner: Address;
    readonly target: Address;
    readonly calldata: HexData;
    readonly txHash: TransactionHash;
  }): Promise<unknown>;
  readOperationEvidence?(operationId: string, owner: Address): Promise<ProductOperationEvidence>;
}

export interface M3BrowserRuntimeOptions {
  readonly provider?: Eip1193Provider;
  readonly deployment?: M3BrowserDeploymentConfig;
  readonly vaultReader?: M3VaultReader;
  readonly now?: () => string;
  readonly transportProvenance?: 'DEV_MOCK';
  readonly submissionStorage?: SubmissionStorage;
}

const supportedOpenActions = ['deposit', 'withdraw', 'close'] as const;
const supportedClosedActions = ['rescue-token', 'rescue-native'] as const;
const reviewedVaultAbiVersion = 'm3-vault-db620d6';
const reviewedVaultAbiHash = '0x264b4498cf396008e4619664c59bf8d8eac0a04f04b80e760df3cfbc00846977';
const reviewedStrategyPassAbiHash = '0xdd989644feeb7798baca69f7391ba75b6f9d09f47fb05bd90184f6072912923f';
type RuntimeSnapshot =
  | { readonly source: 'CANONICAL'; readonly value: M3VaultSnapshot }
  | { readonly source: 'LIVE_EXIT'; readonly value: M3VaultSnapshot };

function deploymentAddress(value: unknown): Address {
  try {
    return asAddress(String(value));
  } catch {
    throw new Error('INVALID_M3_DEPLOYMENT_CONFIG');
  }
}

function deploymentHash(value: unknown): BlockHash {
  try {
    return asBlockHash(String(value));
  } catch {
    throw new Error('INVALID_M3_DEPLOYMENT_CONFIG');
  }
}

function operationId(
  kind: M3ProductActionRequest['kind'] | `approve-${M3DepositApprovalKind}` | 'pass-transfer',
): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('M3_OPERATION_ID_UNAVAILABLE');
  const value = `m3-${kind}-${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new Error('INVALID_OPERATION_ID');
  return value;
}

function validDeployment(value: M3BrowserDeploymentConfig | undefined): M3BrowserDeploymentConfig | null {
  if (!value) return null;
  if (
    value.source !== 'reviewed-deployment-manifest' ||
    value.chainId !== ROBINHOOD_CHAIN_TESTNET.chainId ||
    !/^[1-9][0-9]*$/.test(value.deploymentBlock) ||
    !/^[1-9][0-9]*$/.test(value.strategyPassDeploymentBlock) ||
    value.abiVersion !== reviewedVaultAbiVersion
  )
    throw new Error('INVALID_M3_DEPLOYMENT_CONFIG');
  const hasInitialSupply = value.passInitialSupplyBaseUnits !== undefined;
  const hasInitialRecipient = value.passInitialRecipient !== undefined;
  if (hasInitialSupply !== hasInitialRecipient) throw new Error('INVALID_M3_DEPLOYMENT_CONFIG');
  const vaultAddress = deploymentAddress(value.vaultAddress);
  const strategyPassAddress = deploymentAddress(value.strategyPassAddress);
  const abiHash = deploymentHash(value.abiHash);
  const strategyPassAbiHash = deploymentHash(value.strategyPassAbiHash);
  if (
    /^0x0{40}$/i.test(vaultAddress) ||
    /^0x0{40}$/i.test(strategyPassAddress) ||
    sameAddress(vaultAddress, strategyPassAddress)
  )
    throw new Error('INVALID_M3_DEPLOYMENT_CONFIG');
  if (
    abiHash.toLowerCase() !== reviewedVaultAbiHash ||
    strategyPassAbiHash.toLowerCase() !== reviewedStrategyPassAbiHash
  )
    throw new Error('INVALID_M3_DEPLOYMENT_CONFIG');
  let passInitialRecipient: Address | undefined;
  if (hasInitialSupply && hasInitialRecipient) {
    if (
      !/^[1-9][0-9]*$/.test(value.passInitialSupplyBaseUnits!) ||
      BigInt(value.passInitialSupplyBaseUnits!) >= 1n << 256n
    )
      throw new Error('INVALID_M3_DEPLOYMENT_CONFIG');
    passInitialRecipient = deploymentAddress(value.passInitialRecipient!);
    if (/^0x0{40}$/i.test(passInitialRecipient)) throw new Error('INVALID_M3_DEPLOYMENT_CONFIG');
  }
  return Object.freeze({
    ...value,
    vaultAddress,
    manifestDigest: deploymentHash(value.manifestDigest),
    abiHash,
    runtimeBytecodeHash: deploymentHash(value.runtimeBytecodeHash),
    strategyPassAddress,
    strategyPassAbiHash,
    strategyPassRuntimeBytecodeHash: deploymentHash(value.strategyPassRuntimeBytecodeHash),
    ...(passInitialRecipient
      ? {
          passInitialSupplyBaseUnits: value.passInitialSupplyBaseUnits!,
          passInitialRecipient,
        }
      : {}),
  });
}

function initialSnapshot(deployment: M3BrowserDeploymentConfig | null): M3ProductChainPresentation {
  const snapshot: M3ProductChainPresentation = {
    wallet: { status: 'DISCONNECTED' },
    network: { status: 'UNAVAILABLE' },
    transaction: { status: 'IDLE' },
    onchain: deployment
      ? {
          deployment: 'CONFIGURED',
          health: 'UNAVAILABLE',
          readiness: 'UNKNOWN',
          owner: 'UNKNOWN',
          writeMode: 'DISABLED',
          exitPath: 'UNAVAILABLE',
          supportedActions: supportedOpenActions,
          vaultAddress: deployment.vaultAddress,
          passAddress: deployment.strategyPassAddress,
          ...(deployment.passInitialSupplyBaseUnits
            ? {
                passInitialSupplyBaseUnits: deployment.passInitialSupplyBaseUnits,
                passInitialRecipient: deployment.passInitialRecipient!,
              }
            : {}),
        }
      : {
          deployment: 'UNAVAILABLE',
          health: 'UNAVAILABLE',
          readiness: 'UNKNOWN',
          owner: 'UNKNOWN',
          writeMode: 'DISABLED',
          exitPath: 'UNAVAILABLE',
          supportedActions: [],
        },
  };
  return Object.freeze(snapshot);
}

function productAction(request: M3ProductActionRequest, operationId: string) {
  switch (request.kind) {
    case 'deposit':
    case 'withdraw':
      return { operationId, type: request.kind, usdcBaseUnits: request.usdcBaseUnits } as const;
    case 'close':
    case 'rescue-native':
      return { operationId, type: request.kind } as const;
    case 'rescue-token':
      return { operationId, type: request.kind, token: request.token } as const;
  }
}

class M3BrowserRuntime implements M3ProductRuntime {
  readonly #provider: Eip1193Provider | null;
  readonly #deployment: M3BrowserDeploymentConfig | null;
  readonly #reader: M3VaultReader | null;
  readonly #connection: Eip1193WalletConnection | null;
  readonly #flow: M3ChainActionFlow<RuntimeSnapshot, M3ProductActionRequest, never> | null;
  readonly #listeners = new Set<() => void>();
  #actionReviews = new WeakMap<M3ProductActionReview, M3ActionReview>();
  #approvalReviews = new WeakMap<M3DepositApprovalReview, M3DepositAuthorization>();
  #passTransferReviews = new WeakMap<
    M3PassTransferReview,
    { readonly prepared: PreparedAction; readonly wallet: Eip1193Wallet }
  >();
  readonly #now: () => string;
  readonly #writeMode: 'INJECTED_MOCK' | 'LIVE_AUTHORIZED';
  readonly #journal: M3SubmissionJournal | null;
  readonly #registeredOperations = new Set<string>();
  #pendingOperation: PendingWalletSubmission | null = null;
  #session: WalletSession | null = null;
  #readRevision = 0;
  #snapshot: M3ProductChainPresentation;

  constructor(options: M3BrowserRuntimeOptions) {
    this.#provider = options.provider ?? null;
    this.#deployment = validDeployment(options.deployment);
    this.#journal = this.#deployment
      ? new M3SubmissionJournal(this.#deployment, options.submissionStorage)
      : null;
    this.#reader = this.#deployment
      ? (options.vaultReader ??
        new M3VaultApiClient(undefined, {
          vaultAddress: this.#deployment.vaultAddress,
          passAddress: this.#deployment.strategyPassAddress,
        }))
      : null;
    this.#connection = this.#provider
      ? new Eip1193WalletConnection(this.#provider, ROBINHOOD_CHAIN_TESTNET.chainId)
      : null;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#writeMode = options.transportProvenance === 'DEV_MOCK' ? 'INJECTED_MOCK' : 'LIVE_AUTHORIZED';
    this.#snapshot = initialSnapshot(this.#deployment);

    if (this.#provider && this.#deployment && this.#reader) {
      const factory = createM3VaultActionFactory({
        chainId: this.#deployment.chainId,
        target: this.#deployment.vaultAddress,
      });
      const wallet = new Eip1193Wallet(this.#provider, {
        chainId: this.#deployment.chainId,
        target: this.#deployment.vaultAddress,
        actionAuthority: factory.authority,
        now: this.#now,
      });
      const adapter: SimulatingRobinhoodTestnetStrategyAdapter<
        RuntimeSnapshot,
        M3ProductActionRequest,
        never
      > = {
        mode: 'robinhood-testnet',
        readSnapshot: ({ wallet: owner }) => {
          if (!owner) return Promise.reject(new Error('WALLET_CONNECTION_REQUIRED'));
          return this.#readFlowSnapshot(owner);
        },
        async observeOperation(): Promise<never> {
          throw new Error('M3_OPERATION_OBSERVATION_NOT_REQUESTED');
        },
        prepareAction: async (request, context) =>
          factory.prepare(productAction(request, operationId(request.kind)), context.owner),
        simulateAction: async (prepared, context) => {
          const decoded = decodeM3VaultCalldata(prepared.data);
          const rescue = decoded?.kind === 'RESCUE_UNTRACKED_TOKEN' || decoded?.kind === 'RESCUE_NATIVE';
          if (!sameAddress(context.snapshot.value.owner, context.owner))
            return { ok: false, errorCode: 'M3_VAULT_OWNER_REQUIRED' } as const;
          if (rescue && !context.snapshot.value.state.closed)
            return { ok: false, errorCode: 'M3_RESCUE_REQUIRES_CLOSED_VAULT' } as const;
          if (!rescue && context.snapshot.value.state.closed)
            return { ok: false, errorCode: 'M3_VAULT_CLOSED' } as const;
          if (context.snapshot.source === 'LIVE_EXIT' && decoded?.kind === 'DEPOSIT')
            return { ok: false, errorCode: 'M3_CANONICAL_PROJECTION_REQUIRED' } as const;
          try {
            const result = await this.#provider!.request({
              method: 'eth_call',
              params: [
                {
                  from: prepared.owner,
                  to: prepared.target,
                  data: prepared.data,
                  value: `0x${prepared.value.toString(16)}`,
                },
                'latest',
              ],
            });
            asHexData(String(result));
            return { ok: true } as const;
          } catch {
            return { ok: false, errorCode: 'M3_LIVE_SIMULATION_FAILED' } as const;
          }
        },
        submitAction: async (prepared, port) => {
          this.#journal!.assertWritable(prepared.owner, prepared.target, prepared.data);
          return this.#retainSubmission(prepared, await port.submit(prepared));
        },
      };
      this.#flow = new M3ChainActionFlow(adapter, wallet);
    } else {
      this.#flow = null;
    }
  }

  async #retainSubmission(prepared: PreparedAction, submission: WalletSubmission): Promise<WalletSubmission> {
    if (!submission.txHash) return submission;
    const input: PendingWalletSubmission = Object.freeze({
      operationId: prepared.operationId,
      chainId: this.#deployment!.chainId,
      owner: prepared.owner,
      target: prepared.target,
      calldata: prepared.data,
      txHash: submission.txHash,
    });
    // Preserve the original wallet identity and known hash before any fallible API await.
    this.#pendingOperation = input;
    try {
      this.#journal!.record(input);
      if (submission.state !== 'SUBMITTED') return submission;
      if (!this.#reader?.registerSubmission) throw new Error('M3_SUBMISSION_REGISTRATION_UNAVAILABLE');
      await this.#reader.registerSubmission(input);
      this.#registeredOperations.add(input.operationId);
      return submission;
    } catch {
      return Object.freeze({
        operationId: prepared.operationId,
        requestedChainId: prepared.chainId,
        requestedOwner: prepared.owner,
        target: prepared.target,
        state: 'SUBMISSION_AMBIGUOUS',
        txHash: submission.txHash,
        observedAt: this.#now(),
        reason: 'LOCAL_EVIDENCE_INVALID',
        retryable: false,
      });
    }
  }

  get snapshot(): M3ProductChainPresentation {
    return this.#snapshot;
  }

  #publish(snapshot: M3ProductChainPresentation): void {
    this.#snapshot = Object.freeze(snapshot);
    for (const listener of this.#listeners) listener();
  }

  async #readCanonicalSnapshot(owner: Address): Promise<M3VaultSnapshot> {
    if (!this.#reader || !this.#deployment) throw new Error('M3_DEPLOYMENT_NOT_CONFIGURED');
    await this.#assertRuntimeStatus();
    const snapshot = await this.#reader.readSnapshot(owner);
    if (
      snapshot.chainId !== this.#deployment.chainId ||
      !sameAddress(snapshot.contract, this.#deployment.vaultAddress) ||
      !sameAddress(snapshot.owner, owner) ||
      !sameAddress(snapshot.state.owner, owner) ||
      !sameAddress(snapshot.state.pass, this.#deployment.strategyPassAddress) ||
      /^0x0{64}$/i.test(snapshot.state.strategyId) ||
      snapshot.state.strategyId.toLowerCase() !== snapshot.state.passStrategyId.toLowerCase()
    )
      throw new Error('M3_VAULT_SNAPSHOT_MISMATCH');
    return snapshot;
  }

  async #assertRuntimeStatus(): Promise<void> {
    if (!this.#reader?.readRuntimeStatus || !this.#deployment) return;
    let status: M3RuntimeStatusSnapshot;
    try {
      status = await this.#reader.readRuntimeStatus();
    } catch {
      throw new Error('M3_RUNTIME_STATUS_UNAVAILABLE');
    }
    const actual = status.deployment;
    if (
      actual.chainId !== this.#deployment.chainId ||
      !sameAddress(actual.contract, this.#deployment.vaultAddress) ||
      !sameAddress(actual.strategyPassAddress, this.#deployment.strategyPassAddress) ||
      actual.manifestDigest.toLowerCase() !== this.#deployment.manifestDigest.toLowerCase() ||
      actual.abiHash.toLowerCase() !== this.#deployment.abiHash.toLowerCase() ||
      actual.runtimeBytecodeHash.toLowerCase() !== this.#deployment.runtimeBytecodeHash.toLowerCase() ||
      actual.strategyPassAbiHash.toLowerCase() !== this.#deployment.strategyPassAbiHash.toLowerCase() ||
      actual.strategyPassRuntimeBytecodeHash.toLowerCase() !==
        this.#deployment.strategyPassRuntimeBytecodeHash.toLowerCase()
    )
      throw new Error('M3_RUNTIME_STATUS_MISMATCH');
  }

  async #readLiveExitSnapshot(): Promise<RuntimeSnapshot> {
    if (!this.#provider || !this.#deployment) throw new Error('M3_LIVE_EXIT_READ_UNAVAILABLE');
    const value = await readM3VaultLiveSnapshot(this.#provider, {
      chainId: this.#deployment.chainId,
      vaultAddress: this.#deployment.vaultAddress,
    });
    if (
      !sameAddress(value.state.pass, this.#deployment.strategyPassAddress) ||
      /^0x0{64}$/i.test(value.state.strategyId) ||
      value.state.strategyId.toLowerCase() !== value.state.passStrategyId.toLowerCase()
    )
      throw new Error('M3_STRATEGY_PASS_MISMATCH');
    return Object.freeze({
      source: 'LIVE_EXIT',
      value,
    });
  }

  async #readFlowSnapshot(owner: Address): Promise<RuntimeSnapshot> {
    try {
      return Object.freeze({ source: 'CANONICAL', value: await this.#readCanonicalSnapshot(owner) });
    } catch {
      return this.#readLiveExitSnapshot();
    }
  }

  #presentation(
    session: WalletSession,
    snapshot: RuntimeSnapshot,
    authorization?: M3DepositAuthorization,
    passBalanceBaseUnits?: string,
    passVerified = this.#snapshot.onchain.passTransferMode !== 'DISABLED',
  ): M3ProductChainPresentation {
    const contractOwner = snapshot.value.owner;
    const vaultAddress = snapshot.value.contract;
    const owner = sameAddress(contractOwner, session.account);
    const live = snapshot.source === 'CANONICAL';
    const closed = snapshot.value.state.closed;
    return {
      wallet: { status: 'CONNECTED', address: session.account },
      network: { status: 'CORRECT', chainId: session.chainId },
      transaction: this.#snapshot.transaction,
      onchain: {
        deployment: 'CONFIGURED',
        health: live ? 'LIVE' : 'DEGRADED',
        readiness: 'FINALITY_UNKNOWN',
        owner: owner ? 'OWNER' : 'NON_OWNER',
        vaultClosed: closed,
        passAddress: snapshot.value.state.pass,
        ...(this.#deployment?.passInitialSupplyBaseUnits
          ? {
              passInitialSupplyBaseUnits: this.#deployment.passInitialSupplyBaseUnits,
              passInitialRecipient: this.#deployment.passInitialRecipient!,
            }
          : {}),
        ...(passBalanceBaseUnits === undefined ? {} : { passBalanceBaseUnits }),
        passTransferMode: passVerified ? this.#writeMode : 'DISABLED',
        writeMode: owner ? this.#writeMode : 'DISABLED',
        exitPath: owner ? 'SIMULATION' : 'UNAVAILABLE',
        supportedActions: closed
          ? supportedClosedActions
          : live
            ? supportedOpenActions
            : (['withdraw', 'close'] as const),
        vaultAddress,
        ...(authorization && !closed
          ? {
              depositAuthorization: {
                spender: authorization.summary.vault,
                afUsdcAllowanceBaseUnits: authorization.summary.usdcAllowance,
                passAllowanceBaseUnits: authorization.summary.passAllowance,
                approvalCapability: 'AVAILABLE' as const,
              },
            }
          : {}),
      },
    };
  }

  async #authorization(session: WalletSession, usdcBaseUnits: string): Promise<M3DepositAuthorization> {
    if (!this.#provider || !this.#deployment) throw new Error('M3_DEPLOYMENT_NOT_CONFIGURED');
    return readM3VaultDepositAuthorization(this.#provider, {
      chainId: this.#deployment.chainId,
      vault: this.#deployment.vaultAddress,
      owner: session.account,
      usdcBaseUnits,
    });
  }

  async #assertRuntimeCode(target: Address, expectedHash: BlockHash): Promise<void> {
    if (!this.#provider) throw new Error('M3_RUNTIME_CODE_UNAVAILABLE');
    let code: HexData;
    try {
      code = asHexData(
        String(await this.#provider.request({ method: 'eth_getCode', params: [target, 'latest'] })),
      );
    } catch {
      throw new Error('M3_RUNTIME_CODE_UNAVAILABLE');
    }
    if (code === '0x' || keccak256Evm(code).toLowerCase() !== expectedHash.toLowerCase())
      throw new Error('M3_RUNTIME_CODE_MISMATCH');
  }

  async #connectedPresentation(
    session: WalletSession,
    snapshot: RuntimeSnapshot,
  ): Promise<M3ProductChainPresentation> {
    let passBalanceBaseUnits: string | undefined;
    let passVerified = snapshot.source === 'LIVE_EXIT' || !this.#reader?.readPassSnapshot;
    if (snapshot.source === 'CANONICAL' && this.#reader?.readPassSnapshot) {
      try {
        const pass = await this.#reader.readPassSnapshot(session.account);
        if (
          !sameAddress(pass.contract, snapshot.value.state.pass) ||
          !sameAddress(pass.state.pass, snapshot.value.state.pass) ||
          pass.state.strategyId.toLowerCase() !== snapshot.value.state.strategyId.toLowerCase() ||
          pass.state.decimals !== 18
        )
          throw new Error('M3_STRATEGY_PASS_MISMATCH');
        passBalanceBaseUnits = pass.state.balanceRaw;
        passVerified = true;
      } catch {
        passBalanceBaseUnits = undefined;
        passVerified = false;
      }
    } else if (this.#provider) {
      try {
        const result = String(
          await this.#provider.request({
            method: 'eth_call',
            params: [
              {
                from: session.account,
                to: snapshot.value.state.pass,
                data: asHexData(`0x70a08231${session.account.slice(2).toLowerCase().padStart(64, '0')}`),
                value: '0x0',
              },
              'latest',
            ],
          }),
        );
        if (!/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('INVALID_PASS_BALANCE');
        passBalanceBaseUnits = BigInt(result).toString();
      } catch {
        passBalanceBaseUnits = undefined;
      }
    }
    if (snapshot.source === 'LIVE_EXIT')
      return this.#presentation(session, snapshot, undefined, passBalanceBaseUnits, passVerified);
    try {
      return this.#presentation(
        session,
        snapshot,
        await this.#authorization(session, '1'),
        passBalanceBaseUnits,
        passVerified,
      );
    } catch {
      return this.#presentation(session, snapshot, undefined, passBalanceBaseUnits, passVerified);
    }
  }

  async #withSessionRead(
    run: (
      assertCurrent: () => void,
      publish: (snapshot: M3ProductChainPresentation) => Promise<void>,
    ) => Promise<void>,
  ): Promise<void> {
    const revision = ++this.#readRevision;
    const assertCurrent = () => {
      if (revision !== this.#readRevision) throw new WalletFailure('WALLET_SESSION_CHANGED');
    };
    const invalidate = () => {
      if (revision !== this.#readRevision) return;
      this.#readRevision++;
      this.#session = null;
      this.#actionReviews = new WeakMap();
      this.#approvalReviews = new WeakMap();
      this.#passTransferReviews = new WeakMap();
      const { passBalanceBaseUnits, ...onchain } = this.#snapshot.onchain;
      void passBalanceBaseUnits;
      this.#publish({
        ...this.#snapshot,
        wallet: { status: 'DISCONNECTED', errorCode: 'WALLET_SESSION_CHANGED' },
        network: { status: 'UNAVAILABLE' },
        onchain: {
          ...onchain,
          health: 'UNAVAILABLE',
          owner: 'UNKNOWN',
          writeMode: 'DISABLED',
          passTransferMode: 'DISABLED',
        },
      });
    };
    const publish = async (snapshot: M3ProductChainPresentation) => {
      assertCurrent();
      if (snapshot.wallet.status === 'CONNECTED' && snapshot.network.status === 'CORRECT') {
        const observed = await this.#connection!.observe();
        assertCurrent();
        if (
          !observed ||
          observed.chainId !== snapshot.network.chainId ||
          !snapshot.wallet.address ||
          !sameAddress(observed.account, asAddress(snapshot.wallet.address))
        ) {
          invalidate();
          throw new WalletFailure('WALLET_SESSION_CHANGED');
        }
      }
      assertCurrent();
      this.#publish(snapshot);
    };
    const registered: ('chainChanged' | 'accountsChanged' | 'disconnect')[] = [];
    try {
      if (this.#provider)
        for (const event of ['chainChanged', 'accountsChanged', 'disconnect'] as const) {
          this.#provider.on(event, invalidate);
          registered.push(event);
        }
      await run(assertCurrent, publish);
    } catch (error) {
      // Preserve a sanitized connection rejection; only close still-active read authority.
      // A superseded read must never invalidate a newer successful connection.
      if (
        this.#snapshot.wallet.status === 'CONNECTING' ||
        this.#snapshot.onchain.writeMode !== 'DISABLED' ||
        this.#snapshot.onchain.passTransferMode === 'LIVE_AUTHORIZED'
      )
        invalidate();
      throw error;
    } finally {
      for (const event of registered) {
        try {
          this.#provider!.removeListener(event, invalidate);
        } catch {
          /* State guards remain closed. */
        }
      }
    }
  }

  async connect(): Promise<void> {
    return this.#withSessionRead(async (assertCurrent, publish) => {
      if (!this.#connection) {
        const error = new Error('WALLET_PROVIDER_UNAVAILABLE');
        await publish({
          ...this.#snapshot,
          wallet: { status: 'DISCONNECTED', errorCode: error.message },
          network: { status: 'UNAVAILABLE' },
        });
        throw error;
      }
      this.#session = null;
      await publish({
        ...this.#snapshot,
        wallet: { status: 'CONNECTING' },
        onchain: {
          ...this.#snapshot.onchain,
          owner: 'UNKNOWN',
          writeMode: 'DISABLED',
          passTransferMode: 'DISABLED',
        },
      });
      try {
        if (this.#flow) {
          const connected = await this.#flow.connect(assertCurrent);
          assertCurrent();
          this.#session = connected.session;
          await publish(await this.#connectedPresentation(connected.session, connected.snapshot));
          const restored = this.#journal!.read(connected.session.account).at(-1);
          if (
            !this.#pendingOperation ||
            !sameAddress(this.#pendingOperation.owner, connected.session.account)
          )
            this.#pendingOperation = restored ?? null;
          if (this.#pendingOperation) {
            await publish({
              ...this.#snapshot,
              transaction: { status: 'SUBMISSION_AMBIGUOUS', txHash: this.#pendingOperation.txHash },
            });
            await this.refresh();
          } else {
            await publish({ ...this.#snapshot, transaction: { status: 'IDLE' } });
          }
        } else {
          const session = await this.#connection.connect();
          assertCurrent();
          this.#session = session;
          await publish({
            ...this.#snapshot,
            wallet: { status: 'CONNECTED', address: session.account },
            network: { status: 'CORRECT', chainId: session.chainId },
          });
        }
      } catch (error) {
        assertCurrent();
        const code = error instanceof WalletFailure ? error.code : 'WALLET_REQUEST_FAILED';
        let observed = null;
        try {
          observed = await this.#connection.observe();
        } catch {
          // The original sanitized wallet error remains authoritative.
        }
        await publish({
          ...this.#snapshot,
          wallet: {
            status: code === 'WALLET_REJECTED' ? 'CONNECTION_REJECTED' : 'DISCONNECTED',
            ...(observed ? { address: observed.account } : {}),
            errorCode: code,
          },
          network: observed
            ? {
                status: observed.chainId === ROBINHOOD_CHAIN_TESTNET.chainId ? 'CORRECT' : 'WRONG',
                chainId: observed.chainId,
              }
            : { status: code === 'WALLET_WRONG_CHAIN' ? 'WRONG' : 'UNAVAILABLE' },
        });
        throw error;
      }
    });
  }

  async refresh(): Promise<void> {
    return this.#withSessionRead(async (assertCurrent, publish) => {
      if (!this.#connection) return;
      const observed = await this.#connection.observe();
      assertCurrent();
      if (!observed) {
        this.#session = null;
        const { passBalanceBaseUnits, ...onchain } = this.#snapshot.onchain;
        void passBalanceBaseUnits;
        await publish({
          ...this.#snapshot,
          wallet: { status: 'DISCONNECTED', errorCode: 'WALLET_DISCONNECTED' },
          network: { status: 'UNAVAILABLE' },
          onchain: {
            ...onchain,
            owner: 'UNKNOWN',
            writeMode: 'DISABLED',
            passTransferMode: 'DISABLED',
          },
        });
        return;
      }
      if (this.#session && !sameAddress(observed.account, this.#session.account)) {
        this.#session = null;
        await publish({
          ...this.#snapshot,
          wallet: { status: 'ACCOUNT_CHANGED', address: observed.account },
          network: {
            status: observed.chainId === ROBINHOOD_CHAIN_TESTNET.chainId ? 'CORRECT' : 'WRONG',
            chainId: observed.chainId,
          },
          onchain: {
            ...this.#snapshot.onchain,
            owner: 'UNKNOWN',
            writeMode: 'DISABLED',
            passTransferMode: 'DISABLED',
          },
        });
        return;
      }
      if (observed.chainId !== ROBINHOOD_CHAIN_TESTNET.chainId) {
        await publish({
          ...this.#snapshot,
          wallet: { status: 'CONNECTED', address: observed.account },
          network: { status: 'WRONG', chainId: observed.chainId },
          onchain: {
            ...this.#snapshot.onchain,
            owner: 'UNKNOWN',
            writeMode: 'DISABLED',
            passTransferMode: 'DISABLED',
          },
        });
        return;
      }
      const session = this.#session;
      if (this.#deployment && this.#reader && session) {
        let snapshot = await this.#readFlowSnapshot(session.account);
        assertCurrent();
        let presentation = await this.#connectedPresentation(session, snapshot);
        assertCurrent();
        const saved = this.#journal!.read(session.account);
        const restored = saved.at(-1);
        // A completed recovery hint must not replace the current transaction being
        // watched for a later reorg with an older unresolved operation.
        if (
          restored &&
          (!this.#pendingOperation || !sameAddress(this.#pendingOperation.owner, session.account))
        )
          this.#pendingOperation = restored;
        const pending = this.#pendingOperation;
        for (const previous of saved) {
          if (previous.operationId === pending?.operationId) continue;
          try {
            if (!this.#registeredOperations.has(previous.operationId)) {
              if (!this.#reader.registerSubmission) continue;
              await this.#reader.registerSubmission(previous);
              assertCurrent();
              this.#registeredOperations.add(previous.operationId);
            }
            const evidence = await this.#reader.readOperationEvidence?.(previous.operationId, previous.owner);
            assertCurrent();
            if (
              evidence &&
              (evidence.productReady ||
                ['REJECTED', 'REVERTED', 'REPLACED', 'DROPPED'].includes(evidence.lifecycle))
            )
              this.#journal!.remove(previous);
          } catch {
            assertCurrent();
            // Keep unresolved older hints without hiding the current transaction.
          }
        }
        if (pending && sameAddress(pending.owner, session.account)) {
          try {
            if (!this.#registeredOperations.has(pending.operationId)) {
              if (!this.#reader.registerSubmission) throw new Error('M3_SUBMISSION_REGISTRATION_UNAVAILABLE');
              await this.#reader.registerSubmission(pending);
              assertCurrent();
              this.#registeredOperations.add(pending.operationId);
            }
            presentation = { ...presentation, transaction: { status: 'SUBMITTED', txHash: pending.txHash } };
            if (!this.#reader.readOperationEvidence) {
              await publish(presentation);
              return;
            }
            const evidence = await this.#reader.readOperationEvidence(pending.operationId, pending.owner);
            assertCurrent();
            if (
              evidence.productReady ||
              ['REJECTED', 'REVERTED', 'REPLACED', 'DROPPED'].includes(evidence.lifecycle)
            )
              this.#journal!.remove(pending);
            if (evidence.indexerStatus === 'DEGRADED' && snapshot.source !== 'LIVE_EXIT') {
              snapshot = await this.#readLiveExitSnapshot();
              presentation = await this.#connectedPresentation(session, snapshot);
            }
            presentation = {
              ...presentation,
              transaction: transactionPresentationFromEvidence(evidence, pending.txHash),
              onchain: {
                ...presentation.onchain,
                health: evidence.indexerStatus === 'DEGRADED' ? 'DEGRADED' : presentation.onchain.health,
                readiness:
                  evidence.chainStatus === 'SOFT_READY'
                    ? 'SOFT_READY'
                    : evidence.chainStatus === 'REORGED'
                      ? 'REORGED'
                      : 'FINALITY_UNKNOWN',
              },
            };
          } catch {
            assertCurrent();
            if (!this.#registeredOperations.has(pending.operationId)) {
              presentation = {
                ...presentation,
                transaction: { status: 'SUBMISSION_AMBIGUOUS', txHash: pending.txHash },
              };
              await publish(presentation);
            }
            try {
              snapshot = await this.#readLiveExitSnapshot();
              presentation = {
                ...(await this.#connectedPresentation(session, snapshot)),
                transaction: this.#snapshot.transaction,
              };
            } catch {
              assertCurrent();
              presentation = {
                ...presentation,
                onchain: { ...presentation.onchain, health: 'DEGRADED' },
              };
            }
          }
        }
        await publish(presentation);
      } else {
        await publish({
          ...this.#snapshot,
          wallet: { status: 'CONNECTED', address: observed.account },
          network: {
            status: observed.chainId === ROBINHOOD_CHAIN_TESTNET.chainId ? 'CORRECT' : 'WRONG',
            chainId: observed.chainId,
          },
        });
      }
    });
  }

  async reviewDepositApprovals(
    request: Extract<M3ProductActionRequest, { readonly kind: 'deposit' }>,
  ): Promise<M3DepositApprovalReview> {
    const session = this.#session;
    if (!session || !this.#deployment) throw new Error('WALLET_CONNECTION_REQUIRED');
    await Promise.all([
      this.#assertRuntimeCode(this.#deployment.vaultAddress, this.#deployment.runtimeBytecodeHash),
      this.#assertRuntimeCode(
        this.#deployment.strategyPassAddress,
        this.#deployment.strategyPassRuntimeBytecodeHash,
      ),
    ]);
    const snapshot = await this.#readCanonicalSnapshot(session.account);
    const authorization = await this.#authorization(session, request.usdcBaseUnits);
    this.#publish(
      this.#presentation(session, Object.freeze({ source: 'CANONICAL', value: snapshot }), authorization),
    );
    const requirements: M3DepositApprovalReview['requirements'] = [
      Object.freeze({
        kind: 'af-usdc' as const,
        token: authorization.usdcApproval.token,
        spender: authorization.usdcApproval.spender,
        requiredRaw: authorization.usdcApproval.requiredRaw,
        allowance: authorization.usdcApproval.allowance,
        sufficient: authorization.usdcApproval.sufficient,
      }),
      Object.freeze({
        kind: 'pass' as const,
        token: authorization.passApproval.token,
        spender: authorization.passApproval.spender,
        requiredRaw: authorization.passApproval.requiredRaw,
        allowance: authorization.passApproval.allowance,
        sufficient: authorization.passApproval.sufficient,
      }),
    ];
    const review: M3DepositApprovalReview = Object.freeze({
      owner: session.account,
      vaultAddress: this.#deployment.vaultAddress,
      request,
      requirements: Object.freeze(requirements),
    });
    this.#approvalReviews.set(review, authorization);
    return review;
  }

  async confirmDepositApproval(
    review: M3DepositApprovalReview,
    kind: M3DepositApprovalKind,
    beforeSend?: BeforeWalletSend,
  ): Promise<WalletSubmission> {
    const authorization = this.#approvalReviews.get(review);
    if (!authorization || !this.#provider || !this.#deployment)
      throw new Error('INVALID_DEPOSIT_APPROVAL_REVIEW');
    this.#approvalReviews.delete(review);
    const requirement = kind === 'af-usdc' ? authorization.usdcApproval : authorization.passApproval;
    if (requirement.sufficient) throw new Error('DEPOSIT_APPROVAL_ALREADY_SUFFICIENT');
    await this.#assertRuntimeCode(this.#deployment.vaultAddress, this.#deployment.runtimeBytecodeHash);
    if (kind === 'pass')
      await this.#assertRuntimeCode(
        this.#deployment.strategyPassAddress,
        this.#deployment.strategyPassRuntimeBytecodeHash,
      );
    const wallet = new Eip1193Wallet(this.#provider, {
      chainId: this.#deployment.chainId,
      target: requirement.token,
      actionAuthority: requirement.factory.authority,
      now: this.#now,
    });
    const prepared = requirement.factory.prepare(
      { operationId: operationId(`approve-${kind}`) },
      review.owner,
    );
    const submission = await wallet.submit(prepared, () => {
      beforeSend?.();
      this.#publish({ ...this.#snapshot, transaction: { status: 'WALLET_PENDING' } });
    });
    this.#publish({
      ...this.#snapshot,
      transaction:
        submission.state === 'SUBMITTED'
          ? { status: 'SUBMITTED', txHash: submission.txHash }
          : {
              status: 'SUBMISSION_AMBIGUOUS',
              ...(submission.txHash ? { txHash: submission.txHash } : {}),
              errorCode: submission.reason,
            },
    });
    return submission;
  }

  async reviewAction(request: M3ProductActionRequest): Promise<M3ProductActionReview> {
    if (!this.#flow || !this.#session) throw new Error('M3_DEPLOYMENT_NOT_CONFIGURED');
    await this.#assertRuntimeCode(this.#deployment!.vaultAddress, this.#deployment!.runtimeBytecodeHash);
    if (request.kind === 'deposit') {
      const snapshot = await this.#readCanonicalSnapshot(this.#session.account);
      const authorization = await this.#authorization(this.#session, request.usdcBaseUnits);
      this.#publish(
        this.#presentation(
          this.#session,
          Object.freeze({ source: 'CANONICAL', value: snapshot }),
          authorization,
        ),
      );
      if (!authorization.usdcApproval.sufficient || !authorization.passApproval.sufficient)
        throw new Error('DEPOSIT_APPROVAL_REQUIRED');
    }
    this.#publish({ ...this.#snapshot, transaction: { status: 'WALLET_APPROVAL_REQUIRED' } });
    const internal = await this.#flow.review(request);
    const review = Object.freeze({
      operationId: internal.operationId,
      owner: internal.owner,
      request,
    });
    this.#actionReviews.set(review, internal);
    return review;
  }

  async confirmAction(
    review: M3ProductActionReview,
    beforeSend?: BeforeWalletSend,
  ): Promise<WalletSubmission> {
    if (!this.#flow) throw new Error('M3_DEPLOYMENT_NOT_CONFIGURED');
    const internal = this.#actionReviews.get(review);
    if (!internal) throw new Error('INVALID_PRODUCT_REVIEW');
    this.#actionReviews.delete(review);
    await this.#assertRuntimeCode(this.#deployment!.vaultAddress, this.#deployment!.runtimeBytecodeHash);
    const submission = await this.#flow.confirm(internal, () => {
      beforeSend?.();
      this.#publish({ ...this.#snapshot, transaction: { status: 'WALLET_PENDING' } });
    });
    this.#publish({
      ...this.#snapshot,
      transaction:
        submission.state === 'SUBMITTED'
          ? { status: 'SUBMITTED', txHash: submission.txHash }
          : {
              status: 'SUBMISSION_AMBIGUOUS',
              ...(submission.txHash ? { txHash: submission.txHash } : {}),
              errorCode: submission.reason,
            },
    });
    return submission;
  }

  async reviewPassTransfer(request: M3PassTransferRequest): Promise<M3PassTransferReview> {
    const session = this.#session;
    if (!session || !this.#provider || !this.#deployment || !this.#connection)
      throw new Error('M3_DEPLOYMENT_NOT_CONFIGURED');
    const observedBefore = await this.#connection.observe();
    if (
      !observedBefore ||
      observedBefore.chainId !== session.chainId ||
      !sameAddress(observedBefore.account, session.account)
    )
      throw new Error('WALLET_SESSION_CHANGED');
    await this.#assertRuntimeCode(
      this.#deployment.strategyPassAddress,
      this.#deployment.strategyPassRuntimeBytecodeHash,
    );
    await this.#readFlowSnapshot(session.account);
    const token = this.#deployment.strategyPassAddress;
    const factory = createM3PassTransferFactory({ chainId: this.#deployment.chainId, target: token });
    const prepared = factory.prepare(
      {
        operationId: operationId('pass-transfer'),
        recipient: request.recipient,
        passBaseUnits: request.passBaseUnits,
      },
      session.account,
    );
    try {
      asHexData(
        String(
          await this.#provider.request({
            method: 'eth_call',
            params: [
              {
                from: prepared.owner,
                to: prepared.target,
                data: prepared.data,
                value: `0x${prepared.value.toString(16)}`,
              },
              'latest',
            ],
          }),
        ),
      );
    } catch {
      throw new Error('M3_PASS_TRANSFER_SIMULATION_FAILED');
    }
    const observedAfter = await this.#connection.observe();
    if (
      !observedAfter ||
      observedAfter.chainId !== session.chainId ||
      !sameAddress(observedAfter.account, session.account)
    )
      throw new Error('WALLET_SESSION_CHANGED');
    const review: M3PassTransferReview = Object.freeze({
      operationId: prepared.operationId,
      owner: session.account,
      token,
      request,
    });
    const wallet = new Eip1193Wallet(this.#provider, {
      chainId: this.#deployment.chainId,
      target: token,
      actionAuthority: factory.authority,
      now: this.#now,
    });
    this.#passTransferReviews.set(review, Object.freeze({ prepared, wallet }));
    this.#publish({ ...this.#snapshot, transaction: { status: 'WALLET_APPROVAL_REQUIRED' } });
    return review;
  }

  async confirmPassTransfer(
    review: M3PassTransferReview,
    beforeSend?: BeforeWalletSend,
  ): Promise<WalletSubmission> {
    const pending = this.#passTransferReviews.get(review);
    if (!pending) throw new Error('INVALID_PASS_TRANSFER_REVIEW');
    this.#passTransferReviews.delete(review);
    await this.#assertRuntimeCode(
      this.#deployment!.strategyPassAddress,
      this.#deployment!.strategyPassRuntimeBytecodeHash,
    );
    this.#journal!.assertWritable(pending.prepared.owner, pending.prepared.target, pending.prepared.data);
    let submission = await pending.wallet.submit(pending.prepared, () => {
      beforeSend?.();
      this.#publish({ ...this.#snapshot, transaction: { status: 'WALLET_PENDING' } });
    });
    submission = await this.#retainSubmission(pending.prepared, submission);
    this.#publish({
      ...this.#snapshot,
      transaction:
        submission.state === 'SUBMITTED'
          ? { status: 'SUBMITTED', txHash: submission.txHash }
          : {
              status: 'SUBMISSION_AMBIGUOUS',
              ...(submission.txHash ? { txHash: submission.txHash } : {}),
              errorCode: submission.reason,
            },
    });
    return submission;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export function createM3BrowserRuntime(options: M3BrowserRuntimeOptions): M3ProductRuntime {
  return new M3BrowserRuntime(options);
}
