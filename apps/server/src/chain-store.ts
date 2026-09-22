import { DatabaseSync, backup } from 'node:sqlite';
import { closeSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  asAddress,
  asBlockHash,
  asHexData,
  asTransactionHash,
  sameAddress,
  sameHash,
  type Address,
  type BlockHash,
  type HexData,
  type TransactionHash,
} from '../../../packages/chain-adapter/src/types.ts';
import type { ChainBlock, ChainLog } from '../../../packages/chain-adapter/src/rpc.ts';
import type { ProductOperationEvidence } from '../../../packages/chain-adapter/src/reconciliation.ts';
import type {
  ChainOperation,
  OperationErrorCode,
  TransactionState,
} from '../../../packages/chain-adapter/src/lifecycle.ts';

export interface IndexedChainEvent extends ChainLog {
  readonly chainId: number;
  readonly eventSignature: HexData;
  readonly eventName: string;
  readonly normalizedData: Readonly<Record<string, unknown>>;
}

export interface ChainCheckpoint {
  readonly blockNumber: bigint;
  readonly blockHash: BlockHash;
}

export interface ChainSyncHealth {
  readonly healthy: boolean;
  readonly error:
    'CHAIN_REORG_DEPTH_EXCEEDED' | 'CHAIN_REORG_NO_COMMON_ANCESTOR' | 'CHAIN_SYNC_INCOMPLETE' | null;
}

export interface ChainDatabaseHealth {
  readonly status: 'HEALTHY' | 'UNHEALTHY';
  readonly schemaVersion: number | null;
  readonly integrity: 'OK' | 'FAILED';
}

export interface ProductProjection {
  readonly chainId: number;
  readonly owner: Address;
  readonly contract: Address;
  readonly projectionKey: string;
  readonly blockNumber: bigint;
  readonly blockHash: BlockHash;
  readonly state: Readonly<Record<string, unknown>>;
}

const expectedTables = [
  'chain_blocks',
  'chain_checkpoints',
  'chain_events',
  'chain_sync_leases',
  'chain_transactions',
  'product_projections',
];
const states = new Set<TransactionState>([
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
const errorCodes = new Set<OperationErrorCode>([
  'WALLET_REJECTED',
  'TRANSACTION_REVERTED',
  'TRANSACTION_REPLACED',
  'TRANSACTION_DROPPED',
  'CHAIN_REORG',
  'EVENT_EVIDENCE_MISMATCH',
  'CONTRACT_STATE_MISMATCH',
  'RPC_UNAVAILABLE',
]);
const MAX_PRODUCT_EVIDENCE_ANCESTRY_BLOCKS = 2_000;
const receiptStatuses = new Set(['SUCCESS', 'REVERTED']);
const namePattern = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;

function validTime(value: string | null): boolean {
  return value !== null && Number.isFinite(Date.parse(value));
}

function validateOperationEvidence(operation: ChainOperation): void {
  const submitted = operation.txHash !== null && validTime(operation.submittedAt);
  const transactionIndexValid =
    operation.transactionIndex === null ||
    (Number.isSafeInteger(operation.transactionIndex) && operation.transactionIndex >= 0);
  const noBlock =
    operation.blockNumber === null &&
    operation.blockHash === null &&
    operation.transactionIndex === null &&
    operation.receiptStatus === null;
  const successfulBlock =
    operation.blockNumber !== null && operation.blockHash !== null && operation.receiptStatus === 'SUCCESS';
  const revertedBlock =
    operation.blockNumber !== null && operation.blockHash !== null && operation.receiptStatus === 'REVERTED';
  const pendingOrDisplacedReceipt =
    (noBlock && operation.confirmations === 0) ||
    (operation.blockNumber !== null && operation.blockHash !== null && operation.receiptStatus !== null);
  const basePending = operation.confirmedAt === null && !operation.canonical && !operation.reconciled;
  let valid = false;
  switch (operation.state) {
    case 'AWAITING_SIGNATURE':
      valid =
        operation.txHash === null &&
        operation.submittedAt === null &&
        noBlock &&
        operation.confirmations === 0 &&
        operation.replacementTxHash === null &&
        basePending &&
        operation.errorCode === null;
      break;
    case 'SUBMITTED':
      valid =
        submitted &&
        noBlock &&
        operation.confirmations === 0 &&
        operation.replacementTxHash === null &&
        basePending &&
        operation.errorCode === null;
      break;
    case 'MINED':
      valid =
        submitted &&
        successfulBlock &&
        operation.confirmations === 0 &&
        operation.replacementTxHash === null &&
        operation.canonical &&
        !operation.reconciled &&
        operation.confirmedAt === null &&
        operation.errorCode === null;
      break;
    case 'CONFIRMING':
      valid =
        submitted &&
        successfulBlock &&
        operation.replacementTxHash === null &&
        operation.canonical &&
        operation.confirmedAt === null &&
        operation.errorCode === null;
      break;
    case 'CONFIRMED':
      valid =
        submitted &&
        successfulBlock &&
        operation.replacementTxHash === null &&
        operation.canonical &&
        operation.reconciled &&
        validTime(operation.confirmedAt) &&
        operation.errorCode === null;
      break;
    case 'REJECTED':
      valid =
        operation.txHash === null &&
        operation.submittedAt === null &&
        noBlock &&
        operation.confirmations === 0 &&
        operation.replacementTxHash === null &&
        basePending &&
        operation.errorCode === 'WALLET_REJECTED';
      break;
    case 'REVERTED':
      valid =
        submitted &&
        revertedBlock &&
        operation.replacementTxHash === null &&
        operation.canonical &&
        !operation.reconciled &&
        operation.confirmedAt === null &&
        operation.errorCode === 'TRANSACTION_REVERTED';
      break;
    case 'REPLACED':
      valid =
        submitted &&
        pendingOrDisplacedReceipt &&
        operation.replacementTxHash !== null &&
        basePending &&
        operation.errorCode === 'TRANSACTION_REPLACED';
      break;
    case 'DROPPED':
      valid =
        submitted &&
        pendingOrDisplacedReceipt &&
        operation.replacementTxHash === null &&
        basePending &&
        operation.errorCode === 'TRANSACTION_DROPPED';
      break;
    case 'REORGED':
      valid =
        submitted &&
        operation.blockNumber !== null &&
        operation.blockHash !== null &&
        operation.receiptStatus !== null &&
        operation.replacementTxHash === null &&
        basePending &&
        operation.errorCode === 'CHAIN_REORG';
      break;
    case 'RECONCILIATION_FAILED':
      valid =
        submitted &&
        successfulBlock &&
        operation.replacementTxHash === null &&
        operation.canonical &&
        !operation.reconciled &&
        operation.confirmedAt === null &&
        ['EVENT_EVIDENCE_MISMATCH', 'CONTRACT_STATE_MISMATCH'].includes(operation.errorCode ?? '');
      break;
  }
  if (!valid || !transactionIndexValid) throw new Error('INVALID_OPERATION_EVIDENCE');
}

function safeNumber(value: bigint, code = 'CHAIN_BLOCK_NUMBER_UNSUPPORTED'): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(code);
  return Number(value);
}

function chainId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_CHAIN_ID');
  return value;
}

function normalizedAddress(value: Address): string {
  return asAddress(value).toLowerCase();
}

function stable(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('INVALID_CHAIN_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('INVALID_CHAIN_JSON');
    seen.add(value);
    const result = `[${value.map((entry) => stable(entry, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('INVALID_CHAIN_JSON');
  seen.add(value);
  const record = value as Record<string, unknown>;
  const result = `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(record[key], seen)}`)
    .join(',')}}`;
  seen.delete(value);
  return result;
}

function boundedJson(value: unknown): string {
  const json = stable(value);
  if (Buffer.byteLength(json, 'utf8') > 65_536) throw new Error('CHAIN_JSON_TOO_LARGE');
  return json;
}

function operationFingerprint(operation: ChainOperation): string {
  return boundedJson({
    ...operation,
    owner: operation.owner.toLowerCase(),
    target: operation.target.toLowerCase(),
    txHash: operation.txHash?.toLowerCase() ?? null,
    blockNumber: operation.blockNumber?.toString() ?? null,
    blockHash: operation.blockHash?.toLowerCase() ?? null,
    replacementTxHash: operation.replacementTxHash?.toLowerCase() ?? null,
  });
}

function eventFingerprint(event: IndexedChainEvent): string {
  return boundedJson({
    address: normalizedAddress(event.address),
    blockNumber: event.blockNumber.toString(),
    blockHash: event.blockHash.toLowerCase(),
    transactionHash: event.transactionHash.toLowerCase(),
    transactionIndex: event.transactionIndex,
    logIndex: event.logIndex,
    data: event.data.toLowerCase(),
    topics: event.topics.map((topic) => topic.toLowerCase()),
    removed: event.removed,
    eventSignature: event.eventSignature.toLowerCase(),
    eventName: event.eventName,
    normalizedData: event.normalizedData,
  });
}

function eventPayloadFingerprint(event: IndexedChainEvent): string {
  return boundedJson({
    address: normalizedAddress(event.address),
    transactionHash: event.transactionHash.toLowerCase(),
    logIndex: event.logIndex,
    data: event.data.toLowerCase(),
    topics: event.topics.map((topic) => topic.toLowerCase()),
    removed: event.removed,
    eventSignature: event.eventSignature.toLowerCase(),
    eventName: event.eventName,
    normalizedData: event.normalizedData,
  });
}

function validateEvent(
  event: IndexedChainEvent,
  expectedChainId: number,
  contract: Address,
  block: ChainBlock,
): void {
  if (
    event.chainId !== expectedChainId ||
    !sameAddress(event.address, contract) ||
    event.blockNumber !== block.number ||
    event.blockHash.toLowerCase() !== block.hash.toLowerCase() ||
    event.removed ||
    !Number.isSafeInteger(event.transactionIndex) ||
    event.transactionIndex < 0 ||
    !Number.isSafeInteger(event.logIndex) ||
    event.logIndex < 0 ||
    !namePattern.test(event.eventName) ||
    event.topics.length < 1 ||
    event.topics[0]?.toLowerCase() !== event.eventSignature.toLowerCase()
  )
    throw new Error('INVALID_CHAIN_EVENT');
  eventFingerprint(event);
}

interface EventRow {
  chain_id: number;
  tx_hash: string;
  log_index: number;
  transaction_index: number;
  contract_address: string;
  block_number: number;
  block_hash: string;
  data: string;
  topics_json: string;
  event_signature: string;
  event_name: string;
  normalized_json: string;
  canonical: number;
}

interface OperationRow {
  operation_id: string;
  chain_id: number;
  tx_hash: string | null;
  owner_address: string;
  target_address: string;
  calldata: string | null;
  state: string;
  submitted_at: string | null;
  block_number: number | null;
  block_hash: string | null;
  transaction_index: number | null;
  receipt_status: string | null;
  confirmations: number;
  replacement_tx_hash: string | null;
  canonical: number;
  reconciled: number;
  confirmed_at: string | null;
  error_code: string | null;
}

export class ChainStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;',
    );
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      const tables = (
        this.db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all() as { name: string }[]
      ).map((row) => row.name);
      if (version === 0) {
        if (tables.length) throw new Error('REFUSING_UNKNOWN_CHAIN_DATABASE');
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.exec(
            readFileSync(new URL('../chain-migrations/001-chain-projection.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(
              new URL('../chain-migrations/002-projection-checkpoint.sql', import.meta.url),
              'utf8',
            ),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/003-sync-target.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/004-sync-lease.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/005-transaction-index.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/006-operation-calldata.sql', import.meta.url), 'utf8'),
          );
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      } else if (
        JSON.stringify(tables) !==
        JSON.stringify(
          version < 4 ? expectedTables.filter((name) => name !== 'chain_sync_leases') : expectedTables,
        )
      ) {
        throw new Error('UNSUPPORTED_CHAIN_DATABASE');
      } else if (version === 1) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.exec(
            readFileSync(
              new URL('../chain-migrations/002-projection-checkpoint.sql', import.meta.url),
              'utf8',
            ),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/003-sync-target.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/004-sync-lease.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/005-transaction-index.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/006-operation-calldata.sql', import.meta.url), 'utf8'),
          );
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      } else if (version === 2) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.exec(
            readFileSync(new URL('../chain-migrations/003-sync-target.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/004-sync-lease.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/005-transaction-index.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/006-operation-calldata.sql', import.meta.url), 'utf8'),
          );
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      } else if (version === 3) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.exec(
            readFileSync(new URL('../chain-migrations/004-sync-lease.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/005-transaction-index.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/006-operation-calldata.sql', import.meta.url), 'utf8'),
          );
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      } else if (version === 4) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.exec(
            readFileSync(new URL('../chain-migrations/005-transaction-index.sql', import.meta.url), 'utf8'),
          );
          this.db.exec(
            readFileSync(new URL('../chain-migrations/006-operation-calldata.sql', import.meta.url), 'utf8'),
          );
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      } else if (version === 5) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.exec(
            readFileSync(new URL('../chain-migrations/006-operation-calldata.sql', import.meta.url), 'utf8'),
          );
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      } else if (version !== 6 && version !== 7) {
        throw new Error('UNSUPPORTED_CHAIN_DATABASE');
      }
      if (Number(this.db.prepare('PRAGMA user_version').get()?.user_version) === 6) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.exec(
            readFileSync(
              new URL('../chain-migrations/007-observation-identity.sql', import.meta.url),
              'utf8',
            ),
          );
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  health(): ChainDatabaseHealth {
    try {
      const schemaVersion = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
      const result = this.db.prepare('PRAGMA quick_check').get() as { quick_check: string } | undefined;
      const healthy = schemaVersion === 7 && result?.quick_check === 'ok';
      return Object.freeze({
        status: healthy ? 'HEALTHY' : 'UNHEALTHY',
        schemaVersion: Number.isSafeInteger(schemaVersion) ? schemaVersion : null,
        integrity: healthy ? 'OK' : 'FAILED',
      });
    } catch {
      return Object.freeze({ status: 'UNHEALTHY', schemaVersion: null, integrity: 'FAILED' });
    }
  }

  async backupTo(target: string): Promise<string> {
    const path = resolve(target);
    try {
      closeSync(openSync(path, 'wx', 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('BACKUP_TARGET_EXISTS', { cause: error });
      throw error;
    }
    try {
      await backup(this.db, path);
      return path;
    } catch (error) {
      try {
        unlinkSync(path);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'BACKUP_FAILED_CLEANUP_FAILED', {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }

  #assertSyncOwner(id: number, address: string, ownerToken: string | null): void {
    const lease = this.db
      .prepare('SELECT owner_token FROM chain_sync_leases WHERE chain_id = ? AND contract_address = ?')
      .get(id, address) as { owner_token: string } | undefined;
    if ((lease && lease.owner_token !== ownerToken) || (!lease && ownerToken !== null))
      throw new Error('CHAIN_SYNC_SUPERSEDED');
  }

  claimSync(valueChainId: number, contract: Address, targetBlock: bigint, ownerToken: string): void {
    if (!/^[0-9a-f-]{36}$/.test(ownerToken)) throw new Error('INVALID_CHAIN_SYNC_OWNER');
    const id = chainId(valueChainId);
    const address = normalizedAddress(contract);
    const target = safeNumber(targetBlock);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db
        .prepare(
          'SELECT target_block_number FROM chain_sync_leases WHERE chain_id = ? AND contract_address = ?',
        )
        .get(id, address) as { target_block_number: number } | undefined;
      const checkpoint = this.db
        .prepare(
          'SELECT sync_target_block_number FROM chain_checkpoints WHERE chain_id = ? AND contract_address = ?',
        )
        .get(id, address) as { sync_target_block_number: number | null } | undefined;
      const requiredTarget = Math.max(
        existing?.target_block_number ?? -1,
        checkpoint?.sync_target_block_number ?? -1,
      );
      if (target < requiredTarget) throw new Error('CHAIN_SYNC_TARGET_BEHIND');
      const claimedTarget = Math.max(target, requiredTarget);
      this.db
        .prepare(
          `INSERT INTO chain_sync_leases (chain_id, contract_address, owner_token, target_block_number)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(chain_id, contract_address) DO UPDATE SET
             owner_token = excluded.owner_token,
             target_block_number = CASE
               WHEN chain_sync_leases.target_block_number > excluded.target_block_number
                 THEN chain_sync_leases.target_block_number
               ELSE excluded.target_block_number
             END`,
        )
        .run(id, address, ownerToken, claimedTarget);
      this.db
        .prepare(
          `UPDATE chain_checkpoints
           SET sync_healthy = 0, sync_error = 'CHAIN_SYNC_INCOMPLETE',
             sync_target_block_number = CASE
               WHEN sync_target_block_number IS NULL OR sync_target_block_number < ? THEN ?
               ELSE sync_target_block_number
             END
           WHERE chain_id = ? AND contract_address = ?`,
        )
        .run(claimedTarget, claimedTarget, id, address);
      this.db.exec('COMMIT');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  checkpoint(valueChainId: number, contract: Address): ChainCheckpoint | null {
    const row = this.db
      .prepare(
        'SELECT block_number, block_hash FROM chain_checkpoints WHERE chain_id = ? AND contract_address = ?',
      )
      .get(chainId(valueChainId), normalizedAddress(contract)) as
      { block_number: number; block_hash: string } | undefined;
    return row
      ? Object.freeze({ blockNumber: BigInt(row.block_number), blockHash: asBlockHash(row.block_hash) })
      : null;
  }

  projectionCheckpoint(valueChainId: number, contract: Address): ChainCheckpoint | null {
    const row = this.db
      .prepare(
        'SELECT projected_block_number, projected_block_hash FROM chain_checkpoints WHERE chain_id = ? AND contract_address = ?',
      )
      .get(chainId(valueChainId), normalizedAddress(contract)) as
      { projected_block_number: number | null; projected_block_hash: string | null } | undefined;
    if (!row) return null;
    if ((row.projected_block_number === null) !== (row.projected_block_hash === null))
      throw new Error('CORRUPT_CHAIN_DATABASE');
    return row.projected_block_number === null
      ? null
      : Object.freeze({
          blockNumber: BigInt(row.projected_block_number),
          blockHash: asBlockHash(row.projected_block_hash!),
        });
  }

  syncHealth(valueChainId: number, contract: Address): ChainSyncHealth {
    const row = this.db
      .prepare(
        `SELECT checkpoint.sync_healthy, checkpoint.sync_error,
                checkpoint.sync_target_block_number, lease.owner_token
         FROM (SELECT 1) AS seed
         LEFT JOIN chain_checkpoints AS checkpoint
           ON checkpoint.chain_id = ? AND checkpoint.contract_address = ?
         LEFT JOIN chain_sync_leases AS lease
           ON lease.chain_id = ? AND lease.contract_address = ?`,
      )
      .get(
        chainId(valueChainId),
        normalizedAddress(contract),
        chainId(valueChainId),
        normalizedAddress(contract),
      ) as {
      sync_healthy: number | null;
      sync_error: string | null;
      sync_target_block_number: number | null;
      owner_token: string | null;
    };
    if (row.owner_token !== null) return Object.freeze({ healthy: false, error: 'CHAIN_SYNC_INCOMPLETE' });
    if (row.sync_healthy === null) return Object.freeze({ healthy: true, error: null });
    if (
      (row.sync_healthy === 1 && row.sync_error === null && row.sync_target_block_number === null) ||
      (row.sync_healthy === 0 &&
        ['CHAIN_REORG_DEPTH_EXCEEDED', 'CHAIN_REORG_NO_COMMON_ANCESTOR'].includes(row.sync_error ?? '') &&
        row.sync_target_block_number === null) ||
      (row.sync_healthy === 0 &&
        row.sync_error === 'CHAIN_SYNC_INCOMPLETE' &&
        row.sync_target_block_number !== null)
    )
      return Object.freeze({
        healthy: row.sync_healthy === 1,
        error: row.sync_error as ChainSyncHealth['error'],
      });
    throw new Error('CORRUPT_CHAIN_DATABASE');
  }

  markSyncUnhealthy(
    valueChainId: number,
    contract: Address,
    error: Exclude<ChainSyncHealth['error'], null>,
    targetBlock: bigint | null = null,
    ownerToken: string | null = null,
  ): void {
    if ((error === 'CHAIN_SYNC_INCOMPLETE') !== (targetBlock !== null))
      throw new Error('INVALID_CHAIN_SYNC_HEALTH');
    const id = chainId(valueChainId);
    const address = normalizedAddress(contract);
    const target = targetBlock === null ? null : safeNumber(targetBlock);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.#assertSyncOwner(id, address, ownerToken);
      const result =
        error === 'CHAIN_SYNC_INCOMPLETE'
          ? this.db
              .prepare(
                `UPDATE chain_checkpoints
                 SET sync_healthy = 0, sync_error = ?,
                   sync_target_block_number = CASE
                     WHEN sync_target_block_number IS NULL OR sync_target_block_number < ? THEN ?
                     ELSE sync_target_block_number
                   END
                 WHERE chain_id = ? AND contract_address = ?`,
              )
              .run(error, target, target, id, address)
          : this.db
              .prepare(
                `UPDATE chain_checkpoints
                 SET sync_healthy = 0, sync_error = ?, sync_target_block_number = NULL
                 WHERE chain_id = ? AND contract_address = ?`,
              )
              .run(error, id, address);
      if (result.changes !== 1) throw new Error('CHAIN_CHECKPOINT_NOT_FOUND');
      if (error !== 'CHAIN_SYNC_INCOMPLETE' && ownerToken !== null)
        this.db
          .prepare(
            'DELETE FROM chain_sync_leases WHERE chain_id = ? AND contract_address = ? AND owner_token = ?',
          )
          .run(id, address, ownerToken);
      this.db.exec('COMMIT');
    } catch (cause) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw cause;
    }
  }

  markSyncHealthy(
    valueChainId: number,
    contract: Address,
    completedTarget: bigint,
    ownerToken: string | null = null,
  ): boolean {
    const id = chainId(valueChainId);
    const address = normalizedAddress(contract);
    const completed = safeNumber(completedTarget);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.#assertSyncOwner(id, address, ownerToken);
      const result = this.db
        .prepare(
          `UPDATE chain_checkpoints
           SET sync_healthy = 1, sync_error = NULL, sync_target_block_number = NULL
           WHERE chain_id = ? AND contract_address = ?
             AND sync_error = 'CHAIN_SYNC_INCOMPLETE'
             AND block_number >= ?
             AND projected_block_number = block_number
             AND projected_block_hash = block_hash
             AND sync_target_block_number <= ?`,
        )
        .run(id, address, completed, completed);
      if (result.changes === 1 && ownerToken !== null) {
        const released = this.db
          .prepare(
            'DELETE FROM chain_sync_leases WHERE chain_id = ? AND contract_address = ? AND owner_token = ?',
          )
          .run(id, address, ownerToken);
        if (released.changes !== 1) throw new Error('CHAIN_SYNC_SUPERSEDED');
      }
      this.db.exec('COMMIT');
      return result.changes === 1;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  releaseSyncIncomplete(
    valueChainId: number,
    contract: Address,
    targetBlock: bigint,
    ownerToken: string,
  ): void {
    const id = chainId(valueChainId);
    const address = normalizedAddress(contract);
    const target = safeNumber(targetBlock);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.#assertSyncOwner(id, address, ownerToken);
      const checkpoint = this.db
        .prepare(
          `UPDATE chain_checkpoints
           SET sync_healthy = 0, sync_error = 'CHAIN_SYNC_INCOMPLETE',
             sync_target_block_number = CASE
               WHEN sync_target_block_number IS NULL OR sync_target_block_number < ? THEN ?
               ELSE sync_target_block_number
             END
           WHERE chain_id = ? AND contract_address = ?`,
        )
        .run(target, target, id, address);
      if (checkpoint.changes !== 1) throw new Error('CHAIN_CHECKPOINT_NOT_FOUND');
      const released = this.db
        .prepare(
          'DELETE FROM chain_sync_leases WHERE chain_id = ? AND contract_address = ? AND owner_token = ?',
        )
        .run(id, address, ownerToken);
      if (released.changes !== 1) throw new Error('CHAIN_SYNC_SUPERSEDED');
      this.db.exec('COMMIT');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  syncTarget(valueChainId: number, contract: Address): bigint | null {
    const row = this.db
      .prepare(
        `SELECT COALESCE(lease.target_block_number, checkpoint.sync_target_block_number) AS sync_target_block_number
         FROM (SELECT 1) AS seed
         LEFT JOIN chain_checkpoints AS checkpoint
           ON checkpoint.chain_id = ? AND checkpoint.contract_address = ?
         LEFT JOIN chain_sync_leases AS lease
           ON lease.chain_id = ? AND lease.contract_address = ?`,
      )
      .get(
        chainId(valueChainId),
        normalizedAddress(contract),
        chainId(valueChainId),
        normalizedAddress(contract),
      ) as { sync_target_block_number: number | null };
    return row?.sync_target_block_number === null || !row ? null : BigInt(row.sync_target_block_number);
  }

  canonicalBlock(valueChainId: number, contract: Address, blockNumber: bigint): ChainBlock | null {
    const row = this.db
      .prepare(
        'SELECT block_number, block_hash, parent_hash, block_timestamp FROM chain_blocks WHERE chain_id = ? AND contract_address = ? AND block_number = ? AND canonical = 1',
      )
      .get(chainId(valueChainId), normalizedAddress(contract), safeNumber(blockNumber)) as
      { block_number: number; block_hash: string; parent_hash: string; block_timestamp: string } | undefined;
    return row
      ? Object.freeze({
          number: BigInt(row.block_number),
          hash: asBlockHash(row.block_hash),
          parentHash: asBlockHash(row.parent_hash),
          timestamp: BigInt(row.block_timestamp),
        })
      : null;
  }

  recordCanonicalBlock(
    valueChainId: number,
    contract: Address,
    block: ChainBlock,
    events: readonly IndexedChainEvent[],
    syncTargetBlock: bigint | null = null,
    ownerToken: string | null = null,
  ): { insertedEvents: number; checkpoint: ChainCheckpoint } {
    const id = chainId(valueChainId);
    const address = normalizedAddress(contract);
    const blockNumber = safeNumber(block.number);
    if (block.timestamp < 0n || !Number.isSafeInteger(events.length) || events.length > 10_000)
      throw new Error('INVALID_CHAIN_BLOCK');
    if (syncTargetBlock !== null && syncTargetBlock < block.number)
      throw new Error('INVALID_CHAIN_SYNC_TARGET');
    for (const item of events) validateEvent(item, id, contract, block);
    const sorted = [...events].sort(
      (left, right) => left.transactionIndex - right.transactionIndex || left.logIndex - right.logIndex,
    );
    const identities = new Set(
      sorted.map((item) => `${item.transactionHash.toLowerCase()}:${item.logIndex}`),
    );
    if (identities.size !== sorted.length) throw new Error('CHAIN_EVENT_CONFLICT');

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.#assertSyncOwner(id, address, ownerToken);
      const current = this.checkpoint(id, contract);
      const existingBlock = this.db
        .prepare(
          'SELECT block_hash, log_count FROM chain_blocks WHERE chain_id = ? AND contract_address = ? AND block_number = ? AND canonical = 1',
        )
        .get(id, address, blockNumber) as { block_hash: string; log_count: number } | undefined;
      if (existingBlock) {
        if (current && block.number < current.blockNumber) throw new Error('CHAIN_BLOCK_OUT_OF_ORDER');
        if (
          existingBlock.block_hash.toLowerCase() !== block.hash.toLowerCase() ||
          existingBlock.log_count !== sorted.length
        )
          throw new Error('CHAIN_BLOCK_CONFLICT');
        const existingEvents = this.db
          .prepare(
            'SELECT * FROM chain_events WHERE chain_id = ? AND contract_address = ? AND block_number = ? AND canonical = 1 ORDER BY transaction_index, log_index',
          )
          .all(id, address, blockNumber) as unknown as EventRow[];
        if (existingEvents.length !== sorted.length) throw new Error('CHAIN_BLOCK_CONFLICT');
        for (const [index, row] of existingEvents.entries()) {
          const decoded = this.decodeEvent(row);
          const supplied = sorted[index]!;
          if (
            decoded.transactionHash.toLowerCase() !== supplied.transactionHash.toLowerCase() ||
            decoded.logIndex !== supplied.logIndex
          )
            throw new Error('CHAIN_BLOCK_CONFLICT');
          if (eventFingerprint(decoded) !== eventFingerprint(supplied))
            throw new Error('CHAIN_EVENT_CONFLICT');
        }
      } else if (
        current &&
        (block.number !== current.blockNumber + 1n ||
          block.parentHash.toLowerCase() !== current.blockHash.toLowerCase())
      ) {
        throw new Error('CHAIN_PARENT_MISMATCH');
      } else if (!current || block.number > current.blockNumber) {
        this.db
          .prepare(
            `INSERT INTO chain_blocks
              (chain_id, contract_address, block_number, block_hash, parent_hash, block_timestamp, log_count, canonical)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)
             ON CONFLICT(chain_id, contract_address, block_number, block_hash) DO UPDATE SET
              parent_hash = excluded.parent_hash, block_timestamp = excluded.block_timestamp,
              log_count = excluded.log_count, canonical = 1`,
          )
          .run(
            id,
            address,
            blockNumber,
            block.hash.toLowerCase(),
            block.parentHash.toLowerCase(),
            block.timestamp.toString(),
            sorted.length,
          );
      } else {
        throw new Error('CHAIN_BLOCK_OUT_OF_ORDER');
      }

      let insertedEvents = 0;
      for (const item of sorted) {
        const txHash = item.transactionHash.toLowerCase();
        const existing = this.db
          .prepare('SELECT * FROM chain_events WHERE chain_id = ? AND tx_hash = ? AND log_index = ?')
          .get(id, txHash, item.logIndex) as EventRow | undefined;
        if (existing) {
          const decoded = this.decodeEvent(existing);
          if (
            existing.canonical
              ? eventFingerprint(decoded) !== eventFingerprint(item)
              : eventPayloadFingerprint(decoded) !== eventPayloadFingerprint(item)
          )
            throw new Error('CHAIN_EVENT_CONFLICT');
          if (!existing.canonical) {
            this.db
              .prepare(
                'UPDATE chain_events SET transaction_index = ?, contract_address = ?, block_number = ?, block_hash = ?, data = ?, topics_json = ?, event_signature = ?, event_name = ?, normalized_json = ?, canonical = 1 WHERE chain_id = ? AND tx_hash = ? AND log_index = ?',
              )
              .run(
                item.transactionIndex,
                address,
                blockNumber,
                item.blockHash.toLowerCase(),
                item.data.toLowerCase(),
                boundedJson(item.topics.map((topic) => topic.toLowerCase())),
                item.eventSignature.toLowerCase(),
                item.eventName,
                boundedJson(item.normalizedData),
                id,
                txHash,
                item.logIndex,
              );
            insertedEvents++;
          }
          continue;
        }
        this.db
          .prepare(
            'INSERT INTO chain_events (chain_id, tx_hash, log_index, transaction_index, contract_address, block_number, block_hash, data, topics_json, event_signature, event_name, normalized_json, canonical) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
          )
          .run(
            id,
            txHash,
            item.logIndex,
            item.transactionIndex,
            address,
            blockNumber,
            item.blockHash.toLowerCase(),
            item.data.toLowerCase(),
            boundedJson(item.topics.map((topic) => topic.toLowerCase())),
            item.eventSignature.toLowerCase(),
            item.eventName,
            boundedJson(item.normalizedData),
          );
        insertedEvents++;
      }
      if (!current || block.number > current.blockNumber) {
        this.db
          .prepare(
            'INSERT INTO chain_checkpoints (chain_id, contract_address, block_number, block_hash) VALUES (?, ?, ?, ?) ON CONFLICT(chain_id, contract_address) DO UPDATE SET block_number = excluded.block_number, block_hash = excluded.block_hash',
          )
          .run(id, address, blockNumber, block.hash.toLowerCase());
      }
      if (syncTargetBlock !== null) {
        const updated = this.db
          .prepare(
            `UPDATE chain_checkpoints SET sync_healthy = 0, sync_error = 'CHAIN_SYNC_INCOMPLETE',
              sync_target_block_number = CASE
                WHEN sync_target_block_number IS NULL OR sync_target_block_number < ? THEN ?
                ELSE sync_target_block_number
              END
             WHERE chain_id = ? AND contract_address = ?`,
          )
          .run(safeNumber(syncTargetBlock), safeNumber(syncTargetBlock), id, address);
        if (updated.changes !== 1) throw new Error('CHAIN_CHECKPOINT_NOT_FOUND');
      }
      this.db.exec('COMMIT');
      return {
        insertedEvents,
        checkpoint: Object.freeze({ blockNumber: block.number, blockHash: block.hash }),
      };
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private decodeEvent(row: EventRow): IndexedChainEvent {
    let topics: unknown;
    let normalizedData: unknown;
    try {
      topics = JSON.parse(row.topics_json);
      normalizedData = JSON.parse(row.normalized_json);
    } catch {
      throw new Error('CORRUPT_CHAIN_DATABASE');
    }
    if (
      !Array.isArray(topics) ||
      !normalizedData ||
      typeof normalizedData !== 'object' ||
      Array.isArray(normalizedData)
    )
      throw new Error('CORRUPT_CHAIN_DATABASE');
    try {
      return Object.freeze({
        chainId: row.chain_id,
        address: asAddress(row.contract_address),
        blockNumber: BigInt(row.block_number),
        blockHash: asBlockHash(row.block_hash),
        transactionHash: asTransactionHash(row.tx_hash),
        transactionIndex: row.transaction_index,
        logIndex: row.log_index,
        data: asHexData(row.data),
        topics: Object.freeze(topics.map((topic) => asHexData(String(topic)))),
        removed: false,
        eventSignature: asHexData(row.event_signature),
        eventName: row.event_name,
        normalizedData: Object.freeze(normalizedData as Record<string, unknown>),
      });
    } catch {
      throw new Error('CORRUPT_CHAIN_DATABASE');
    }
  }

  canonicalEvents(valueChainId: number, contract: Address): readonly IndexedChainEvent[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM chain_events WHERE chain_id = ? AND contract_address = ? AND canonical = 1 ORDER BY block_number, transaction_index, log_index',
      )
      .all(chainId(valueChainId), normalizedAddress(contract)) as unknown as EventRow[];
    return Object.freeze(rows.map((row) => this.decodeEvent(row)));
  }

  saveOperation(operation: ChainOperation): void {
    validateOperationEvidence(operation);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(operation.operationId))
      throw new Error('INVALID_OPERATION_ID');
    const previous = this.operation(operation.operationId);
    if (
      previous &&
      (previous.chainId !== operation.chainId ||
        !sameAddress(previous.owner, operation.owner) ||
        !sameAddress(previous.target, operation.target) ||
        previous.calldata?.toLowerCase() !== operation.calldata?.toLowerCase() ||
        (previous.txHash &&
          operation.txHash &&
          previous.txHash.toLowerCase() !== operation.txHash.toLowerCase()))
    )
      throw new Error('OPERATION_IDENTITY_CONFLICT');
    try {
      this.db
        .prepare(
          `INSERT INTO chain_transactions
          (operation_id, chain_id, tx_hash, owner_address, target_address, calldata, state, submitted_at, block_number, block_hash, transaction_index, receipt_status, confirmations, replacement_tx_hash, canonical, reconciled, confirmed_at, error_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(operation_id) DO UPDATE SET
          tx_hash = excluded.tx_hash, state = excluded.state, submitted_at = excluded.submitted_at,
          block_number = excluded.block_number, block_hash = excluded.block_hash,
          transaction_index = excluded.transaction_index, receipt_status = excluded.receipt_status,
          confirmations = excluded.confirmations,
          replacement_tx_hash = excluded.replacement_tx_hash, canonical = excluded.canonical,
          reconciled = excluded.reconciled, confirmed_at = excluded.confirmed_at, error_code = excluded.error_code`,
        )
        .run(
          operation.operationId,
          chainId(operation.chainId),
          operation.txHash?.toLowerCase() ?? null,
          normalizedAddress(operation.owner),
          normalizedAddress(operation.target),
          operation.calldata?.toLowerCase() ?? null,
          operation.state,
          operation.submittedAt,
          operation.blockNumber === null ? null : safeNumber(operation.blockNumber),
          operation.blockHash?.toLowerCase() ?? null,
          operation.transactionIndex,
          operation.receiptStatus,
          operation.confirmations,
          operation.replacementTxHash?.toLowerCase() ?? null,
          operation.canonical ? 1 : 0,
          operation.reconciled ? 1 : 0,
          operation.confirmedAt,
          operation.errorCode,
        );
    } catch (error) {
      const transaction = operation.txHash
        ? this.operationByTransaction(operation.chainId, operation.txHash)
        : null;
      if (transaction && transaction.operationId !== operation.operationId)
        throw new Error('OPERATION_IDENTITY_CONFLICT', { cause: error });
      throw error;
    }
  }

  operation(operationId: string): ChainOperation | null {
    const row = this.db
      .prepare('SELECT * FROM chain_transactions WHERE operation_id = ?')
      .get(operationId) as OperationRow | undefined;
    if (!row) return null;
    if (
      !states.has(row.state as TransactionState) ||
      (row.receipt_status !== null && !receiptStatuses.has(row.receipt_status)) ||
      (row.error_code !== null && !errorCodes.has(row.error_code as OperationErrorCode))
    )
      throw new Error('CORRUPT_CHAIN_DATABASE');
    try {
      return Object.freeze({
        operationId: row.operation_id,
        chainId: row.chain_id,
        owner: asAddress(row.owner_address),
        target: asAddress(row.target_address),
        calldata: row.calldata === null ? null : asHexData(row.calldata),
        state: row.state as TransactionState,
        txHash: row.tx_hash === null ? null : asTransactionHash(row.tx_hash),
        submittedAt: row.submitted_at,
        blockNumber: row.block_number === null ? null : BigInt(row.block_number),
        blockHash: row.block_hash === null ? null : asBlockHash(row.block_hash),
        transactionIndex: row.transaction_index,
        receiptStatus: row.receipt_status as 'SUCCESS' | 'REVERTED' | null,
        confirmations: row.confirmations,
        replacementTxHash:
          row.replacement_tx_hash === null ? null : asTransactionHash(row.replacement_tx_hash),
        canonical: row.canonical === 1,
        reconciled: row.reconciled === 1,
        confirmedAt: row.confirmed_at,
        errorCode: row.error_code as OperationErrorCode | null,
      });
    } catch {
      throw new Error('CORRUPT_CHAIN_DATABASE');
    }
  }

  operationByTransaction(networkChainId: number, txHash: TransactionHash): ChainOperation | null {
    const row = this.db
      .prepare(
        'SELECT operation_id FROM chain_transactions WHERE chain_id = ? AND tx_hash = ? AND reconciled = 1',
      )
      .get(chainId(networkChainId), txHash.toLowerCase()) as { operation_id: string } | undefined;
    return row ? this.operation(row.operation_id) : null;
  }

  operationBySubmission(
    input: Readonly<{
      chainId: number;
      txHash: TransactionHash;
      owner: Address;
      target: Address;
      calldata: HexData;
    }>,
  ): ChainOperation | null {
    const row = this.db
      .prepare(
        `SELECT operation_id FROM chain_transactions
       WHERE chain_id = ? AND tx_hash = ? AND owner_address = ? AND target_address = ? AND calldata = ?
       ORDER BY operation_id LIMIT 1`,
      )
      .get(
        chainId(input.chainId),
        input.txHash.toLowerCase(),
        normalizedAddress(input.owner),
        normalizedAddress(input.target),
        input.calldata.toLowerCase(),
      ) as { operation_id: string } | undefined;
    return row ? this.operation(row.operation_id) : null;
  }

  trackableOperationIds(
    networkChainId: number,
    contract: Address,
    limit = 100,
    after: string | null = null,
  ): readonly string[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new Error('INVALID_OPERATION_QUERY_LIMIT');
    if (after !== null && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(after))
      throw new Error('INVALID_OPERATION_ID');
    const id = chainId(networkChainId);
    const address = normalizedAddress(contract);
    const select = (comparison: '>' | '<=', cursor: string, count: number) =>
      this.db
        .prepare(
          `SELECT operation_id FROM chain_transactions
         WHERE chain_id = ? AND target_address = ?
           AND state IN ('SUBMITTED', 'MINED', 'CONFIRMING', 'REORGED', 'RECONCILIATION_FAILED')
           AND operation_id ${comparison} ?
         ORDER BY operation_id
         LIMIT ?`,
        )
        .all(id, address, cursor, count) as Array<{ operation_id: string }>;
    let rows: Array<{ operation_id: string }>;
    if (after === null) {
      rows = this.db
        .prepare(
          `SELECT operation_id FROM chain_transactions
           WHERE chain_id = ? AND target_address = ?
             AND state IN ('SUBMITTED', 'MINED', 'CONFIRMING', 'REORGED', 'RECONCILIATION_FAILED')
           ORDER BY operation_id
           LIMIT ?`,
        )
        .all(id, address, limit) as Array<{ operation_id: string }>;
    } else {
      rows = select('>', after, limit);
      if (rows.length < limit) rows.push(...select('<=', after, limit - rows.length));
    }
    return Object.freeze(rows.map((row) => row.operation_id));
  }

  saveOperationAtCheckpoint(
    operation: ChainOperation,
    expectedOperation: ChainOperation,
    expectedCheckpoint: ChainCheckpoint,
  ): void {
    validateOperationEvidence(operation);
    if (
      operation.operationId !== expectedOperation.operationId ||
      operation.chainId !== expectedOperation.chainId ||
      !sameAddress(operation.owner, expectedOperation.owner) ||
      !sameAddress(operation.target, expectedOperation.target) ||
      operation.calldata?.toLowerCase() !== expectedOperation.calldata?.toLowerCase() ||
      operation.txHash?.toLowerCase() !== expectedOperation.txHash?.toLowerCase()
    )
      throw new Error('OPERATION_IDENTITY_CONFLICT');
    const id = chainId(operation.chainId);
    const address = normalizedAddress(operation.target);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.#assertSyncOwner(id, address, null);
      const checkpoint = this.db
        .prepare(
          `SELECT block_number, block_hash, projected_block_number, projected_block_hash,
                  sync_healthy, sync_error, sync_target_block_number
           FROM chain_checkpoints WHERE chain_id = ? AND contract_address = ?`,
        )
        .get(id, address) as
        | {
            block_number: number;
            block_hash: string;
            projected_block_number: number | null;
            projected_block_hash: string | null;
            sync_healthy: number;
            sync_error: string | null;
            sync_target_block_number: number | null;
          }
        | undefined;
      if (
        !checkpoint ||
        checkpoint.block_number !== safeNumber(expectedCheckpoint.blockNumber) ||
        checkpoint.block_hash.toLowerCase() !== expectedCheckpoint.blockHash.toLowerCase() ||
        checkpoint.projected_block_number !== checkpoint.block_number ||
        checkpoint.projected_block_hash?.toLowerCase() !== checkpoint.block_hash.toLowerCase() ||
        checkpoint.sync_healthy !== 1 ||
        checkpoint.sync_error !== null ||
        checkpoint.sync_target_block_number !== null
      )
        throw new Error('CHAIN_SYNC_SUPERSEDED');
      const current = this.operation(expectedOperation.operationId);
      if (!current || operationFingerprint(current) !== operationFingerprint(expectedOperation))
        throw new Error('CHAIN_SYNC_SUPERSEDED');
      this.saveOperation(operation);
      this.db.exec('COMMIT');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  commitProjections(
    valueChainId: number,
    contract: Address,
    block: ChainBlock,
    projections: readonly ProductProjection[],
    ownerToken: string | null = null,
  ): void {
    const id = chainId(valueChainId);
    const address = normalizedAddress(contract);
    const blockNumber = safeNumber(block.number);
    const canonical = this.canonicalBlock(id, contract, block.number);
    const checkpoint = this.checkpoint(id, contract);
    if (
      !canonical ||
      canonical.hash.toLowerCase() !== block.hash.toLowerCase() ||
      !checkpoint ||
      checkpoint.blockNumber !== block.number ||
      checkpoint.blockHash.toLowerCase() !== block.hash.toLowerCase()
    )
      throw new Error('PROJECTION_BLOCK_NOT_CANONICAL');
    const keys = new Set<string>();
    for (const projection of projections) {
      if (
        projection.chainId !== id ||
        !sameAddress(projection.contract, contract) ||
        projection.blockNumber > block.number ||
        !namePattern.test(projection.projectionKey)
      )
        throw new Error('INVALID_PROJECTION');
      const projectionBlock = this.canonicalBlock(id, contract, projection.blockNumber);
      if (!projectionBlock || projectionBlock.hash.toLowerCase() !== projection.blockHash.toLowerCase())
        throw new Error('PROJECTION_BLOCK_NOT_CANONICAL');
      const key = `${normalizedAddress(projection.owner)}:${projection.projectionKey}`;
      if (keys.has(key)) throw new Error('DUPLICATE_PROJECTION');
      keys.add(key);
      boundedJson(projection.state);
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.#assertSyncOwner(id, address, ownerToken);
      const currentCanonical = this.canonicalBlock(id, contract, block.number);
      const currentCheckpoint = this.checkpoint(id, contract);
      if (
        !currentCanonical ||
        currentCanonical.hash.toLowerCase() !== block.hash.toLowerCase() ||
        !currentCheckpoint ||
        currentCheckpoint.blockNumber !== block.number ||
        currentCheckpoint.blockHash.toLowerCase() !== block.hash.toLowerCase()
      )
        throw new Error('PROJECTION_BLOCK_NOT_CANONICAL');
      for (const projection of projections) {
        const projectionBlock = this.canonicalBlock(id, contract, projection.blockNumber);
        if (!projectionBlock || projectionBlock.hash.toLowerCase() !== projection.blockHash.toLowerCase())
          throw new Error('PROJECTION_BLOCK_NOT_CANONICAL');
      }
      this.db
        .prepare('DELETE FROM product_projections WHERE chain_id = ? AND contract_address = ?')
        .run(id, address);
      const insert = this.db.prepare(
        'INSERT INTO product_projections (chain_id, owner_address, contract_address, projection_key, block_number, block_hash, state_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const projection of projections) {
        insert.run(
          id,
          normalizedAddress(projection.owner),
          address,
          projection.projectionKey,
          safeNumber(projection.blockNumber),
          projection.blockHash.toLowerCase(),
          boundedJson(projection.state),
        );
      }
      const updated = this.db
        .prepare(
          'UPDATE chain_checkpoints SET projected_block_number = ?, projected_block_hash = ? WHERE chain_id = ? AND contract_address = ? AND block_number = ? AND block_hash = ?',
        )
        .run(blockNumber, block.hash.toLowerCase(), id, address, blockNumber, block.hash.toLowerCase());
      if (updated.changes !== 1) throw new Error('CHAIN_CHECKPOINT_CHANGED');
      this.db.exec('COMMIT');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  projection(
    valueChainId: number,
    owner: Address,
    contract: Address,
    projectionKey: string,
  ): ProductProjection | null {
    const id = chainId(valueChainId);
    const address = normalizedAddress(contract);
    const row = this.db
      .prepare(
        `SELECT checkpoint.block_number AS checkpoint_block_number,
                checkpoint.block_hash AS checkpoint_block_hash,
                checkpoint.projected_block_number,
                checkpoint.projected_block_hash,
                checkpoint.sync_healthy,
                checkpoint.sync_error,
                checkpoint.sync_target_block_number,
                lease.owner_token,
                projection.block_number,
                projection.block_hash,
                projection.state_json
         FROM (SELECT 1) AS seed
         LEFT JOIN chain_checkpoints AS checkpoint
           ON checkpoint.chain_id = ? AND checkpoint.contract_address = ?
         LEFT JOIN chain_sync_leases AS lease
           ON lease.chain_id = ? AND lease.contract_address = ?
         LEFT JOIN product_projections AS projection
           ON projection.chain_id = ? AND projection.owner_address = ?
          AND projection.contract_address = ? AND projection.projection_key = ?`,
      )
      .get(id, address, id, address, id, normalizedAddress(owner), address, projectionKey) as {
      checkpoint_block_number: number | null;
      checkpoint_block_hash: string | null;
      projected_block_number: number | null;
      projected_block_hash: string | null;
      sync_healthy: number | null;
      sync_error: string | null;
      sync_target_block_number: number | null;
      owner_token: string | null;
      block_number: number | null;
      block_hash: string | null;
      state_json: string | null;
    };
    if (row.owner_token !== null) throw new Error('CHAIN_SYNC_UNHEALTHY');
    if (row.checkpoint_block_number === null) {
      if (
        row.checkpoint_block_hash !== null ||
        row.sync_healthy !== null ||
        row.sync_error !== null ||
        row.sync_target_block_number !== null ||
        row.block_number !== null ||
        row.block_hash !== null ||
        row.state_json !== null
      )
        throw new Error('CORRUPT_CHAIN_DATABASE');
      return null;
    }
    const healthValid =
      (row.sync_healthy === 1 && row.sync_error === null && row.sync_target_block_number === null) ||
      (row.sync_healthy === 0 &&
        ['CHAIN_REORG_DEPTH_EXCEEDED', 'CHAIN_REORG_NO_COMMON_ANCESTOR'].includes(row.sync_error ?? '') &&
        row.sync_target_block_number === null) ||
      (row.sync_healthy === 0 &&
        row.sync_error === 'CHAIN_SYNC_INCOMPLETE' &&
        row.sync_target_block_number !== null);
    if (!healthValid || row.checkpoint_block_hash === null) throw new Error('CORRUPT_CHAIN_DATABASE');
    if (row.sync_healthy !== 1) throw new Error('CHAIN_SYNC_UNHEALTHY');
    if (
      row.projected_block_number !== row.checkpoint_block_number ||
      row.projected_block_hash?.toLowerCase() !== row.checkpoint_block_hash.toLowerCase()
    )
      throw new Error('CHAIN_PROJECTION_PENDING');
    if (row.block_number === null && row.block_hash === null && row.state_json === null) return null;
    if (row.block_number === null || row.block_hash === null || row.state_json === null)
      throw new Error('CORRUPT_CHAIN_DATABASE');
    try {
      const state = JSON.parse(row.state_json) as unknown;
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error();
      return Object.freeze({
        chainId: valueChainId,
        owner,
        contract,
        projectionKey,
        blockNumber: BigInt(row.block_number),
        blockHash: asBlockHash(row.block_hash),
        state: Object.freeze(state as Record<string, unknown>),
      });
    } catch {
      throw new Error('CORRUPT_CHAIN_DATABASE');
    }
  }

  operationEvidence(operationId: string, projectionKey: string): ProductOperationEvidence | null {
    this.db.exec('BEGIN');
    try {
      const operation = this.operation(operationId);
      if (!operation) {
        this.db.exec('COMMIT');
        return null;
      }
      const reconciliation =
        operation.state === 'RECONCILIATION_FAILED' ? 'FAILED' : operation.reconciled ? 'MATCHED' : 'PENDING';
      const health = this.syncHealth(operation.chainId, operation.target);
      const indexedCheckpoint = this.checkpoint(operation.chainId, operation.target);
      const indexerStatus: ProductOperationEvidence['indexerStatus'] =
        indexedCheckpoint === null
          ? 'SYNCING'
          : health.healthy
            ? 'HEALTHY'
            : health.error !== 'CHAIN_SYNC_INCOMPLETE'
              ? 'DEGRADED'
              : 'SYNCING';
      let projectionMilestone: ProductOperationEvidence['projection'] = 'PENDING';
      if (operation.state === 'REORGED' || indexerStatus === 'DEGRADED') {
        projectionMilestone = 'STALE';
      } else if (indexerStatus === 'HEALTHY') {
        const projection = this.projection(
          operation.chainId,
          operation.owner,
          operation.target,
          projectionKey,
        );
        if (projection) {
          const checkpoint = indexedCheckpoint;
          let canonicalAncestry =
            operation.canonical &&
            operation.blockNumber !== null &&
            operation.blockHash !== null &&
            projection.chainId === operation.chainId &&
            sameAddress(projection.owner, operation.owner) &&
            sameAddress(projection.contract, operation.target) &&
            checkpoint !== null &&
            projection.blockNumber >= operation.blockNumber! &&
            projection.blockNumber <= checkpoint!.blockNumber;

          if (canonicalAncestry) {
            const start = safeNumber(operation.blockNumber!);
            const end = safeNumber(checkpoint!.blockNumber);
            const expectedBlockCount = end - start + 1;
            canonicalAncestry = expectedBlockCount <= MAX_PRODUCT_EVIDENCE_ANCESTRY_BLOCKS;
            if (canonicalAncestry) {
              const blocks = this.db
                .prepare(
                  `SELECT block_number, block_hash, parent_hash
                   FROM chain_blocks
                   WHERE chain_id = ? AND contract_address = ? AND canonical = 1
                     AND block_number BETWEEN ? AND ?
                   ORDER BY block_number`,
                )
                .iterate(chainId(operation.chainId), normalizedAddress(operation.target), start, end);
              let observedBlockCount = 0;
              let previousHash: string | null = null;
              let projectionWitnessed = false;
              for (const value of blocks) {
                const block = value as unknown as {
                  block_number: number;
                  block_hash: string;
                  parent_hash: string;
                };
                const expectedNumber = start + observedBlockCount;
                if (
                  block.block_number !== expectedNumber ||
                  (observedBlockCount === 0 &&
                    !sameHash(asBlockHash(block.block_hash), operation.blockHash!)) ||
                  (previousHash !== null &&
                    !sameHash(asBlockHash(block.parent_hash), asBlockHash(previousHash)))
                ) {
                  canonicalAncestry = false;
                  break;
                }
                if (BigInt(block.block_number) === projection.blockNumber) {
                  projectionWitnessed = sameHash(asBlockHash(block.block_hash), projection.blockHash);
                }
                previousHash = block.block_hash;
                observedBlockCount++;
              }
              canonicalAncestry =
                canonicalAncestry &&
                observedBlockCount === expectedBlockCount &&
                projectionWitnessed &&
                previousHash !== null &&
                sameHash(asBlockHash(previousHash), checkpoint!.blockHash);
            }
          }
          projectionMilestone = canonicalAncestry ? 'READY' : 'STALE';
        }
      }

      let chainStatus: ProductOperationEvidence['chainStatus'];
      switch (operation.state) {
        case 'AWAITING_SIGNATURE':
        case 'SUBMITTED':
          chainStatus = 'PENDING';
          break;
        case 'MINED':
        case 'CONFIRMING':
          chainStatus = 'INCLUDED';
          break;
        case 'CONFIRMED':
          chainStatus = 'SOFT_READY';
          break;
        case 'REORGED':
          chainStatus = 'REORGED';
          break;
        case 'REJECTED':
        case 'REVERTED':
        case 'REPLACED':
        case 'DROPPED':
        case 'RECONCILIATION_FAILED':
          chainStatus = 'FAILED';
          break;
      }

      const evidence = Object.freeze({
        lifecycle: operation.state,
        receipt: operation.receiptStatus ?? 'PENDING',
        receiptCanonical: operation.receiptStatus !== null && operation.canonical,
        confirmations: operation.confirmations,
        reconciliation,
        projection: projectionMilestone,
        chainStatus,
        l1Status: 'UNKNOWN',
        finalityStatus: 'UNKNOWN',
        indexerStatus,
        degradedReason: health.error === 'CHAIN_SYNC_INCOMPLETE' ? null : health.error,
        productReady:
          operation.state === 'CONFIRMED' &&
          operation.canonical &&
          reconciliation === 'MATCHED' &&
          projectionMilestone === 'READY' &&
          indexerStatus === 'HEALTHY',
      }) satisfies ProductOperationEvidence;
      this.db.exec('COMMIT');
      return evidence;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  rollbackFromBlock(
    valueChainId: number,
    contract: Address,
    fromBlock: bigint,
    ownerToken: string | null = null,
  ): { blocks: number; events: number; operations: number; projections: number } {
    const id = chainId(valueChainId);
    const address = normalizedAddress(contract);
    const number = safeNumber(fromBlock);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.#assertSyncOwner(id, address, ownerToken);
      const blocks = this.db
        .prepare(
          'UPDATE chain_blocks SET canonical = 0 WHERE chain_id = ? AND contract_address = ? AND block_number >= ? AND canonical = 1',
        )
        .run(id, address, number).changes;
      const events = this.db
        .prepare(
          'UPDATE chain_events SET canonical = 0 WHERE chain_id = ? AND contract_address = ? AND block_number >= ? AND canonical = 1',
        )
        .run(id, address, number).changes;
      const operations = this.db
        .prepare(
          `UPDATE chain_transactions SET state = 'REORGED', canonical = 0, reconciled = 0,
            confirmed_at = NULL, error_code = 'CHAIN_REORG'
           WHERE chain_id = ? AND target_address = ? AND block_number >= ?
             AND state IN ('MINED', 'CONFIRMING', 'CONFIRMED', 'REVERTED', 'RECONCILIATION_FAILED')`,
        )
        .run(id, address, number).changes;
      const projections = this.db
        .prepare('DELETE FROM product_projections WHERE chain_id = ? AND contract_address = ?')
        .run(id, address).changes;
      const previous = this.db
        .prepare(
          'SELECT block_number, block_hash FROM chain_blocks WHERE chain_id = ? AND contract_address = ? AND canonical = 1 ORDER BY block_number DESC LIMIT 1',
        )
        .get(id, address) as { block_number: number; block_hash: string } | undefined;
      if (previous) {
        this.db
          .prepare(
            'UPDATE chain_checkpoints SET block_number = ?, block_hash = ?, projected_block_number = NULL, projected_block_hash = NULL WHERE chain_id = ? AND contract_address = ?',
          )
          .run(previous.block_number, previous.block_hash, id, address);
      } else {
        this.db
          .prepare('DELETE FROM chain_checkpoints WHERE chain_id = ? AND contract_address = ?')
          .run(id, address);
      }
      this.db.exec('COMMIT');
      return {
        blocks: Number(blocks),
        events: Number(events),
        operations: Number(operations),
        projections: Number(projections),
      };
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
