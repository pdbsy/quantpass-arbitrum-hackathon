import { mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalStore } from '../apps/server/src/store.ts';
import { readConfig } from '../packages/config/src/index.ts';

readConfig(process.env);
const source = resolve('.data/demo.sqlite');
await access(source); // A backup must never silently create an empty source database.
await mkdir('.data/backups', { recursive: true });
const target = resolve('.data/backups', `demo-${Date.now()}-${randomUUID()}.sqlite`);
const original = new LocalStore(source);
try {
  await original.backupTo(target);
} finally {
  original.close();
}
const restored = new LocalStore(target);
try {
  const integrity = restored.db.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (integrity !== 'ok') throw new Error('BACKUP_INTEGRITY_FAILED');
  const owners = restored.db.prepare('SELECT DISTINCT owner_id FROM vaults').all();
  for (const row of owners) restored.list(String(row.owner_id));
  console.log(`TEST_ONLY backup reopened and validated: ${target}`);
  console.log('The active database was not replaced. Do not copy a live WAL database manually.');
} finally {
  restored.close();
}
