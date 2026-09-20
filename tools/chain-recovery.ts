import { closeSync, openSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

type RecoveryOperation = 'backup' | 'restore';

const expectedTables = [
  'chain_blocks',
  'chain_checkpoints',
  'chain_events',
  'chain_sync_leases',
  'chain_transactions',
  'product_projections',
];

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

function validatedSnapshot(database: DatabaseSync, code: string): string {
  const version = Number(database.prepare('PRAGMA user_version').get()?.user_version);
  const tables = (
    database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map(({ name }) => name);
  const integrity = database.prepare('PRAGMA quick_check').get()?.quick_check;
  if (version !== 6 || JSON.stringify(tables) !== JSON.stringify(expectedTables) || integrity !== 'ok')
    throw new Error(code);
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
  const expectedSnapshot = validatedSnapshot(sourceDatabase, 'CHAIN_RECOVERY_SOURCE_UNSUPPORTED');
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
  const recovered = new DatabaseSync(target, { readOnly: true });
  try {
    const recoveredSnapshot = validatedSnapshot(recovered, 'CHAIN_RECOVERY_TARGET_UNHEALTHY');
    if (recoveredSnapshot !== expectedSnapshot) throw new Error('CHAIN_RECOVERY_CONTENT_MISMATCH');
  } finally {
    recovered.close();
  }
  sourceDatabase.exec('COMMIT');
  console.log(
    JSON.stringify({ operation, status: 'HEALTHY', schemaVersion: 6, integrity: 'OK', content: 'MATCH' }),
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
