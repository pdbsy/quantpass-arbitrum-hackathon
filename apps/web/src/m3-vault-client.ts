import {
  asAddress,
  asBlockHash,
  asHexData,
  asTransactionHash,
  sameAddress,
  type Address,
  type BlockHash,
  type HexData,
  type TransactionHash,
} from '../../../packages/chain-adapter/src/types.ts';
import type { ProductOperationEvidence } from '../../../packages/chain-adapter/src/reconciliation.ts';

export class M3VaultReadFailure extends Error {
  readonly code = 'M3_VAULT_READ_FAILED' as const;

  constructor() {
    super('M3_VAULT_READ_FAILED');
    this.name = 'M3VaultReadFailure';
  }
}

export class M3VaultSubmissionFailure extends Error {
  readonly code = 'M3_VAULT_SUBMISSION_FAILED' as const;

  constructor() {
    super('M3_VAULT_SUBMISSION_FAILED');
    this.name = 'M3VaultSubmissionFailure';
  }
}

export interface M3VaultSubmissionInput {
  readonly operationId: string;
  readonly chainId: 46_630;
  readonly owner: Address;
  readonly target: Address;
  readonly calldata: HexData;
  readonly txHash: TransactionHash;
}

export interface M3VaultSubmissionRecord extends M3VaultSubmissionInput {
  readonly state:
    | 'SUBMITTED'
    | 'MINED'
    | 'CONFIRMING'
    | 'CONFIRMED'
    | 'REVERTED'
    | 'REPLACED'
    | 'DROPPED'
    | 'REORGED'
    | 'RECONCILIATION_FAILED';
  readonly submittedAt: string;
}

export interface M3VaultSnapshot {
  readonly chainId: 46_630;
  readonly owner: Address;
  readonly contract: Address;
  readonly projectionKey: 'm3-vault';
  readonly blockNumber: string;
  readonly blockHash: BlockHash;
  readonly state: Readonly<{
    owner: Address;
    strategyCreator: Address;
    strategyId: HexData;
    strategyRef: HexData;
    pass: Address;
    passStrategyId: HexData;
    afUsdc: Address;
    afEth: Address;
    afBtc: Address;
    passLocker: Address;
    principalBasis: string;
    trackedUsdcBalance: string;
    realizedProfit: string;
    withdrawableUsdc: string;
    trackedAfEth: string;
    trackedAfBtc: string;
    openTrackedPositionCount: string;
    closed: boolean;
  }>;
}

export interface M3PassSnapshot {
  readonly chainId: 46_630;
  readonly owner: Address;
  readonly contract: Address;
  readonly projectionKey: 'm3-strategy-pass';
  readonly blockNumber: string;
  readonly blockHash: BlockHash;
  readonly state: Readonly<{
    owner: Address;
    pass: Address;
    strategyId: HexData;
    decimals: 18;
    balanceRaw: string;
  }>;
}

export interface M3RuntimeStatusSnapshot {
  readonly lastAttempt: 'NOT_RUN' | 'SUCCEEDED';
  readonly errorCode: null;
  readonly database: Readonly<{
    status: 'HEALTHY';
    schemaVersion: number;
    integrity: 'OK';
  }>;
  readonly deployment: Readonly<{
    chainId: 46_630;
    contract: Address;
    manifestDigest: BlockHash;
    abiHash: BlockHash;
    runtimeBytecodeHash: BlockHash;
    strategyPassAddress: Address;
    strategyPassAbiHash: BlockHash;
    strategyPassRuntimeBytecodeHash: BlockHash;
  }>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new M3VaultReadFailure();
  return value as Record<string, unknown>;
}

function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  const row = object(value);
  const keys = Object.keys(row);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)))
    throw new M3VaultReadFailure();
  return row;
}

function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new M3VaultReadFailure();
  return value;
}

function address(value: unknown): Address {
  try {
    return asAddress(String(value));
  } catch {
    throw new M3VaultReadFailure();
  }
}

function bytes32(value: unknown): HexData {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new M3VaultReadFailure();
  return asHexData(value);
}

function snapshot(value: unknown, expectedOwner: Address, expectedContract?: Address): M3VaultSnapshot {
  const row = exactObject(value, [
    'chainId',
    'owner',
    'contract',
    'projectionKey',
    'blockNumber',
    'blockHash',
    'state',
  ]);
  const state = exactObject(row.state, [
    'owner',
    'strategyCreator',
    'strategyId',
    'strategyRef',
    'pass',
    'passStrategyId',
    'afUsdc',
    'afEth',
    'afBtc',
    'passLocker',
    'principalBasis',
    'trackedUsdcBalance',
    'realizedProfit',
    'withdrawableUsdc',
    'trackedAfEth',
    'trackedAfBtc',
    'openTrackedPositionCount',
    'closed',
  ]);
  const owner = address(row.owner);
  const contract = address(row.contract);
  const stateOwner = address(state.owner);
  const strategyId = bytes32(state.strategyId);
  const passStrategyId = bytes32(state.passStrategyId);
  if (
    row.chainId !== 46_630 ||
    row.projectionKey !== 'm3-vault' ||
    typeof state.closed !== 'boolean' ||
    !sameAddress(owner, expectedOwner) ||
    (expectedContract !== undefined && !sameAddress(contract, expectedContract)) ||
    !sameAddress(stateOwner, expectedOwner) ||
    strategyId.toLowerCase() !== passStrategyId.toLowerCase()
  )
    throw new M3VaultReadFailure();
  let blockHash: BlockHash;
  try {
    blockHash = asBlockHash(String(row.blockHash));
  } catch {
    throw new M3VaultReadFailure();
  }
  const normalizedState = Object.freeze({
    owner: stateOwner,
    strategyCreator: address(state.strategyCreator),
    strategyId,
    strategyRef: bytes32(state.strategyRef),
    pass: address(state.pass),
    passStrategyId,
    afUsdc: address(state.afUsdc),
    afEth: address(state.afEth),
    afBtc: address(state.afBtc),
    passLocker: address(state.passLocker),
    principalBasis: decimal(state.principalBasis),
    trackedUsdcBalance: decimal(state.trackedUsdcBalance),
    realizedProfit: decimal(state.realizedProfit),
    withdrawableUsdc: decimal(state.withdrawableUsdc),
    trackedAfEth: decimal(state.trackedAfEth),
    trackedAfBtc: decimal(state.trackedAfBtc),
    openTrackedPositionCount: decimal(state.openTrackedPositionCount),
    closed: state.closed,
  });
  return Object.freeze({
    chainId: 46_630,
    owner,
    contract,
    projectionKey: 'm3-vault',
    blockNumber: decimal(row.blockNumber),
    blockHash,
    state: normalizedState,
  });
}

function passSnapshot(value: unknown, expectedOwner: Address, expectedContract: Address): M3PassSnapshot {
  const row = exactObject(value, [
    'chainId',
    'owner',
    'contract',
    'projectionKey',
    'blockNumber',
    'blockHash',
    'state',
  ]);
  const state = exactObject(row.state, ['owner', 'pass', 'strategyId', 'decimals', 'balanceRaw']);
  const owner = address(row.owner);
  const contract = address(row.contract);
  const stateOwner = address(state.owner);
  const pass = address(state.pass);
  const strategyId = bytes32(state.strategyId);
  if (
    row.chainId !== 46_630 ||
    row.projectionKey !== 'm3-strategy-pass' ||
    !sameAddress(owner, expectedOwner) ||
    !sameAddress(stateOwner, expectedOwner) ||
    !sameAddress(contract, expectedContract) ||
    !sameAddress(pass, expectedContract) ||
    /^0x0{64}$/i.test(strategyId) ||
    state.decimals !== 18
  )
    throw new M3VaultReadFailure();
  let blockHash: BlockHash;
  try {
    blockHash = asBlockHash(String(row.blockHash));
  } catch {
    throw new M3VaultReadFailure();
  }
  return Object.freeze({
    chainId: 46_630,
    owner,
    contract,
    projectionKey: 'm3-strategy-pass',
    blockNumber: decimal(row.blockNumber),
    blockHash,
    state: Object.freeze({
      owner: stateOwner,
      pass,
      strategyId,
      decimals: 18,
      balanceRaw: decimal(state.balanceRaw),
    }),
  });
}

function blockHash(value: unknown): BlockHash {
  try {
    return asBlockHash(String(value));
  } catch {
    throw new M3VaultReadFailure();
  }
}

function runtimeStatus(
  value: unknown,
  expectedVault: Address,
  expectedPass: Address,
): M3RuntimeStatusSnapshot {
  const row = exactObject(value, ['lastAttempt', 'errorCode', 'database', 'deployment']);
  const database = exactObject(row.database, ['status', 'schemaVersion', 'integrity']);
  const deployment = exactObject(row.deployment, [
    'chainId',
    'contract',
    'manifestDigest',
    'abiHash',
    'runtimeBytecodeHash',
    'strategyPassAddress',
    'strategyPassAbiHash',
    'strategyPassRuntimeBytecodeHash',
  ]);
  const contract = address(deployment.contract);
  const strategyPassAddress = address(deployment.strategyPassAddress);
  if (
    !['NOT_RUN', 'SUCCEEDED'].includes(String(row.lastAttempt)) ||
    row.errorCode !== null ||
    database.status !== 'HEALTHY' ||
    database.integrity !== 'OK' ||
    !Number.isSafeInteger(database.schemaVersion) ||
    Number(database.schemaVersion) < 1 ||
    deployment.chainId !== 46_630 ||
    !sameAddress(contract, expectedVault) ||
    !sameAddress(strategyPassAddress, expectedPass)
  )
    throw new M3VaultReadFailure();
  return Object.freeze({
    lastAttempt: row.lastAttempt as M3RuntimeStatusSnapshot['lastAttempt'],
    errorCode: null,
    database: Object.freeze({
      status: 'HEALTHY',
      schemaVersion: database.schemaVersion as number,
      integrity: 'OK',
    }),
    deployment: Object.freeze({
      chainId: 46_630,
      contract,
      manifestDigest: blockHash(deployment.manifestDigest),
      abiHash: blockHash(deployment.abiHash),
      runtimeBytecodeHash: blockHash(deployment.runtimeBytecodeHash),
      strategyPassAddress,
      strategyPassAbiHash: blockHash(deployment.strategyPassAbiHash),
      strategyPassRuntimeBytecodeHash: blockHash(deployment.strategyPassRuntimeBytecodeHash),
    }),
  });
}

const operationStates = new Set<M3VaultSubmissionRecord['state']>([
  'SUBMITTED',
  'MINED',
  'CONFIRMING',
  'CONFIRMED',
  'REVERTED',
  'REPLACED',
  'DROPPED',
  'REORGED',
  'RECONCILIATION_FAILED',
]);

const lifecycleStates = new Set<ProductOperationEvidence['lifecycle']>([
  'AWAITING_SIGNATURE',
  'SUBMITTED',
  'MINED',
  'CONFIRMING',
  'CONFIRMED',
  'REJECTED',
  'REVERTED',
  'REPLACED',
  'DROPPED',
  'REORGED',
  'RECONCILIATION_FAILED',
]);

function operationId(
  value: unknown,
  Failure: typeof M3VaultReadFailure | typeof M3VaultSubmissionFailure,
): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new Failure();
  return value;
}

function submissionInput(value: unknown): M3VaultSubmissionInput {
  try {
    const row = exactObject(value, ['operationId', 'chainId', 'owner', 'target', 'calldata', 'txHash']);
    if (row.chainId !== 46_630) throw new M3VaultSubmissionFailure();
    return Object.freeze({
      operationId: operationId(row.operationId, M3VaultSubmissionFailure),
      chainId: 46_630,
      owner: asAddress(String(row.owner)),
      target: asAddress(String(row.target)),
      calldata: asHexData(String(row.calldata)),
      txHash: asTransactionHash(String(row.txHash)),
    });
  } catch (error) {
    if (error instanceof M3VaultSubmissionFailure) throw error;
    throw new M3VaultSubmissionFailure();
  }
}

function submissionRecord(value: unknown, expected: M3VaultSubmissionInput): M3VaultSubmissionRecord {
  try {
    const row = exactObject(value, [
      'operationId',
      'chainId',
      'owner',
      'target',
      'calldata',
      'state',
      'txHash',
      'submittedAt',
    ]);
    const identity = submissionInput({
      operationId: row.operationId,
      chainId: row.chainId,
      owner: row.owner,
      target: row.target,
      calldata: row.calldata,
      txHash: row.txHash,
    });
    if (
      identity.operationId !== expected.operationId ||
      !sameAddress(identity.owner, expected.owner) ||
      !sameAddress(identity.target, expected.target) ||
      identity.calldata.toLowerCase() !== expected.calldata.toLowerCase() ||
      identity.txHash.toLowerCase() !== expected.txHash.toLowerCase() ||
      typeof row.state !== 'string' ||
      !operationStates.has(row.state as M3VaultSubmissionRecord['state']) ||
      typeof row.submittedAt !== 'string' ||
      !Number.isFinite(Date.parse(row.submittedAt)) ||
      new Date(row.submittedAt).toISOString() !== row.submittedAt
    )
      throw new M3VaultSubmissionFailure();
    return Object.freeze({
      ...identity,
      state: row.state as M3VaultSubmissionRecord['state'],
      submittedAt: row.submittedAt,
    });
  } catch (error) {
    if (error instanceof M3VaultSubmissionFailure) throw error;
    throw new M3VaultSubmissionFailure();
  }
}

function operationEvidence(value: unknown, expectedOperationId: string): ProductOperationEvidence {
  const row = exactObject(value, [
    'operationId',
    'lifecycle',
    'receipt',
    'receiptCanonical',
    'confirmations',
    'reconciliation',
    'projection',
    'chainStatus',
    'l1Status',
    'finalityStatus',
    'indexerStatus',
    'degradedReason',
    'productReady',
  ]);
  if (
    operationId(row.operationId, M3VaultReadFailure) !== expectedOperationId ||
    typeof row.lifecycle !== 'string' ||
    !lifecycleStates.has(row.lifecycle as ProductOperationEvidence['lifecycle']) ||
    !['PENDING', 'SUCCESS', 'REVERTED'].includes(String(row.receipt)) ||
    typeof row.receiptCanonical !== 'boolean' ||
    !Number.isSafeInteger(row.confirmations) ||
    Number(row.confirmations) < 0 ||
    !['PENDING', 'MATCHED', 'FAILED'].includes(String(row.reconciliation)) ||
    !['PENDING', 'READY', 'STALE'].includes(String(row.projection)) ||
    !['PENDING', 'INCLUDED', 'SOFT_READY', 'REORGED', 'FAILED', 'UNKNOWN'].includes(
      String(row.chainStatus),
    ) ||
    !['UNKNOWN', 'POSTED'].includes(String(row.l1Status)) ||
    !['UNKNOWN', 'FINALIZED'].includes(String(row.finalityStatus)) ||
    !['HEALTHY', 'SYNCING', 'DEGRADED'].includes(String(row.indexerStatus)) ||
    !(
      row.degradedReason === null ||
      row.degradedReason === 'CHAIN_REORG_DEPTH_EXCEEDED' ||
      row.degradedReason === 'CHAIN_REORG_NO_COMMON_ANCESTOR'
    ) ||
    typeof row.productReady !== 'boolean'
  )
    throw new M3VaultReadFailure();
  return Object.freeze({
    lifecycle: row.lifecycle as ProductOperationEvidence['lifecycle'],
    receipt: row.receipt as ProductOperationEvidence['receipt'],
    receiptCanonical: row.receiptCanonical,
    confirmations: row.confirmations as number,
    reconciliation: row.reconciliation as ProductOperationEvidence['reconciliation'],
    projection: row.projection as ProductOperationEvidence['projection'],
    chainStatus: row.chainStatus as ProductOperationEvidence['chainStatus'],
    l1Status: row.l1Status as ProductOperationEvidence['l1Status'],
    finalityStatus: row.finalityStatus as ProductOperationEvidence['finalityStatus'],
    indexerStatus: row.indexerStatus as ProductOperationEvidence['indexerStatus'],
    degradedReason: row.degradedReason as ProductOperationEvidence['degradedReason'],
    productReady: row.productReady,
  });
}

export class M3VaultApiClient {
  readonly #fetcher: typeof fetch;
  readonly #vaultAddress: Address | null;
  readonly #passAddress: Address | null;

  constructor(
    fetcher: typeof fetch = fetch,
    contracts?: { readonly vaultAddress: Address; readonly passAddress: Address },
  ) {
    this.#fetcher = fetcher;
    this.#vaultAddress = contracts ? asAddress(contracts.vaultAddress) : null;
    this.#passAddress = contracts ? asAddress(contracts.passAddress) : null;
  }

  async readSnapshot(owner: Address): Promise<M3VaultSnapshot> {
    try {
      const path = this.#vaultAddress
        ? `/api/v1/chain/vaults/${this.#vaultAddress}/${owner}`
        : `/api/v1/chain/vaults/${owner}`;
      const response = await this.#fetcher(path, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new M3VaultReadFailure();
      return snapshot(await response.json(), owner, this.#vaultAddress ?? undefined);
    } catch (error) {
      if (error instanceof M3VaultReadFailure) throw error;
      throw new M3VaultReadFailure();
    }
  }

  async readPassSnapshot(owner: Address): Promise<M3PassSnapshot> {
    try {
      if (!this.#passAddress) throw new M3VaultReadFailure();
      const response = await this.#fetcher(`/api/v1/chain/passes/${this.#passAddress}/${owner}`, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new M3VaultReadFailure();
      return passSnapshot(await response.json(), owner, this.#passAddress);
    } catch (error) {
      if (error instanceof M3VaultReadFailure) throw error;
      throw new M3VaultReadFailure();
    }
  }

  async readRuntimeStatus(): Promise<M3RuntimeStatusSnapshot> {
    try {
      if (!this.#vaultAddress || !this.#passAddress) throw new M3VaultReadFailure();
      const response = await this.#fetcher(`/api/v1/chain/runtime-status/${this.#vaultAddress}`, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new M3VaultReadFailure();
      return runtimeStatus(await response.json(), this.#vaultAddress, this.#passAddress);
    } catch (error) {
      if (error instanceof M3VaultReadFailure) throw error;
      throw new M3VaultReadFailure();
    }
  }

  async registerSubmission(input: M3VaultSubmissionInput): Promise<M3VaultSubmissionRecord> {
    try {
      const normalized = submissionInput(input);
      const response = await this.#fetcher('/api/v1/chain/operations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-QuantPass-Demo': '1',
        },
        body: JSON.stringify(normalized),
      });
      if (response.status !== 202) throw new M3VaultSubmissionFailure();
      return submissionRecord(await response.json(), normalized);
    } catch (error) {
      if (error instanceof M3VaultSubmissionFailure) throw error;
      throw new M3VaultSubmissionFailure();
    }
  }

  async readOperationEvidence(
    requestedOperationId: string,
    owner: Address,
  ): Promise<ProductOperationEvidence> {
    try {
      const normalizedOperationId = operationId(requestedOperationId, M3VaultReadFailure);
      const normalizedOwner = asAddress(owner);
      const response = await this.#fetcher(
        `/api/v1/chain/operations/${normalizedOperationId}/evidence?owner=${normalizedOwner}`,
        {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        },
      );
      if (!response.ok) throw new M3VaultReadFailure();
      return operationEvidence(await response.json(), normalizedOperationId);
    } catch (error) {
      if (error instanceof M3VaultReadFailure) throw error;
      throw new M3VaultReadFailure();
    }
  }
}
