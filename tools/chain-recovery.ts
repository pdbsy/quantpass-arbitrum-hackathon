import { closeSync, openSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { ChainStore } from '../apps/server/src/chain-store.ts';

type RecoveryOperation = 'backup' | 'restore';

function schemaDefinition(database: DatabaseSync): string {
  // Stored DDL includes constraints and index predicates that column lists cannot establish.
  return JSON.stringify(
    database
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name",
      )
      .all(),
  );
}

function canonicalSchemaDefinition(version: number): string {
  if (version !== 6 && version !== 7) throw new Error('CHAIN_RECOVERY_SOURCE_UNSUPPORTED');
  if (version === 6) {
    const reference = new DatabaseSync(':memory:');
    try {
      for (const migration of [
        '001-chain-projection.sql',
        '002-projection-checkpoint.sql',
        '003-sync-target.sql',
        '004-sync-lease.sql',
        '005-transaction-index.sql',
        '006-operation-calldata.sql',
      ])
        reference.exec(
          readFileSync(new URL(`../apps/server/chain-migrations/${migration}`, import.meta.url), 'utf8'),
        );
      return schemaDefinition(reference);
    } finally {
      reference.close();
    }
  }
  // Only this independent in-memory reference is initialized; recovery inputs stay read-only.
  const reference = new ChainStore(':memory:');
  try {
    return schemaDefinition(reference.db);
  } finally {
    reference.close();
  }
}

function databaseSnapshot(database: DatabaseSync): string {
  const tables = (
    database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map(({ name }) => name);
  return JSON.stringify(
    tables.map((name) => ({
      name,
      rows: database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all(),
    })),
  );
}

function validatedSnapshot(
  database: DatabaseSync,
  expectedSchema: string,
  expectedVersion: number,
  code: string,
): string {
  const version = Number(database.prepare('PRAGMA user_version').get()?.user_version);
  if (version !== expectedVersion || schemaDefinition(database) !== expectedSchema) throw new Error(code);
  if (database.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error(code);
  return databaseSnapshot(database);
}

const [operationValue, sourceValue, targetValue, ...extra] = process.argv.slice(2);
if (
  (operationValue !== 'backup' && operationValue !== 'restore') ||
  !sourceValue ||
  !targetValue ||
  extra.length
)
  throw new Error('USAGE: chain-recovery.ts <backup|restore> <source> <new-destination>');

const operation = operationValue as RecoveryOperation;
const source = resolve(sourceValue);
const target = resolve(targetValue);
if (source === target) throw new Error('CHAIN_RECOVERY_PATH_CONFLICT');
const sourceDatabase = new DatabaseSync(source, { readOnly: true });
let targetCreated = false;
try {
  sourceDatabase.exec('BEGIN');
  const sourceVersion = Number(sourceDatabase.prepare('PRAGMA user_version').get()?.user_version);
  const expectedSchema = canonicalSchemaDefinition(sourceVersion);
  const expectedSnapshot = validatedSnapshot(
    sourceDatabase,
    expectedSchema,
    sourceVersion,
    'CHAIN_RECOVERY_SOURCE_UNSUPPORTED',
  );
  try {
    const targetDescriptor = openSync(target, 'wx', 0o600);
    targetCreated = true;
    closeSync(targetDescriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('CHAIN_RECOVERY_TARGET_EXISTS', { cause: error });
    throw error;
  }
  await backup(sourceDatabase, target);
  // SQLite on the pinned runtime skips CHECK validation for read-only handles.
  // Inspect only our newly created copy with a write-capable handle, then deny
  // SQL mutations. The original source remains opened read-only throughout.
  const recovered = new DatabaseSync(target);
  try {
    recovered.exec('PRAGMA query_only=ON');
    const recoveredSnapshot = validatedSnapshot(
      recovered,
      expectedSchema,
      sourceVersion,
      'CHAIN_RECOVERY_TARGET_UNHEALTHY',
    );
    if (recoveredSnapshot !== expectedSnapshot) throw new Error('CHAIN_RECOVERY_CONTENT_MISMATCH');
  } finally {
    recovered.close();
  }
  sourceDatabase.exec('COMMIT');
  console.log(
    JSON.stringify({
      operation,
      status: 'HEALTHY',
      schemaVersion: sourceVersion,
      integrity: 'OK',
      content: 'MATCH',
    }),
  );
} catch (error) {
  if (sourceDatabase.isTransaction) sourceDatabase.exec('ROLLBACK');
  if (targetCreated) {
    try {
      await rm(target);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'CHAIN_RECOVERY_FAILED_CLEANUP_FAILED', {
        cause: cleanupError,
      });
    }
  }
  throw error;
} finally {
  sourceDatabase.close();
}
