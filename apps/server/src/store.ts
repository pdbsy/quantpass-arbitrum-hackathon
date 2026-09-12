import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createVault,
  restoreVault,
  execute,
  DomainError,
  type VaultState,
  type Actor,
  type Command,
  type SettlementPolicy,
} from '../../../packages/domain/src/vault.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
interface Row {
  id: string;
  owner_id: string;
  strategy_id: string;
  revision: number;
  state_json: string;
  digest: string;
}

export class LocalStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;',
    );
    try {
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      if (version === 0) {
        const existing = this.db
          .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all();
        if (existing.length) throw new Error('REFUSING_UNKNOWN_DATABASE');
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.exec(readFileSync(new URL('../migrations/001-local-ledger.sql', import.meta.url), 'utf8'));
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      } else if (version !== 1) throw new Error('UNSUPPORTED_DATABASE_VERSION');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  private decode(row: Row): VaultState {
    if (digest(row.state_json) !== row.digest) throw new Error('CORRUPT_LEDGER');
    let state: VaultState;
    try {
      state = restoreVault(row.state_json);
    } catch {
      // Invalid persisted state is an internal failure, never a client command conflict.
      throw new Error('CORRUPT_LEDGER');
    }
    if (
      state.id !== row.id ||
      state.ownerId !== row.owner_id ||
      state.strategyId !== row.strategy_id ||
      state.revision !== row.revision
    )
      throw new Error('CORRUPT_LEDGER');
    return state;
  }
  get(id: string, owner: string): VaultState {
    const row = this.db
      .prepare('SELECT * FROM vaults WHERE id = ? AND owner_id = ?')
      .get(id, owner) as unknown as Row | undefined;
    if (!row) throw new DomainError('VAULT_NOT_FOUND');
    return this.decode(row);
  }
  list(owner: string): VaultState[] {
    return (
      this.db.prepare('SELECT * FROM vaults WHERE owner_id = ? ORDER BY id').all(owner) as unknown as Row[]
    ).map((row) => this.decode(row));
  }
  *owned(owner: string): IterableIterator<VaultState> {
    for (const row of this.db.prepare('SELECT * FROM vaults WHERE owner_id = ? ORDER BY id').iterate(owner))
      yield this.decode(row as unknown as Row);
  }
  forStrategy(owner: string, strategyId: string): VaultState {
    const row = this.db
      .prepare('SELECT * FROM vaults WHERE owner_id = ? AND strategy_id = ?')
      .get(owner, strategyId) as unknown as Row | undefined;
    if (!row) throw new DomainError('VAULT_NOT_FOUND');
    return this.decode(row);
  }
  listPage(owner: string, options: { limit: number; after?: string; strategyId?: string }) {
    const rows = this.db
      .prepare(
        'SELECT * FROM vaults WHERE owner_id = ? AND id > ? AND (? IS NULL OR strategy_id = ?) ORDER BY id LIMIT ?',
      )
      .all(
        owner,
        options.after ?? '',
        options.strategyId ?? null,
        options.strategyId ?? null,
        options.limit + 1,
      ) as unknown as Row[];
    const items = rows.slice(0, options.limit).map((row) => this.decode(row));
    return { items, nextCursor: rows.length > options.limit ? items.at(-1)!.id : null };
  }
  obtainTestPasses(owner: string, strategy: string): VaultState {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare('SELECT * FROM vaults WHERE owner_id = ? AND strategy_id = ?')
        .get(owner, strategy) as unknown as Row | undefined;
      if (row) {
        const existing = this.decode(row);
        this.db.exec('COMMIT');
        return existing;
      }
      const state = createVault({
        scope: 'TEST_ONLY',
        id: `vault_${randomUUID()}`,
        ownerId: owner,
        executorId: 'local-simulator',
        strategyId: strategy,
        passes: '1000',
      });
      const json = JSON.stringify(state);
      this.db
        .prepare(
          'INSERT INTO vaults (id, owner_id, strategy_id, revision, state_json, digest) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(state.id, owner, strategy, 0, json, digest(json));
      this.db.exec('COMMIT');
      return state;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  command(
    owner: string,
    id: string,
    actor: Actor,
    command: Command,
    policy?: SettlementPolicy,
  ): { state: VaultState; replayed: boolean } {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.get(id, owner);
      const state = execute(previous, actor, command, policy);
      if (state === previous) {
        this.db.exec('COMMIT');
        return { state, replayed: true };
      }
      const json = JSON.stringify(state);
      const update = this.db
        .prepare(
          'UPDATE vaults SET revision = ?, state_json = ?, digest = ? WHERE id = ? AND owner_id = ? AND revision = ?',
        )
        .run(state.revision, json, digest(json), id, owner, previous.revision);
      if (update.changes !== 1) throw new DomainError('REVISION_CONFLICT');
      this.db
        .prepare(
          'INSERT INTO audit_events (vault_id, revision, command_id, command_type, actor_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, state.revision, command.id, command.type, actor.id, new Date().toISOString());
      this.db.exec('COMMIT');
      return { state, replayed: false };
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  audit(owner: string, id: string) {
    this.get(id, owner);
    return this.db
      .prepare(
        'SELECT revision, command_id, command_type, actor_id, recorded_at FROM audit_events WHERE vault_id = ? ORDER BY revision DESC LIMIT 100',
      )
      .all(id);
  }
  auditPage(owner: string, id: string, options: { limit: number; beforeRevision?: number }) {
    this.get(id, owner);
    const rows = this.db
      .prepare(
        'SELECT revision, command_id, command_type, actor_id, recorded_at FROM audit_events WHERE vault_id = ? AND revision < ? ORDER BY revision DESC LIMIT ?',
      )
      .all(id, options.beforeRevision ?? 10001, options.limit + 1);
    const items = rows.slice(0, options.limit);
    return { items, nextCursor: rows.length > options.limit ? String(items.at(-1)!.revision) : null };
  }
  async backupTo(target: string) {
    const path = resolve(target);
    // Reserve the exact destination exclusively; never overwrite an existing backup.
    try {
      closeSync(openSync(path, 'wx', 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('BACKUP_TARGET_EXISTS', { cause: error });
      throw error;
    }
    await backup(this.db, path);
    return path;
  }
}
