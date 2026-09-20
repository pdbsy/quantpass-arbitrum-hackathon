import { access, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ChainStore } from '../apps/server/src/chain-store.ts';

type RecoveryOperation = 'backup' | 'restore';

function databaseSnapshot(store: ChainStore): string {
  const tables = (
    store.db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map(({ name }) => name);
  return JSON.stringify(
    tables.map((name) => ({
      name,
      rows: store.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all(),
    })),
  );
}

function requireHealthy(store: ChainStore): void {
  const health = store.health();
  if (health.status !== 'HEALTHY' || health.schemaVersion !== 6 || health.integrity !== 'OK')
    throw new Error('CHAIN_RECOVERY_DATABASE_UNHEALTHY');
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
await access(source);

const original = new ChainStore(source);
let expectedSnapshot: string;
try {
  requireHealthy(original);
  expectedSnapshot = databaseSnapshot(original);
  await original.backupTo(target);
} finally {
  original.close();
}

let verified = false;
const recovered = new ChainStore(target);
try {
  requireHealthy(recovered);
  if (databaseSnapshot(recovered) !== expectedSnapshot) throw new Error('CHAIN_RECOVERY_CONTENT_MISMATCH');
  verified = true;
  console.log(
    JSON.stringify({ operation, status: 'HEALTHY', schemaVersion: 6, integrity: 'OK', content: 'MATCH' }),
  );
} finally {
  recovered.close();
  if (!verified) await rm(target, { force: true });
}
