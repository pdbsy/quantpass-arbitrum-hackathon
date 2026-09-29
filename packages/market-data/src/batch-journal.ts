import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { requireValue } from './robinhood.ts';
import { validateReferenceBatch } from './batch.ts';
import type { ReferenceBatch } from './batch.ts';
import { openJournalDatabase } from './journal-db.ts';
const digest = (payload: string) => createHash('sha256').update(payload).digest('hex');
const MAX_BYTES = 48 * 1024 * 1024;
/** One immutable row per complete round; this database never holds capital or orders. */
export class BatchJournal {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    this.#db = openJournalDatabase(path, 0x41464d42);
    try {
      this.#db.exec(
        'CREATE TABLE IF NOT EXISTS reference_batches (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, sha256 TEXT NOT NULL);' +
          "CREATE TRIGGER IF NOT EXISTS immutable_batch_update BEFORE UPDATE ON reference_batches BEGIN SELECT RAISE(ABORT,'immutable batch'); END;" +
          "CREATE TRIGGER IF NOT EXISTS immutable_batch_delete BEFORE DELETE ON reference_batches BEGIN SELECT RAISE(ABORT,'immutable batch'); END;",
      );
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }
  append(batch: ReferenceBatch): number {
    validateReferenceBatch(batch);
    const payload = JSON.stringify(batch);
    requireValue(Buffer.byteLength(payload) <= MAX_BYTES, 'BATCH_TOO_LARGE');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const id = Number(
        this.#db
          .prepare('INSERT INTO reference_batches(payload,sha256) VALUES (?,?)')
          .run(payload, digest(payload)).lastInsertRowid,
      );
      requireValue(Number.isSafeInteger(id) && id > 0, 'INVALID_BATCH_ID');
      this.#db.exec('COMMIT');
      return id;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }
  read(id: number): ReferenceBatch {
    requireValue(Number.isSafeInteger(id) && id > 0, 'INVALID_BATCH_ID');
    const row = this.#db.prepare('SELECT payload,sha256 FROM reference_batches WHERE id=?').get(id);
    requireValue(
      row &&
        typeof row.payload === 'string' &&
        Buffer.byteLength(row.payload) <= MAX_BYTES &&
        digest(row.payload) === row.sha256,
      'BATCH_INTEGRITY_FAILED',
    );
    const batch = JSON.parse(row.payload) as ReferenceBatch;
    validateReferenceBatch(batch);
    return batch;
  }
  close(): void {
    this.#db.close();
  }
}
