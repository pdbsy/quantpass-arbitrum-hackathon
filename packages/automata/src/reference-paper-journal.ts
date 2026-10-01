import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { openJournalDatabase, backupJournalDatabase } from '../../market-data/src/journal-db.ts';
import { BatchJournal } from '../../market-data/src/batch-journal.ts';
import type { BatchEntry } from '../../market-data/src/batch-journal.ts';
import { requireValue } from '../../market-data/src/robinhood.ts';
import { exactFields } from '../../market-data/src/batch.ts';
import {
  createPaper,
  parsePaperConfig,
  applyPaperBatch,
  fundPaper,
  stopPaper,
  paperAmount,
} from './reference-paper.ts';
import type { PaperState, PaperResult, PaperEvent } from './reference-paper.ts';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const MAX_BYTES = 1024 * 1024;
export interface PaperControl {
  id: string;
  expectedRevision: number;
  action: { type: 'fund'; direction: 'in' | 'out'; amount6: string } | { type: 'stop' };
}
export function parsePaperControl(input: unknown): PaperControl {
  const r = exactFields(input, ['id', 'expectedRevision', 'action']);
  requireValue(typeof r.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(r.id), 'INVALID_PAPER_CONTROL');
  requireValue(
    Number.isSafeInteger(r.expectedRevision) && (r.expectedRevision as number) >= 0,
    'INVALID_PAPER_CONTROL',
  );
  const action = r.action as Record<string, unknown>;
  if (action?.type === 'fund') {
    exactFields(action, ['type', 'direction', 'amount6']);
    requireValue(action.direction === 'in' || action.direction === 'out', 'INVALID_PAPER_CONTROL');
    paperAmount(action.amount6, true);
  } else {
    exactFields(action, ['type']);
    requireValue(action.type === 'stop', 'INVALID_PAPER_CONTROL');
  }
  return structuredClone(r) as unknown as PaperControl;
}
type Command =
  | { type: 'batch'; id: number; sha256: string }
  | { type: 'fund'; direction: 'in' | 'out'; amount6: string; at: number }
  | { type: 'stop'; at: number }
  | { type: 'control'; request: PaperControl; at: number };
export interface PaperSnapshot {
  revision: number;
  cursor: number;
  lastInputHash: string | null;
  tipHash: string;
  state: PaperState;
}
export interface PaperHistory {
  items: { revision: number; events: PaperEvent[] }[];
  nextBefore: number | null;
}
export class PaperJournal {
  readonly #db: DatabaseSync;
  readonly #source: BatchJournal;
  #snapshot: PaperSnapshot;
  #ready = false;
  #replaying = false;
  constructor(
    path: string,
    input: unknown,
    source: BatchJournal,
    options: { owner?: string; deferReplay?: boolean } = {},
  ) {
    const config = parsePaperConfig(input),
      anchor = source.next(0);
    requireValue(anchor, 'PAPER_SOURCE_EMPTY');
    requireValue(
      options.owner === undefined || /^[a-zA-Z0-9_-]{1,80}$/.test(options.owner),
      'INVALID_PAPER_OWNER',
    );
    const meta = {
      version: 'alphaforge-reference-paper-ledger-1',
      config,
      anchorId: anchor.id,
      anchorHash: anchor.sha256,
      ...(options.owner === undefined ? {} : { owner: options.owner }),
    };
    const metadata = JSON.stringify(meta);
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
          'CREATE TABLE IF NOT EXISTS paper_fill_steps(revision INTEGER PRIMARY KEY REFERENCES paper_steps(revision));' +
          "CREATE TRIGGER IF NOT EXISTS immutable_paper_meta_update BEFORE UPDATE ON paper_meta BEGIN SELECT RAISE(ABORT,'immutable paper metadata'); END;" +
          "CREATE TRIGGER IF NOT EXISTS immutable_paper_meta_delete BEFORE DELETE ON paper_meta BEGIN SELECT RAISE(ABORT,'immutable paper metadata'); END;" +
          "CREATE TRIGGER IF NOT EXISTS immutable_paper_step_update BEFORE UPDATE ON paper_steps BEGIN SELECT RAISE(ABORT,'immutable paper step'); END;" +
          "CREATE TRIGGER IF NOT EXISTS immutable_paper_step_delete BEFORE DELETE ON paper_steps BEGIN SELECT RAISE(ABORT,'immutable paper step'); END;" +
          "CREATE UNIQUE INDEX IF NOT EXISTS paper_control_id ON paper_steps(json_extract(payload,'$.command.request.id')) WHERE json_extract(payload,'$.command.type')='control';",
      );
      this.#db.prepare('INSERT OR IGNORE INTO paper_meta(id,payload) VALUES(1,?)').run(metadata);
      const stored = this.#db.prepare('SELECT payload FROM paper_meta WHERE id=1').get();
      requireValue(
        typeof stored?.payload === 'string' && Buffer.byteLength(stored.payload) <= MAX_BYTES,
        'PAPER_METADATA_INTEGRITY',
      );
      const parsed = JSON.parse(stored.payload) as Record<string, unknown>;
      requireValue(parsed.owner === options.owner, 'PAPER_OWNER_MISMATCH');
      exactFields(
        parsed,
        options.owner === undefined
          ? ['version', 'config', 'anchorId', 'anchorHash']
          : ['version', 'config', 'anchorId', 'anchorHash', 'owner'],
      );
      requireValue(parsed.version === meta.version, 'PAPER_METADATA_INTEGRITY');
      requireValue(isDeepStrictEqual(parsed.config, config), 'PAPER_CONFIG_MISMATCH');
      requireValue(
        parsed.anchorId === anchor.id && parsed.anchorHash === anchor.sha256,
        'PAPER_SOURCE_MISMATCH',
      );
      requireValue(stored.payload === metadata, 'PAPER_METADATA_INTEGRITY');
      if (!options.deferReplay) this.refresh();
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }
  *#replayRows(): Generator<void> {
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
      this.#indexFills(row.revision as number, next.result);
      this.#snapshot = {
        revision: row.revision as number,
        cursor: next.cursor,
        lastInputHash: next.inputHash,
        tipHash: row.sha256 as string,
        state: next.result.state,
      };
      yield;
    }
  }
  refresh(): void {
    requireValue(!this.#replaying, 'PAPER_REPLAY_REQUIRED');
    this.#ready = false;
    for (const _ of this.#replayRows()) {
      void _;
    }
    this.#ready = true;
  }
  async replayAsync(signal: AbortSignal): Promise<void> {
    requireValue(!this.#replaying, 'PAPER_REPLAY_REQUIRED');
    this.#replaying = true;
    this.#ready = false;
    const rows = this.#replayRows();
    try {
      for (;;) {
        requireValue(!signal.aborted, 'PAPER_REPLAY_CANCELLED');
        if (rows.next().done) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      this.#ready = true;
    } finally {
      rows.return(undefined);
      this.#replaying = false;
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
    } else if (command?.type === 'control') {
      exactFields(command, ['type', 'request', 'at']);
      const request = parsePaperControl(command.request);
      requireValue(
        request.action.type === 'stop'
          ? request.expectedRevision <= this.#snapshot.revision
          : request.expectedRevision === this.#snapshot.revision,
        'PAPER_REVISION_CONFLICT',
      );
      result =
        request.action.type === 'stop'
          ? stopPaper(this.#snapshot.state, command.at)
          : fundPaper(this.#snapshot.state, request.action.direction, request.action.amount6, command.at);
    } else {
      exactFields(command, ['type', 'at']);
      requireValue(command.type === 'stop', 'INVALID_PAPER_COMMAND');
      result = stopPaper(this.#snapshot.state, command.at);
    }
    return { result, cursor, inputHash };
  }
  #append(command: Command): PaperResult {
    requireValue(this.#ready, 'PAPER_REPLAY_REQUIRED');
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
      this.#indexFills(revision, next.result);
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
  control(input: unknown, at: number): { revision: number; replayed: boolean } {
    const request = parsePaperControl(input);
    const previous = this.receipt(request);
    if (previous) return previous;
    this.#append({ type: 'control', request, at });
    return { revision: this.#snapshot.revision, replayed: false };
  }
  receipt(input: unknown): { revision: number; replayed: true } | null {
    requireValue(this.#ready, 'PAPER_REPLAY_REQUIRED');
    const request = parsePaperControl(input);
    this.refresh();
    const row = this.#db
      .prepare(
        "SELECT revision,payload,sha256 FROM paper_steps WHERE json_extract(payload,'$.command.type')='control' AND json_extract(payload,'$.command.request.id')=?",
      )
      .get(request.id);
    if (!row) return null;
    requireValue(typeof row.payload === 'string' && hash(row.payload) === row.sha256, 'PAPER_STEP_INTEGRITY');
    const command = (JSON.parse(row.payload) as { command: Command }).command;
    requireValue(
      command.type === 'control' && isDeepStrictEqual(command.request, request),
      'PAPER_CONTROL_CONFLICT',
    );
    return { revision: row.revision as number, replayed: true };
  }
  history(before?: number, limit = 100): PaperHistory {
    requireValue(this.#ready, 'PAPER_REPLAY_REQUIRED');
    requireValue(
      before === undefined || (Number.isSafeInteger(before) && before > 0),
      'INVALID_PAPER_HISTORY',
    );
    requireValue(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, 'INVALID_PAPER_HISTORY');
    const rows = this.#db
      .prepare(
        'SELECT revision,payload,sha256 FROM paper_steps WHERE revision<? ORDER BY revision DESC LIMIT ?',
      )
      .all(before ?? Number.MAX_SAFE_INTEGER, limit + 1);
    const items = rows.slice(0, limit).map((row) => {
      requireValue(
        typeof row.payload === 'string' &&
          Buffer.byteLength(row.payload) <= MAX_BYTES &&
          hash(row.payload) === row.sha256,
        'PAPER_STEP_INTEGRITY',
      );
      const payload = JSON.parse(row.payload) as { result: PaperResult };
      return { revision: row.revision as number, events: payload.result.events };
    });
    return { items, nextBefore: rows.length > limit ? items.at(-1)!.revision : null };
  }
  #indexFills(revision: number, result: PaperResult): void {
    if (result.events.some((e) => e.kind === 'FILL'))
      this.#db.prepare('INSERT OR IGNORE INTO paper_fill_steps(revision) VALUES(?)').run(revision);
  }
  /** Rebuildable index only; the immutable, verified step remains the source of each fill. */
  fills(limit = 20): PaperHistory['items'] {
    requireValue(this.#ready, 'PAPER_REPLAY_REQUIRED');
    requireValue(Number.isSafeInteger(limit) && limit > 0 && limit <= 50, 'INVALID_PAPER_HISTORY');
    const rows = this.#db
      .prepare(
        'SELECT s.revision,s.payload,s.sha256 FROM paper_fill_steps f JOIN paper_steps s ON s.revision=f.revision ORDER BY s.revision DESC LIMIT ?',
      )
      .all(limit);
    return rows.map((row) => {
      requireValue(
        typeof row.payload === 'string' &&
          Buffer.byteLength(row.payload) <= MAX_BYTES &&
          hash(row.payload) === row.sha256,
        'PAPER_STEP_INTEGRITY',
      );
      const result = (JSON.parse(row.payload) as { result: PaperResult }).result;
      const events = result.events.filter((e) => e.kind === 'FILL');
      requireValue(events.length > 0, 'PAPER_FILL_INDEX_INTEGRITY');
      return { revision: row.revision as number, events };
    });
  }
  backupTo(path: string): Promise<number> {
    return backupJournalDatabase(this.#db, path);
  }
  checkpoint(): void {
    this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  snapshot(): PaperSnapshot {
    requireValue(this.#ready, 'PAPER_REPLAY_REQUIRED');
    return structuredClone(this.#snapshot);
  }
  close(): void {
    this.#db.close();
  }
}
