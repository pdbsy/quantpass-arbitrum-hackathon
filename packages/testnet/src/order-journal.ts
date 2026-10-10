import { DatabaseSync } from 'node:sqlite';
import { Transaction, keccak256 } from 'ethers';
import { walletAddress } from './wallet-auth.ts';

export interface OrderIntent {
  readonly purpose?: 'EXECUTE' | 'RISK_CHECK' | 'FEED_UPDATE';
  readonly feed?: string;
  readonly id: string;
  readonly chainId: number;
  readonly owner: string;
  readonly executor: string;
  readonly vault: string;
  readonly manifestDigest: string;
  readonly sourceDigest: string;
  readonly grantVersion: string;
  readonly stateVersion: string;
  readonly snapshotHash: string;
  readonly calldata: string;
  readonly createdAt: number;
}
export type OrderState =
  | 'PREPARED'
  | 'RESERVED'
  | 'SIGNED'
  | 'BROADCAST_UNCERTAIN'
  | 'RECONCILED'
  | 'REVERTED'
  | 'REORGED'
  | 'CANCELLED';
const fields = [
  'id',
  'chainId',
  'owner',
  'executor',
  'vault',
  'manifestDigest',
  'sourceDigest',
  'grantVersion',
  'stateVersion',
  'snapshotHash',
  'calldata',
  'createdAt',
];
const digest = (v: string) => /^0x[0-9a-fA-F]{64}$/.test(v) && !/^0x0+$/.test(v);
const integer = (v: string) => /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 2n ** 256n;
const schema = [
  'CREATE TABLE order_identity (id INTEGER PRIMARY KEY CHECK(id=1), configuration_hash TEXT NOT NULL, chain_id INTEGER NOT NULL CHECK(chain_id=46630)) STRICT',
  "CREATE TABLE orders (id TEXT PRIMARY KEY, executor TEXT NOT NULL, intent TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('PREPARED','RESERVED','SIGNED','BROADCAST_UNCERTAIN','RECONCILED','REVERTED','REORGED','CANCELLED')), nonce TEXT, raw_transaction TEXT, transaction_hash TEXT, evidence TEXT, UNIQUE(executor,nonce)) STRICT",
  'CREATE TABLE order_outcomes (sequence INTEGER PRIMARY KEY, id TEXT NOT NULL, payload TEXT NOT NULL, sha256 TEXT NOT NULL) STRICT',
];
function validate(input: OrderIntent): OrderIntent {
  try {
    if (
      !input ||
      Object.keys(input).length !== fields.length + (input.purpose ? 1 : 0) + (input.feed ? 1 : 0) ||
      Object.keys(input).some((key) => !fields.includes(key) && !['purpose', 'feed'].includes(key)) ||
      (input.purpose !== undefined && !['EXECUTE', 'RISK_CHECK', 'FEED_UPDATE'].includes(input.purpose)) ||
      (input.purpose === 'FEED_UPDATE') !== (input.feed !== undefined) ||
      input.chainId !== 46630 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(input.id) ||
      ![input.manifestDigest, input.sourceDigest, input.snapshotHash].every(digest) ||
      ![input.grantVersion, input.stateVersion].every(integer) ||
      !/^0x(?:[0-9a-fA-F]{2}){4,4096}$/.test(input.calldata) ||
      !Number.isSafeInteger(input.createdAt) ||
      input.createdAt < 0
    )
      throw new Error();
    const owner = walletAddress(input.owner),
      executor = walletAddress(input.executor),
      vault = walletAddress(input.vault);
    if (owner === executor || vault === executor || vault === owner) throw new Error();
    return Object.freeze({
      ...(input.purpose ? { purpose: input.purpose } : {}),
      ...(input.feed ? { feed: walletAddress(input.feed) } : {}),
      id: input.id,
      chainId: 46630,
      owner,
      executor,
      vault,
      manifestDigest: input.manifestDigest.toLowerCase(),
      sourceDigest: input.sourceDigest.toLowerCase(),
      grantVersion: input.grantVersion,
      stateVersion: input.stateVersion,
      snapshotHash: input.snapshotHash.toLowerCase(),
      calldata: input.calldata.toLowerCase(),
      createdAt: input.createdAt,
    });
  } catch {
    throw new Error('ORDER_INPUT');
  }
}
function signedHash(raw: string, order: { intent: OrderIntent; nonce: string | null }): string {
  try {
    if (!/^0x(?:[a-fA-F0-9]{2}){1,16384}$/.test(raw)) throw new Error();
    const tx = Transaction.from(raw);
    if (
      !tx.isSigned() ||
      tx.chainId !== 46630n ||
      tx.from?.toLowerCase() !== order.intent.executor ||
      tx.to?.toLowerCase() !== (order.intent.feed ?? order.intent.vault) ||
      tx.value !== 0n ||
      String(tx.nonce) !== order.nonce ||
      tx.data.toLowerCase() !== order.intent.calldata ||
      !tx.hash ||
      tx.hash !== keccak256(raw)
    )
      throw new Error();
    return tx.hash;
  } catch {
    throw new Error('ORDER_SIGNED_TRANSACTION');
  }
}
/** Separate private executor database. A reserved nonce is never released for automatic retry. */
export class OrderJournal {
  readonly db: DatabaseSync;
  constructor(path: string, configurationHash: string) {
    if (!digest(configurationHash)) throw new Error('ORDER_DATABASE_IDENTITY');
    this.db = new DatabaseSync(path);
    try {
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      const tables = this.db
        .prepare("SELECT sql FROM sqlite_schema WHERE type='table' ORDER BY name")
        .all()
        .map((row) => String(row.sql))
        .sort();
      if (version === 0 && tables.length === 0) {
        this.db.exec('BEGIN IMMEDIATE');
        for (const ddl of schema) this.db.exec(ddl);
        this.db.prepare('INSERT INTO order_identity VALUES(1,?,46630)').run(configurationHash.toLowerCase());
        this.db.exec('PRAGMA user_version=1; COMMIT');
      } else {
        if (version !== 1 || JSON.stringify(tables) !== JSON.stringify([...schema].sort()))
          throw new Error('ORDER_DATABASE_SCHEMA');
        const identity = this.db.prepare('SELECT * FROM order_identity WHERE id=1').get();
        if (identity?.configuration_hash !== configurationHash.toLowerCase() || identity.chain_id !== 46630)
          throw new Error('ORDER_DATABASE_IDENTITY');
        if (this.db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
          throw new Error('ORDER_DATABASE_CORRUPT');
      }
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000');
      this.verifyRows();
      this.verifyOutcomes();
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }
  get(id: string) {
    const row = this.db
      .prepare('SELECT intent,state,nonce,transaction_hash,evidence FROM orders WHERE id=?')
      .get(id);
    return row
      ? Object.freeze({
          intent: validate(JSON.parse(String(row.intent)) as OrderIntent),
          state: String(row.state) as OrderState,
          nonce: row.nonce === null ? null : String(row.nonce),
          transactionHash: row.transaction_hash === null ? null : String(row.transaction_hash),
          evidence: row.evidence === null ? null : String(row.evidence),
        })
      : null;
  }
  prepare(input: OrderIntent) {
    const intent = validate(input);
    const encoded = JSON.stringify(intent);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT intent FROM orders WHERE id=?').get(intent.id);
      if (existing && existing.intent !== encoded) throw new Error('ORDER_ID_CONFLICT');
      if (!existing)
        this.db
          .prepare("INSERT INTO orders(id,executor,intent,state) VALUES(?,?,?,'PREPARED')")
          .run(intent.id, intent.executor, encoded);
      this.db.exec('COMMIT');
      return this.get(intent.id)!;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  blocked(executor: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM orders WHERE executor=? AND state IN('RESERVED','SIGNED','BROADCAST_UNCERTAIN','REORGED') LIMIT 1",
        )
        .get(walletAddress(executor)),
    );
  }
  attempts(): number {
    return Number(this.db.prepare('SELECT count(*) AS n FROM orders WHERE nonce IS NOT NULL').get()!.n);
  }
  /** On restart, corruption cannot turn a reserved nonce into an apparently free executor. */
  private verifyRows() {
    let count = 0;
    for (const row of this.db.prepare('SELECT * FROM orders').iterate()) {
      try {
        if (++count > 1000000 || typeof row.intent !== 'string' || row.intent.length > 32768)
          throw new Error();
        const intent = validate(JSON.parse(row.intent));
        if (row.id !== intent.id || row.executor !== intent.executor) throw new Error();
        const unsigned = ['PREPARED', 'CANCELLED'].includes(String(row.state));
        if (unsigned) {
          if ([row.nonce, row.raw_transaction, row.transaction_hash, row.evidence].some((v) => v !== null))
            throw new Error();
        } else {
          if (typeof row.nonce !== 'string' || !integer(row.nonce) || BigInt(row.nonce) > 2147483647n)
            throw new Error();
          if (row.state === 'RESERVED') {
            if ([row.raw_transaction, row.transaction_hash, row.evidence].some((v) => v !== null))
              throw new Error();
          } else {
            if (
              typeof row.raw_transaction !== 'string' ||
              signedHash(row.raw_transaction, { intent, nonce: row.nonce }) !== row.transaction_hash
            )
              throw new Error();
            if (['SIGNED', 'BROADCAST_UNCERTAIN'].includes(String(row.state)) && row.evidence !== null)
              throw new Error();
            if (
              ['RECONCILED', 'REVERTED', 'REORGED'].includes(String(row.state)) &&
              (typeof row.evidence !== 'string' || !row.evidence || row.evidence.length > 32768)
            )
              throw new Error();
          }
        }
      } catch {
        throw new Error('ORDER_ROW_INTEGRITY');
      }
    }
  }
  verifyOutcomes() {
    const latest = new Map<string, { state: string; evidence: string }>();
    let count = 0;
    for (const row of this.db
      .prepare('SELECT id,payload,sha256 FROM order_outcomes ORDER BY sequence')
      .iterate()) {
      if (
        ++count > 1000000 ||
        typeof row.payload !== 'string' ||
        row.payload.length > 65536 ||
        row.sha256 !== keccak256(new TextEncoder().encode(row.payload))
      )
        throw new Error('ORDER_OUTCOME_INTEGRITY');
      const payload = JSON.parse(row.payload) as { id: string; state: string; evidence: string };
      if (
        payload.id !== row.id ||
        !['RECONCILED', 'REVERTED', 'REORGED'].includes(payload.state) ||
        typeof payload.evidence !== 'string' ||
        !payload.evidence ||
        payload.evidence.length > 32768 ||
        Object.keys(payload).length !== 3 ||
        !this.get(payload.id)
      )
        throw new Error('ORDER_OUTCOME_INTEGRITY');
      latest.set(payload.id, { state: payload.state, evidence: payload.evidence });
    }
    for (const [id, outcome] of latest) {
      const order = this.get(id);
      if (order?.state !== outcome.state || order.evidence !== outcome.evidence)
        throw new Error('ORDER_OUTCOME_INTEGRITY');
    }
    for (const row of this.db
      .prepare("SELECT id FROM orders WHERE state IN('RECONCILED','REVERTED','REORGED')")
      .iterate())
      if (!latest.has(String(row.id))) throw new Error('ORDER_OUTCOME_INTEGRITY');
  }
  reconcileCandidates(after = '') {
    return this.db
      .prepare(
        "SELECT id FROM orders WHERE id>? AND state IN('BROADCAST_UNCERTAIN','RECONCILED','REVERTED','REORGED') ORDER BY id LIMIT 100",
      )
      .all(after)
      .map((row) => this.get(String(row.id))!);
  }
  reserve(id: string, nonce: string) {
    if (!integer(nonce) || BigInt(nonce) > 2147483647n) throw new Error('ORDER_INPUT');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const order = this.get(id);
      if (!order || order.state !== 'PREPARED') throw new Error('ORDER_TRANSITION');
      if (
        this.db.prepare('SELECT 1 FROM orders WHERE executor=? AND nonce=?').get(order.intent.executor, nonce)
      )
        throw new Error('ORDER_NONCE_CONFLICT');
      if (this.blocked(order.intent.executor)) throw new Error('ORDER_EXECUTOR_BLOCKED');
      this.db.prepare("UPDATE orders SET nonce=?,state='RESERVED' WHERE id=?").run(nonce, id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /** Persist and verify the entire signed envelope before a transport can receive it. */
  signed(id: string, raw: string) {
    const order = this.get(id);
    if (!order || order.state !== 'RESERVED') throw new Error('ORDER_TRANSITION');
    try {
      const hash = signedHash(raw, order);
      this.db
        .prepare(
          "UPDATE orders SET raw_transaction=?,transaction_hash=?,state='SIGNED' WHERE id=? AND state='RESERVED'",
        )
        .run(raw, hash, id);
      return hash;
    } catch {
      throw new Error('ORDER_SIGNED_TRANSACTION');
    }
  }
  /** One-shot: the durable uncertain state precedes the send. Lost responses cannot cause another send. */
  claimBroadcast(id: string): string {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare("SELECT raw_transaction,transaction_hash FROM orders WHERE id=? AND state='SIGNED'")
        .get(id);
      if (!row || typeof row.raw_transaction !== 'string') throw new Error('ORDER_TRANSITION');
      const order = this.get(id);
      if (!order || signedHash(row.raw_transaction, order) !== row.transaction_hash)
        throw new Error('ORDER_SIGNED_TRANSACTION');
      this.db.prepare("UPDATE orders SET state='BROADCAST_UNCERTAIN' WHERE id=?").run(id);
      this.db.exec('COMMIT');
      return row.raw_transaction;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /** Canonical evidence is produced by the reconciler, never by a public request. */
  recordOutcome(id: string, state: 'RECONCILED' | 'REVERTED' | 'REORGED', evidence: string) {
    if (evidence.length === 0 || evidence.length > 32768) throw new Error('ORDER_INPUT');
    const order = this.get(id);
    if (!order || !['BROADCAST_UNCERTAIN', 'RECONCILED', 'REVERTED', 'REORGED'].includes(order.state))
      throw new Error('ORDER_TRANSITION');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (order.state !== state || order.evidence !== evidence) {
        const payload = JSON.stringify({ id, state, evidence });
        this.db
          .prepare('INSERT INTO order_outcomes(id,payload,sha256) VALUES(?,?,?)')
          .run(id, payload, keccak256(new TextEncoder().encode(payload)));
      }
      this.db.prepare('UPDATE orders SET state=?,evidence=? WHERE id=?').run(state, evidence, id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  cancel(id: string) {
    if (this.get(id)?.state !== 'PREPARED') throw new Error('ORDER_TRANSITION');
    this.db.prepare("UPDATE orders SET state='CANCELLED' WHERE id=?").run(id);
  }
  close() {
    if (this.db.isOpen) this.db.close();
  }
}
