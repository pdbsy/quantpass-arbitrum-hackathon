import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { requireValue } from './robinhood.ts';
import { validateReferenceBatch } from './batch.ts';
import type { ReferenceBatch } from './batch.ts';
import { openJournalDatabase, backupJournalDatabase } from './journal-db.ts';
import { encodeBatchPayload, decodeBatchPayload, MAX_BATCH_BYTES } from './batch-codec.ts';
const digest = (payload: string) => createHash('sha256').update(payload).digest('hex');
const MAX_BYTES = MAX_BATCH_BYTES;
export interface BatchEntry {
  id: number;
  sha256: string;
  batch: ReferenceBatch;
}
/** One immutable row per complete round; this database never holds capital or orders. */
export class BatchJournal {
  readonly #db: DatabaseSync;
  readonly #readOnly: boolean;
  /** Private service backup integration only; never returned by an HTTP route. */
  get database(): DatabaseSync {
    return this.#db;
  }
  constructor(path: string, options: { readOnly?: boolean } = {}) {
    this.#readOnly = options.readOnly === true;
    this.#db = openJournalDatabase(path, 0x41464d42, this.#readOnly);
    try {
      if (this.#readOnly) {
        this.#db.prepare('SELECT id,payload,sha256 FROM reference_batches LIMIT 0').all();
        return;
      }
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
    requireValue(!this.#readOnly, 'JOURNAL_READ_ONLY');
    validateReferenceBatch(batch);
    const payload = JSON.stringify(batch);
    requireValue(Buffer.byteLength(payload) <= MAX_BYTES, 'BATCH_TOO_LARGE');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const id = Number(
        this.#db
          .prepare('INSERT INTO reference_batches(payload,sha256) VALUES (?,?)')
          .run(encodeBatchPayload(payload), digest(payload)).lastInsertRowid,
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
    return this.entry(id).batch;
  }
  entry(id: number): BatchEntry {
    requireValue(Number.isSafeInteger(id) && id > 0, 'INVALID_BATCH_ID');
    const row = this.#db.prepare('SELECT payload,sha256 FROM reference_batches WHERE id=?').get(id);
    requireValue(row, 'BATCH_INTEGRITY_FAILED');
    const payload = decodeBatchPayload(row.payload);
    requireValue(digest(payload) === row.sha256, 'BATCH_INTEGRITY_FAILED');
    const batch = JSON.parse(payload) as ReferenceBatch;
    validateReferenceBatch(batch);
    return { id, sha256: row.sha256 as string, batch };
  }
  next(after: number): BatchEntry | null {
    requireValue(Number.isSafeInteger(after) && after >= 0, 'INVALID_BATCH_ID');
    const row = this.#db
      .prepare('SELECT id FROM reference_batches WHERE id>? ORDER BY id LIMIT 1')
      .get(after);
    return row ? this.entry(row.id as number) : null;
  }
  backupTo(path: string): Promise<number> {
    return backupJournalDatabase(this.#db, path);
  }
  checkpoint(): void {
    this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  close(): void {
    this.#db.close();
  }
}
