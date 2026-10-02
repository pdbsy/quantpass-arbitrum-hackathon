import { createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { closeSync, openSync } from 'node:fs';
import type { TradingSnapshot } from './trading-reader.ts';
import type { CanonicalContractEvent } from '../../chain-adapter/src/reconciliation.ts';
import { tradingInterface } from './trading-abi.ts';
import { tradingPerformance } from './trading-performance.ts';

const schema = [
  'CREATE TABLE evidence_identity (id INTEGER PRIMARY KEY CHECK(id=1), configuration_hash TEXT NOT NULL, chain_id INTEGER NOT NULL CHECK(chain_id=46630)) STRICT',
  'CREATE TABLE evidence_raw_events (sequence INTEGER PRIMARY KEY, digest TEXT NOT NULL UNIQUE, payload TEXT NOT NULL) STRICT',
  'CREATE TABLE evidence_event_sets (digest TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT',
  'CREATE TABLE evidence_records (sequence INTEGER PRIMARY KEY, content_hash TEXT NOT NULL UNIQUE, previous_hash TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, captured_at INTEGER NOT NULL, payload TEXT NOT NULL) STRICT',
];
const zero = '0x' + '0'.repeat(64),
  digest = (v: string) => '0x' + createHash('sha256').update(v).digest('hex');
const uint = (v: unknown) => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= 2n ** 256n)
    throw new Error('EVIDENCE_RECONCILIATION');
  return BigInt(v);
};
type StoredEvent = Omit<CanonicalContractEvent, 'blockNumber'> & { blockNumber: string };
interface Payload {
  snapshot: TradingSnapshot;
  eventSetDigest: string;
  performance: ReturnType<typeof tradingPerformance>;
}
function reconcile(snapshot: TradingSnapshot, events: readonly StoredEvent[]) {
  try {
    if (
      snapshot.chainId !== 46630 ||
      snapshot.testAssets !== true ||
      !Number.isSafeInteger(snapshot.maxPriceAge) ||
      snapshot.maxPriceAge < 1 ||
      snapshot.maxPriceAge > 4294967295 ||
      snapshot.stocks.length !== 3 ||
      JSON.stringify(snapshot.stocks.map((s) => s.symbol)) !== JSON.stringify(['MSFT', 'NVDA', 'AAPL'])
    )
      throw new Error();
    const principal = uint(snapshot.principalBasis),
      locked = uint(snapshot.lockedPass),
      cash = uint(snapshot.runtimeCash),
      idle = uint(snapshot.idleCash),
      units = uint(snapshot.runtimeUnits);
    if (locked !== principal * 10n ** 12n) throw new Error();
    let previous: StoredEvent | undefined;
    const seen = new Set<string>();
    for (const event of events) {
      const id = event.transactionHash + ':' + event.logIndex;
      if (
        event.chainId !== 46630 ||
        event.address.toLowerCase() !== snapshot.vault ||
        event.removed ||
        uint(event.blockNumber) > uint(snapshot.blockNumber) ||
        seen.has(id) ||
        !Number.isSafeInteger(event.transactionIndex) ||
        !Number.isSafeInteger(event.logIndex) ||
        event.transactionIndex < 0 ||
        event.logIndex < 0
      )
        throw new Error();
      if (
        previous &&
        (uint(event.blockNumber) < uint(previous.blockNumber) ||
          (event.blockNumber === previous.blockNumber &&
            (event.transactionIndex < previous.transactionIndex ||
              (event.transactionIndex === previous.transactionIndex && event.logIndex <= previous.logIndex))))
      )
        throw new Error();
      const fragment = tradingInterface.getEvent(event.topics[0]!);
      if (!fragment || fragment.name !== event.eventName) throw new Error();
      const decoded = tradingInterface.decodeEventLog(fragment, event.data, [...event.topics]);
      const encoded = tradingInterface.encodeEventLog(fragment, [...decoded]);
      if (
        encoded.data.toLowerCase() !== event.data ||
        JSON.stringify(encoded.topics.map((v) => v.toLowerCase())) !== JSON.stringify(event.topics)
      )
        throw new Error();
      const data: Record<string, unknown> = {};
      fragment.inputs.forEach((v, i) => {
        const value = decoded[i];
        data[v.name] =
          typeof value === 'bigint' ? String(value) : typeof value === 'string' ? value.toLowerCase() : value;
      });
      const entries = (v: Readonly<Record<string, unknown>>) =>
        JSON.stringify(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      if (entries(data) !== entries(event.normalizedData)) throw new Error();
      seen.add(id);
      previous = event;
    }
    const performance = tradingPerformance(events, snapshot.vaultEquity);
    for (const stock of snapshot.stocks) {
      if ((performance.positions.find((p) => p.stock === stock.token)?.quantityRaw ?? '0') !== stock.position)
        throw new Error();
      uint(stock.position);
      uint(stock.priceUsdc);
      uint(stock.observedAt);
      if (!/^0x[0-9a-f]{64}$/.test(stock.sourceDigest)) throw new Error();
      const valid =
        uint(stock.priceUsdc) > 0n &&
        stock.sourceDigest !== zero &&
        uint(stock.observedAt) <= uint(snapshot.blockTimestamp) &&
        uint(snapshot.blockTimestamp) - uint(stock.observedAt) <= BigInt(snapshot.maxPriceAge);
      if (stock.priceValid !== valid) throw new Error();
    }
    if (
      snapshot.closed &&
      (principal !== 0n ||
        locked !== 0n ||
        units !== 0n ||
        cash !== 0n ||
        idle !== 0n ||
        snapshot.stocks.some((s) => s.position !== '0'))
    )
      throw new Error();
    const valid = snapshot.stocks.every((s) => s.position === '0' || s.priceValid);
    const equity = valid
      ? cash + snapshot.stocks.reduce((n, s) => n + (uint(s.position) * uint(s.priceUsdc)) / 10n ** 18n, 0n)
      : null;
    const nav = equity === null ? null : units === 0n ? '0' : String((equity * 10n ** 18n) / units);
    if (
      snapshot.runtimeEquity !== (equity === null ? null : String(equity)) ||
      snapshot.vaultEquity !== (equity === null ? null : String(equity + idle)) ||
      snapshot.unitNav !== nav ||
      snapshot.valuation !== (valid ? 'VALID' : 'STALE_REFERENCE')
    )
      throw new Error();
    return performance;
  } catch {
    throw new Error('EVIDENCE_RECONCILIATION');
  }
}
/** Append-only snapshots retain original raw event encodings and reference digests, including orphaned history. */
export class EvidenceJournal {
  readonly db: DatabaseSync;
  readonly identity: string;
  constructor(path: string, identity: string) {
    if (!/^0x[0-9a-f]{64}$/.test(identity) || identity === zero) throw new Error('EVIDENCE_IDENTITY');
    this.identity = identity;
    this.db = new DatabaseSync(path);
    try {
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      const tables = this.db
        .prepare("SELECT sql FROM sqlite_schema WHERE type='table' ORDER BY name")
        .all()
        .map((v) => String(v.sql))
        .sort();
      if (version === 0 && tables.length === 0) {
        this.db.exec('BEGIN IMMEDIATE');
        for (const ddl of schema) this.db.exec(ddl);
        this.db.prepare('INSERT INTO evidence_identity VALUES(1,?,46630)').run(identity);
        this.db.exec('PRAGMA user_version=2;COMMIT');
      } else {
        if (version !== 2 || JSON.stringify(tables) !== JSON.stringify([...schema].sort()))
          throw new Error('EVIDENCE_SCHEMA');
        if (
          this.db.prepare('SELECT configuration_hash FROM evidence_identity WHERE id=1').get()
            ?.configuration_hash !== identity
        )
          throw new Error('EVIDENCE_IDENTITY');
        if (this.db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
          throw new Error('EVIDENCE_CORRUPT');
      }
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000');
      this.verify();
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }
  append(snapshot: TradingSnapshot, events: readonly CanonicalContractEvent[], capturedAt: number) {
    if (!Number.isSafeInteger(capturedAt) || capturedAt < 0) throw new Error('EVIDENCE_INPUT');
    const stored = events.map((e) => ({ ...e, blockNumber: String(e.blockNumber) }));
    const performance = reconcile(snapshot, stored),
      eventPayloads = stored.map((event) => JSON.stringify(event)),
      setPayload = JSON.stringify(eventPayloads.map(digest)),
      eventSetDigest = digest(setPayload),
      payload = JSON.stringify({ snapshot, eventSetDigest, performance });
    if (
      Buffer.byteLength(setPayload) > 2 * 1024 * 1024 ||
      eventPayloads.some((value) => Buffer.byteLength(value) > 2 * 1024 * 1024)
    )
      throw new Error('EVIDENCE_RECORD_CAPACITY');
    if (Buffer.byteLength(payload) > 2 * 1024 * 1024) throw new Error('EVIDENCE_RECORD_CAPACITY');
    const contentHash = digest(payload);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const eventPayload of eventPayloads) {
        const eventDigest = digest(eventPayload);
        const existingEvent = this.db
          .prepare('SELECT payload FROM evidence_raw_events WHERE digest=?')
          .get(eventDigest);
        if (existingEvent) {
          if (existingEvent.payload !== eventPayload) throw new Error('EVIDENCE_RAW_EVENT_HASH');
        } else {
          this.db
            .prepare('INSERT INTO evidence_raw_events(digest,payload) VALUES(?,?)')
            .run(eventDigest, eventPayload);
        }
      }
      const existingSet = this.db
        .prepare('SELECT payload FROM evidence_event_sets WHERE digest=?')
        .get(eventSetDigest);
      if (existingSet) {
        if (existingSet.payload !== setPayload) throw new Error('EVIDENCE_EVENT_SET_HASH');
      } else {
        this.db.prepare('INSERT INTO evidence_event_sets VALUES(?,?)').run(eventSetDigest, setPayload);
      }
      const existing = this.db
        .prepare('SELECT sequence,hash FROM evidence_records WHERE content_hash=?')
        .get(contentHash);
      if (existing) {
        this.db.exec('COMMIT');
        return Object.freeze({
          sequence: Number(existing.sequence),
          hash: String(existing.hash),
          performance,
        });
      }
      const last = this.db
          .prepare('SELECT sequence,hash FROM evidence_records ORDER BY sequence DESC LIMIT 1')
          .get(),
        sequence = last ? Number(last.sequence) + 1 : 1,
        previous = last ? String(last.hash) : zero;
      const hash = digest(
        JSON.stringify({ identity: this.identity, sequence, previous, capturedAt, payload }),
      );
      this.db
        .prepare('INSERT INTO evidence_records VALUES(?,?,?,?,?,?)')
        .run(sequence, contentHash, previous, hash, capturedAt, payload);
      this.db.exec('COMMIT');
      return Object.freeze({ sequence, hash, performance });
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  eventsFor(eventSetDigest: string): StoredEvent[] {
    if (!/^0x[0-9a-f]{64}$/.test(eventSetDigest)) throw new Error('EVIDENCE_EVENT_SET_HASH');
    const row = this.db.prepare('SELECT payload FROM evidence_event_sets WHERE digest=?').get(eventSetDigest);
    if (!row) throw new Error('EVIDENCE_EVENT_SET_MISSING');
    const payload = String(row.payload);
    if (Buffer.byteLength(payload) > 2 * 1024 * 1024 || digest(payload) !== eventSetDigest)
      throw new Error('EVIDENCE_EVENT_SET_HASH');
    const pointers: unknown = JSON.parse(payload);
    if (!Array.isArray(pointers) || new Set(pointers).size !== pointers.length)
      throw new Error('EVIDENCE_EVENT_SET_INPUT');
    return pointers.map((pointer: unknown) => {
      if (typeof pointer !== 'string' || !/^0x[0-9a-f]{64}$/.test(pointer))
        throw new Error('EVIDENCE_RAW_EVENT_HASH');
      const event = this.db.prepare('SELECT payload FROM evidence_raw_events WHERE digest=?').get(pointer);
      if (!event) throw new Error('EVIDENCE_RAW_EVENT_MISSING');
      const raw = String(event.payload);
      if (Buffer.byteLength(raw) > 2 * 1024 * 1024 || digest(raw) !== pointer)
        throw new Error('EVIDENCE_RAW_EVENT_HASH');
      return JSON.parse(raw) as StoredEvent;
    });
  }
  verify() {
    let rawEvents = 0,
      eventSets = 0;
    for (const row of this.db.prepare('SELECT digest,payload FROM evidence_raw_events').iterate()) {
      if (
        Buffer.byteLength(String(row.payload)) > 2 * 1024 * 1024 ||
        row.digest !== digest(String(row.payload))
      )
        throw new Error('EVIDENCE_RAW_EVENT_HASH');
      rawEvents++;
    }
    const sets = new Map<string, StoredEvent[]>();
    for (const row of this.db.prepare('SELECT digest FROM evidence_event_sets').iterate()) {
      sets.set(String(row.digest), this.eventsFor(String(row.digest)));
      eventSets++;
    }
    let records = 0,
      tip = zero;
    for (const row of this.db.prepare('SELECT * FROM evidence_records ORDER BY sequence').iterate()) {
      const sequence = Number(row.sequence),
        previous = String(row.previous_hash),
        payload = String(row.payload),
        capturedAt = Number(row.captured_at);
      if (
        sequence !== records + 1 ||
        previous !== tip ||
        !Number.isSafeInteger(capturedAt) ||
        capturedAt < 0 ||
        Buffer.byteLength(payload) > 2 * 1024 * 1024 ||
        row.content_hash !== digest(payload) ||
        row.hash !==
          digest(JSON.stringify({ identity: this.identity, sequence, previous, capturedAt, payload }))
      )
        throw new Error('EVIDENCE_HASH_CHAIN');
      const value = JSON.parse(payload) as Payload;
      const events = sets.get(value.eventSetDigest);
      if (!events) throw new Error('EVIDENCE_EVENT_SET_MISSING');
      if (JSON.stringify(reconcile(value.snapshot, events)) !== JSON.stringify(value.performance))
        throw new Error('EVIDENCE_REPLAY_MISMATCH');
      records++;
      tip = String(row.hash);
    }
    return Object.freeze({
      identity: this.identity,
      records,
      rawEvents,
      eventSets,
      tip,
      sourceDigests: 'PRESERVED',
      nav: 'RECOMPUTED',
      cashFlows: 'REPLAYED',
      fills: 'RAW_EVENT_ENCODINGS_VERIFIED',
    });
  }
  async backupTo(target: string) {
    const fd = openSync(target, 'wx', 0o600);
    closeSync(fd);
    await backup(this.db, target);
    return this.verify();
  }
  close() {
    if (this.db.isOpen) this.db.close();
  }
}
