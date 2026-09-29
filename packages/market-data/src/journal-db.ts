import { lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { requireValue } from './robinhood.ts';
/** Dedicated collector DB only; identity prevents connecting to a Vault or another journal. */
export function openJournalDatabase(path: string, applicationId: number): DatabaseSync {
  requireValue(
    Number.isSafeInteger(applicationId) && applicationId > 0 && applicationId <= 2147483647,
    'INVALID_JOURNAL_APPLICATION_ID',
  );
  const full = resolve(path);
  requireValue(realpathSync(dirname(full)) === dirname(full), 'JOURNAL_PARENT_SYMLINK');
  let existing = false;
  for (const item of [full, full + '-wal', full + '-shm']) {
    try {
      const stat = lstatSync(item);
      if (item === full) existing = true;
      requireValue(stat.isFile() && stat.nlink === 1, 'JOURNAL_UNSAFE_FILE');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (existing) {
    const probe = new DatabaseSync(full, { readOnly: true });
    try {
      requireValue(
        probe.prepare('PRAGMA application_id').get()?.application_id === applicationId,
        'JOURNAL_IDENTITY_MISMATCH',
      );
    } finally {
      probe.close();
    }
  }
  const db = new DatabaseSync(full);
  try {
    db.exec(
      'PRAGMA application_id=' + applicationId + '; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;',
    );
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
