import { createHash } from 'node:crypto';
import {
  createRun,
  equity,
  returnBps,
  transition,
  releaseSettlementExcess,
} from '../../../packages/automata/src/engine.ts';
import { amount, ENGINE_VERSION } from '../../../packages/automata/src/model.ts';
import type { Action, Parameters, Run } from '../../../packages/automata/src/model.ts';
import { datasetFrames } from '../../../packages/automata/src/fixtures.ts';
import {
  STRATEGY_PROTOCOL,
  validateDecision,
  type StrategyDecision,
} from '../../../packages/automata/src/strategy-protocol.ts';
import {
  assertInvariant,
  balances,
  DomainError,
  type VaultState,
} from '../../../packages/domain/src/vault.ts';
import type { LocalStore } from './store.ts';
import { ZERO_FEE_FULL_SETTLEMENT } from '../../../packages/domain/src/fixtures.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const requireValue = (ok: unknown, code: string) => {
  if (!ok) throw new DomainError(code);
};
const validId = (id: string) =>
  requireValue(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id), 'INVALID_ID');
export interface CreateRun {
  id: string;
  vaultId: string;
  amount: string;
  datasetId: string;
  parameters: Parameters;
}
export type RunCommand = { id: string; expectedRevision: number } & (
  | { type: 'step' | 'stop' | 'pause' | 'resume' }
  | { type: 'fund'; direction: 'in' | 'out'; amount: string }
  | ({ type: 'decision' } & StrategyDecision)
);
interface RecordState {
  state: Run;
  revision: number;
  owner: string;
  vaultId: string;
  datasetId: string;
  datasetHash: string;
  baselineRealized: string;
  creation: string;
  receipts: Record<string, string>;
  settlementReleased?: string;
}
interface Row {
  id: string;
  owner_id: string;
  vault_id: string;
  revision: number;
  active: number;
  json: string;
  digest: string;
}
export class AutomataStore {
  readonly local: LocalStore;
  constructor(local: LocalStore) {
    this.local = local;
    local.db.exec(`CREATE TABLE IF NOT EXISTS automata_schema (version INTEGER PRIMARY KEY CHECK(version=1));
      INSERT OR IGNORE INTO automata_schema VALUES (1);
      CREATE TABLE IF NOT EXISTS automata_runs (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, vault_id TEXT NOT NULL REFERENCES vaults(id),
        revision INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN(0,1)), json TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_automaton ON automata_runs(vault_id) WHERE active=1;`);
  }
  private transaction<T>(fn: () => T): T {
    this.local.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.local.db.exec('COMMIT');
      return value;
    } catch (error) {
      if (this.local.db.isTransaction) this.local.db.exec('ROLLBACK');
      throw error;
    }
  }
  private read(owner: string, id: string): RecordState {
    const row = this.local.db
      .prepare('SELECT * FROM automata_runs WHERE id=? AND owner_id=?')
      .get(id, owner) as unknown as Row | undefined;
    if (!row) throw new DomainError('BOT_NOT_FOUND');
    if (hash(row.json) !== row.digest) throw new Error('CORRUPT_AUTOMATA');
    const record = JSON.parse(row.json) as RecordState;
    if (
      record.owner !== owner ||
      record.vaultId !== row.vault_id ||
      record.state.id !== row.id ||
      record.revision !== row.revision ||
      record.state.version !== ENGINE_VERSION ||
      Number(record.state.status !== 'stopped') !== row.active ||
      record.datasetHash !== hash(JSON.stringify(datasetFrames(record.datasetId)))
    )
      throw new Error('CORRUPT_AUTOMATA');
    return record;
  }
  private view(record: RecordState) {
    return {
      scope: 'TEST_ONLY' as const,
      state: record.state,
      revision: record.revision,
      vaultId: record.vaultId,
      datasetId: record.datasetId,
      datasetHash: record.datasetHash,
      equity: equity(record.state).toString(),
      returnBps: returnBps(record.state),
      settlementReleased: record.settlementReleased ?? '0',
      replayComplete: record.state.cursor >= datasetFrames(record.datasetId).length,
    };
  }
  get(owner: string, id: string) {
    return this.view(this.read(owner, id));
  }
  strategyContext(owner: string, id: string) {
    const view = this.get(owner, id),
      state = view.state;
    return {
      protocol: STRATEGY_PROTOCOL,
      scope: view.scope,
      runId: id,
      revision: view.revision,
      frameSeq: state.cursor,
      clock: state.clock,
      mode: state.parameters.strategyMode ?? 'rebalance',
      status: state.status,
      ready:
        state.parameters.strategyMode === 'external' &&
        state.status === 'running' &&
        !state.trigger &&
        state.cursor > 0,
      cash: state.cash,
      equity: view.equity,
      positions: state.positions,
      quotes: state.quotes,
      eligibleAssets: Object.keys(state.parameters.weights),
      parameters: state.parameters,
      lastDecision: state.lastDecision ?? null,
      replayComplete: view.replayComplete,
    };
  }
  decide(owner: string, id: string, decision: StrategyDecision) {
    return this.command(owner, id, { ...decision, type: 'decision' });
  }
  list(owner: string) {
    return this.local.db
      .prepare('SELECT id FROM automata_runs WHERE owner_id=? ORDER BY rowid DESC LIMIT 50')
      .all(owner)
      .map((row) => this.get(owner, String(row.id)));
  }
  private persist(record: RecordState) {
    const json = JSON.stringify(record);
    this.local.db
      .prepare('UPDATE automata_runs SET revision=?,active=?,json=?,digest=? WHERE id=? AND owner_id=?')
      .run(
        record.revision,
        Number(record.state.status !== 'stopped'),
        json,
        hash(json),
        record.state.id,
        record.owner,
      );
  }
  private checkpoint(record: RecordState, previous: VaultState, idleDelta: bigint) {
    requireValue(previous.revision < 9999, 'TEST_HISTORY_LIMIT');
    const state = record.state;
    const cost = Object.values(state.positions).reduce((n, p) => n + amount(p.cost), 0n);
    const commandId = `bot_${hash(`${state.id}:${record.revision}`).slice(0, 48)}`;
    const next: VaultState = {
      ...previous,
      revision: previous.revision + 1,
      idle: (BigInt(previous.idle) + idleDelta).toString(),
      activeCash: state.cash,
      positionCost: cost.toString(),
      positionValue: (equity(state) - amount(state.cash)).toString(),
      realizedPnl: (BigInt(record.baselineRealized) + BigInt(state.realizedPnl)).toString(),
      status: state.status === 'stopped' ? 'stopped' : state.trigger ? 'stopping' : 'running',
      receipts: {
        ...previous.receipts,
        [commandId]: { fingerprint: hash(JSON.stringify(state)), revision: previous.revision + 1 },
      },
      events: [
        ...previous.events,
        {
          revision: previous.revision + 1,
          commandId,
          type: 'automataCheckpoint',
          actorId: 'local-simulator',
        },
      ],
    };
    assertInvariant(next);
    const json = JSON.stringify(next);
    const result = this.local.db
      .prepare('UPDATE vaults SET revision=?,state_json=?,digest=? WHERE id=? AND owner_id=? AND revision=?')
      .run(next.revision, json, hash(json), next.id, next.ownerId, previous.revision);
    requireValue(result.changes === 1, 'REVISION_CONFLICT');
    this.local.db
      .prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?)')
      .run(
        next.id,
        next.revision,
        commandId,
        'automataCheckpoint',
        'local-simulator',
        new Date().toISOString(),
      );
  }
  create(owner: string, input: CreateRun) {
    validId(input.id);
    validId(input.vaultId);
    const creation = hash(JSON.stringify(input));
    return this.transaction(() => {
      const found = this.local.db.prepare('SELECT owner_id FROM automata_runs WHERE id=?').get(input.id);
      if (found) {
        requireValue(found.owner_id === owner, 'BOT_NOT_FOUND');
        const previous = this.read(owner, input.id);
        requireValue(previous.creation === creation, 'IDEMPOTENCY_CONFLICT');
        return this.view(previous);
      }
      const vault = this.local.get(input.vaultId, owner);
      requireValue(
        vault.status === 'stopped' &&
          vault.activeCash === '0' &&
          vault.positionCost === '0' &&
          vault.feeLiability === '0' &&
          Object.keys(vault.orders).length === 0,
        'BOT_VAULT_NOT_READY',
      );
      const cash = amount(input.amount);
      requireValue(cash <= BigInt(vault.idle), 'INSUFFICIENT_IDLE');
      requireValue(cash <= balances(vault).allowance, 'ALLOWANCE_EXCEEDED');
      requireValue(
        Number(
          this.local.db.prepare('SELECT count(*) AS n FROM automata_runs WHERE owner_id=?').get(owner)?.n,
        ) < 50,
        'BOT_RUN_LIMIT',
      );
      let initial: Run;
      try {
        initial = createRun(input.id, input.amount, input.parameters);
      } catch {
        throw new DomainError('INVALID_REQUEST');
      }
      const record: RecordState = {
        state: initial,
        revision: 0,
        owner,
        vaultId: input.vaultId,
        datasetId: input.datasetId,
        datasetHash: hash(JSON.stringify(datasetFrames(input.datasetId))),
        baselineRealized: vault.realizedPnl,
        creation,
        receipts: {},
      };
      const json = JSON.stringify(record);
      this.local.db
        .prepare('INSERT INTO automata_runs VALUES (?,?,?,?,?,?,?)')
        .run(input.id, owner, input.vaultId, 0, 1, json, hash(json));
      this.checkpoint(record, vault, -cash);
      return this.view(record);
    });
  }
  command(owner: string, id: string, command: RunCommand) {
    validId(command.id);
    return this.transaction(() => {
      const record = this.read(owner, id);
      if (command.type === 'decision') {
        try {
          validateDecision(command, id, Object.keys(record.state.parameters.weights));
        } catch (error) {
          throw new DomainError(error instanceof Error ? error.message : 'INVALID_REQUEST');
        }
      }
      const fingerprint = hash(JSON.stringify(command));
      if (Object.hasOwn(record.receipts, command.id)) {
        requireValue(record.receipts[command.id] === fingerprint, 'IDEMPOTENCY_CONFLICT');
        return this.view(record);
      }
      requireValue(
        Number.isSafeInteger(command.expectedRevision) &&
          command.expectedRevision >= 0 &&
          (command.expectedRevision === record.revision ||
            (command.type === 'stop' && command.expectedRevision < record.revision)),
        'REVISION_CONFLICT',
      );
      if (record.state.status === 'stopped') {
        requireValue(command.type === 'stop', 'INVALID_STATUS');
        return this.view(record);
      }
      requireValue(record.revision < 1000 || command.type === 'stop', 'RUN_HISTORY_LIMIT');
      const vault = this.local.get(record.vaultId, owner);
      let idleDelta = 0n;
      let action: Action;
      if (command.type === 'step') {
        const frame = datasetFrames(record.datasetId)[record.state.cursor];
        requireValue(!!frame, 'REPLAY_COMPLETE');
        action = { type: 'frame', frame: frame! };
      } else if (command.type === 'fund') {
        const cash = amount(command.amount);
        if (command.direction === 'in') {
          requireValue(cash <= BigInt(vault.idle), 'INSUFFICIENT_IDLE');
          requireValue(equity(record.state) + cash <= balances(vault).allowance, 'ALLOWANCE_EXCEEDED');
        }
        idleDelta = command.direction === 'in' ? -cash : cash;
        action = { type: 'fund', amount: command.amount, direction: command.direction };
      } else if (command.type === 'decision') {
        action = { type: 'decision', id: command.id, frameSeq: command.frameSeq, targets: command.targets };
      } else action = { type: command.type };
      const hadPositions = Object.values(record.state.positions).some((p) => amount(p.quantity) > 0n);
      try {
        record.state = transition(record.state, action);
        if (hadPositions && Object.values(record.state.positions).every((p) => amount(p.quantity) === 0n)) {
          const { excessToIdle } = ZERO_FEE_FULL_SETTLEMENT.assess({
            cash: amount(record.state.cash),
            proceeds: 0n,
            cost: 0n,
            existingFeeLiability: 0n,
            allowance: balances(vault).allowance,
          });
          record.state = releaseSettlementExcess(record.state, excessToIdle);
          record.settlementReleased = (BigInt(record.settlementReleased ?? '0') + excessToIdle).toString();
          idleDelta += excessToIdle;
        }
      } catch (error) {
        throw new DomainError(error instanceof Error ? error.message : 'INVALID_REQUEST');
      }
      record.revision++;
      record.receipts[command.id] = fingerprint;
      this.checkpoint(record, vault, idleDelta);
      this.persist(record);
      return this.view(record);
    });
  }
  tick() {
    const failures: string[] = [];
    const rows = this.local.db
      .prepare('SELECT id,owner_id FROM automata_runs WHERE active=1 ORDER BY id LIMIT 20')
      .all();
    for (const row of rows) {
      try {
        const run = this.get(String(row.owner_id), String(row.id));
        if (!run.replayComplete)
          this.command(String(row.owner_id), String(row.id), {
            id: `replay_${run.state.cursor + 1}_${run.revision}`,
            expectedRevision: run.revision,
            type: 'step',
          });
      } catch {
        failures.push(String(row.id));
      }
    }
    return failures;
  }
}
