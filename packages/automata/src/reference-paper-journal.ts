import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { openJournalDatabase } from '../../market-data/src/journal-db.ts';
import { BatchJournal } from '../../market-data/src/batch-journal.ts';
import type { BatchEntry } from '../../market-data/src/batch-journal.ts';
import { requireValue } from '../../market-data/src/robinhood.ts';
import { exactFields } from '../../market-data/src/batch.ts';
import { createPaper, parsePaperConfig, applyPaperBatch, fundPaper, stopPaper } from './reference-paper.ts';
import type { PaperState, PaperResult } from './reference-paper.ts';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const MAX_BYTES = 1024 * 1024;
type Command =
  | { type: 'batch'; id: number; sha256: string }
  | { type: 'fund'; direction: 'in' | 'out'; amount6: string; at: number }
  | { type: 'stop'; at: number };
export interface PaperSnapshot {
  revision: number;
  cursor: number;
  lastInputHash: string | null;
  tipHash: string;
  state: PaperState;
}
export class PaperJournal {
  readonly #db: DatabaseSync;
  readonly #source: BatchJournal;
  #snapshot: PaperSnapshot;
  constructor(path: string, input: unknown, source: BatchJournal) {
    const config = parsePaperConfig(input),
      anchor = source.next(0);
    requireValue(anchor, 'PAPER_SOURCE_EMPTY');
    const metadata = JSON.stringify({
      version: 'alphaforge-reference-paper-ledger-1',
      config,
      anchorId: anchor.id,
      anchorHash: anchor.sha256,
    });
    this.#source = source;
    this.#snapshot = {
      revision: 0,
      cursor: 0,
      lastInputHash: null,
      tipHash: hash(metadata),
      state: createPaper(config),
    };
    this.#db = openJournalDatabase(path, 0x41465052);
    try {
      this.#db.exec(
        'CREATE TABLE IF NOT EXISTS paper_meta(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);' +
          'CREATE TABLE IF NOT EXISTS paper_steps(revision INTEGER PRIMARY KEY,payload TEXT NOT NULL,sha256 TEXT NOT NULL,previous_sha256 TEXT NOT NULL);' +
          "CREATE TRIGGER IF NOT EXISTS immutable_paper_meta_update BEFORE UPDATE ON paper_meta BEGIN SELECT RAISE(ABORT,'immutable paper metadata'); END;" +
          "CREATE TRIGGER IF NOT EXISTS immutable_paper_meta_delete BEFORE DELETE ON paper_meta BEGIN SELECT RAISE(ABORT,'immutable paper metadata'); END;" +
          "CREATE TRIGGER IF NOT EXISTS immutable_paper_step_update BEFORE UPDATE ON paper_steps BEGIN SELECT RAISE(ABORT,'immutable paper step'); END;" +
          "CREATE TRIGGER IF NOT EXISTS immutable_paper_step_delete BEFORE DELETE ON paper_steps BEGIN SELECT RAISE(ABORT,'immutable paper step'); END;",
      );
      this.#db.prepare('INSERT OR IGNORE INTO paper_meta(id,payload) VALUES(1,?)').run(metadata);
      const stored = this.#db.prepare('SELECT payload FROM paper_meta WHERE id=1').get();
      requireValue(
        typeof stored?.payload === 'string' && Buffer.byteLength(stored.payload) <= MAX_BYTES,
        'PAPER_METADATA_INTEGRITY',
      );
      const parsed = JSON.parse(stored.payload) as Record<string, unknown>;
      exactFields(parsed, ['version', 'config', 'anchorId', 'anchorHash']);
      requireValue(parsed.version === 'alphaforge-reference-paper-ledger-1', 'PAPER_METADATA_INTEGRITY');
      requireValue(isDeepStrictEqual(parsed.config, config), 'PAPER_CONFIG_MISMATCH');
      requireValue(
        parsed.anchorId === anchor.id && parsed.anchorHash === anchor.sha256,
        'PAPER_SOURCE_MISMATCH',
      );
      requireValue(stored.payload === metadata, 'PAPER_METADATA_INTEGRITY');
      this.refresh();
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }
  refresh(): void {
    if (this.#snapshot.revision > 0) {
      const previous = this.#db
        .prepare('SELECT sha256 FROM paper_steps WHERE revision=?')
        .get(this.#snapshot.revision);
      requireValue(previous?.sha256 === this.#snapshot.tipHash, 'PAPER_STEP_INTEGRITY');
    }
    for (const row of this.#db
      .prepare('SELECT * FROM paper_steps WHERE revision>? ORDER BY revision')
      .iterate(this.#snapshot.revision)) {
      requireValue(
        row.revision === this.#snapshot.revision + 1 && Number.isSafeInteger(row.revision),
        'PAPER_REVISION_INTEGRITY',
      );
      requireValue(
        typeof row.payload === 'string' &&
          Buffer.byteLength(row.payload) <= MAX_BYTES &&
          hash(row.payload) === row.sha256 &&
          row.previous_sha256 === this.#snapshot.tipHash,
        'PAPER_STEP_INTEGRITY',
      );
      const payload = exactFields(JSON.parse(row.payload), ['command', 'result']);
      const next = this.#transition(payload.command as Command);
      requireValue(isDeepStrictEqual(payload.result, next.result), 'PAPER_REPLAY_MISMATCH');
      this.#snapshot = {
        revision: row.revision as number,
        cursor: next.cursor,
        lastInputHash: next.inputHash,
        tipHash: row.sha256 as string,
        state: next.result.state,
      };
    }
  }
  #transition(command: Command): { result: PaperResult; cursor: number; inputHash: string | null } {
    let cursor = this.#snapshot.cursor,
      inputHash = this.#snapshot.lastInputHash,
      result: PaperResult;
    if (command?.type === 'batch') {
      exactFields(command, ['type', 'id', 'sha256']);
      const entry = this.#source.next(cursor);
      requireValue(entry && entry.id === command.id, 'PAPER_INPUT_ORDER');
      requireValue(entry.sha256 === command.sha256, 'PAPER_SOURCE_MISMATCH');
      result = applyPaperBatch(this.#snapshot.state, entry.batch);
      cursor = entry.id;
      inputHash = entry.sha256;
    } else if (command?.type === 'fund') {
      exactFields(command, ['type', 'direction', 'amount6', 'at']);
      result = fundPaper(this.#snapshot.state, command.direction, command.amount6, command.at);
    } else {
      exactFields(command, ['type', 'at']);
      requireValue(command.type === 'stop', 'INVALID_PAPER_COMMAND');
      result = stopPaper(this.#snapshot.state, command.at);
    }
    return { result, cursor, inputHash };
  }
  #append(command: Command): PaperResult {
    const next = this.#transition(command),
      payload = JSON.stringify({ command, result: next.result }),
      revision = this.#snapshot.revision + 1;
    requireValue(
      Number.isSafeInteger(revision) && Buffer.byteLength(payload) <= MAX_BYTES,
      'PAPER_LEDGER_LIMIT',
    );
    const sha256 = hash(payload);
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const tip = this.#db
        .prepare('SELECT revision,sha256 FROM paper_steps ORDER BY revision DESC LIMIT 1')
        .get();
      requireValue(
        (tip?.revision ?? 0) === this.#snapshot.revision && (!tip || tip.sha256 === this.#snapshot.tipHash),
        'PAPER_REVISION_CONFLICT',
      );
      this.#db
        .prepare('INSERT INTO paper_steps(revision,payload,sha256,previous_sha256) VALUES(?,?,?,?)')
        .run(revision, payload, sha256, this.#snapshot.tipHash);
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
    this.#snapshot = {
      revision,
      cursor: next.cursor,
      lastInputHash: next.inputHash,
      tipHash: sha256,
      state: next.result.state,
    };
    return structuredClone(next.result);
  }
  consume(entry: BatchEntry): PaperResult {
    return this.#append({ type: 'batch', id: entry.id, sha256: entry.sha256 });
  }
  fund(direction: 'in' | 'out', amount6: string, at: number): PaperResult {
    return this.#append({ type: 'fund', direction, amount6, at });
  }
  stop(at: number): PaperResult {
    return this.#append({ type: 'stop', at });
  }
  snapshot(): PaperSnapshot {
    return structuredClone(this.#snapshot);
  }
  close(): void {
    this.#db.close();
  }
}
