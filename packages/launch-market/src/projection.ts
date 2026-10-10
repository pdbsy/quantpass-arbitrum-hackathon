import type { LaunchMarketStore } from './store.ts';
import { address, hash, uint } from './config.ts';
import {
  LaunchMarketError,
  type ChainLocation,
  type MarketSnapshot,
  type MarketStreamUpdate,
} from './types.ts';

export interface IndexedMarketClaim {
  readonly accountKey: string;
  readonly wallet: string;
  readonly location: ChainLocation;
}
export type StreamListener = (event: MarketStreamUpdate) => void;
/** Bounded in-process delivery. Durable snapshots, rather than transient messages, recover reconnects. */
export class MarketEventBroker {
  readonly #listeners = new Set<StreamListener>();
  readonly maxConnections: number;
  constructor(maxConnections = 100) {
    this.maxConnections = maxConnections;
  }
  subscribe(listener: StreamListener): () => void {
    if (this.#listeners.size >= this.maxConnections)
      throw new LaunchMarketError('SYNC_CONNECTION_LIMIT', 429);
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  publish(event: MarketStreamUpdate): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        this.#listeners.delete(listener);
      }
    }
  }
  get connections(): number {
    return this.#listeners.size;
  }
  close(): void {
    this.#listeners.clear();
  }
}
export class MarketProjector {
  readonly store: LaunchMarketStore;
  readonly broker: MarketEventBroker;
  constructor(store: LaunchMarketStore, broker = new MarketEventBroker()) {
    this.store = store;
    this.broker = broker;
  }
  latest(): MarketSnapshot | null {
    const row = this.store.db
      .prepare(
        'SELECT payload FROM market_snapshots WHERE chain_id=? AND canonical=1 ORDER BY block_number DESC LIMIT 1',
      )
      .get(this.store.chainId);
    return row ? (JSON.parse(String(row.payload)) as MarketSnapshot) : null;
  }
  history(): readonly { blockNumber: string; blockHash: string }[] {
    return this.store.db
      .prepare(
        'SELECT block_number,block_hash FROM market_snapshots WHERE chain_id=? AND canonical=1 ORDER BY block_number DESC LIMIT 128',
      )
      .all(this.store.chainId)
      .map((row) => ({ blockNumber: String(row.block_number), blockHash: String(row.block_hash) }));
  }
  private version(): string {
    this.store.db.prepare('UPDATE market_projection_version SET version=version+1 WHERE id=1').run();
    return String(
      this.store.db.prepare('SELECT version FROM market_projection_version WHERE id=1').get()!.version,
    );
  }
  commit(
    snapshot: MarketSnapshot,
    parentHash: string,
    previousCanonicalHash: string | null,
    claims: readonly IndexedMarketClaim[] = [],
  ): MarketSnapshot {
    const location = snapshot.location,
      block = uint(location.blockNumber);
    if (
      location.chainId !== this.store.chainId ||
      block > BigInt(Number.MAX_SAFE_INTEGER) ||
      location.confirmations < 1
    )
      throw new LaunchMarketError('INVALID_PROJECTION_LOCATION');
    hash(location.blockHash);
    hash(parentHash);
    for (const market of Object.values(snapshot.markets)) {
      address(market.pass);
      if (market.pool) address(market.pool);
      for (const raw of [
        market.totalSupplyRaw,
        market.publicSupplyRaw,
        market.soldRaw,
        market.remainingRaw,
        market.reservePassRaw,
        market.reserveUsdcRaw,
      ])
        uint(raw);
    }
    if (
      !Number.isInteger(snapshot.claim.successfulClaims) ||
      snapshot.claim.successfulClaims < 0 ||
      snapshot.claim.successfulClaims > 100 ||
      snapshot.claim.remainingClaims !== 100 - snapshot.claim.successfulClaims
    )
      throw new LaunchMarketError('INVALID_CLAIM_PROJECTION');
    const previous = this.latest();
    if (previous) {
      const oldBlock = uint(previous.location.blockNumber);
      if (block < oldBlock) throw new LaunchMarketError('OLD_MARKET_UPDATE');
      if (block === oldBlock && location.blockHash !== previous.location.blockHash)
        throw new LaunchMarketError('REORG_REQUIRED');
      if (
        block > oldBlock &&
        (previousCanonicalHash === null || hash(previousCanonicalHash) !== previous.location.blockHash)
      )
        throw new LaunchMarketError('REORG_REQUIRED');
      if (
        block === oldBlock &&
        JSON.stringify({ ...snapshot, location: previous.location }) === JSON.stringify(previous) &&
        claims.length === 0
      )
        return previous;
    }
    const result = this.store.atomic(() => {
      const next = { ...snapshot, location: { ...location, version: this.version() } };
      this.store.db
        .prepare(
          'INSERT INTO market_snapshots VALUES(?,?,?,?,?,?,1) ON CONFLICT(chain_id,block_number,block_hash) DO UPDATE SET version=excluded.version,payload=excluded.payload,canonical=1',
        )
        .run(
          location.chainId,
          Number(block),
          hash(location.blockHash),
          hash(parentHash),
          Number(next.location.version),
          JSON.stringify(next),
        );
      for (const claim of claims) {
        if (uint(claim.location.blockNumber) > block) throw new LaunchMarketError('FUTURE_CLAIM_EVENT');
        this.store.observeClaim(claim);
      }
      return next;
    });
    this.broker.publish({ type: 'SNAPSHOT', location: result.location, snapshot: result });
    return result;
  }
  /** Caller must establish a common ancestor from canonical RPC block hashes before replay. */
  rollbackFrom(fromBlock: string): MarketSnapshot | null {
    const from = uint(fromBlock);
    if (from > BigInt(Number.MAX_SAFE_INTEGER)) throw new LaunchMarketError('INVALID_PROJECTION_LOCATION');
    const latest = this.store.atomic(() => {
      this.store.rollbackClaims(from);
      this.store.db
        .prepare('UPDATE market_snapshots SET canonical=0 WHERE chain_id=? AND block_number>=?')
        .run(this.store.chainId, Number(from));
      const result = this.latest();
      const version = this.version();
      if (!result) return null;
      const next = { ...result, location: { ...result.location, version } };
      this.store.db
        .prepare(
          'UPDATE market_snapshots SET payload=?,version=? WHERE chain_id=? AND block_number=? AND block_hash=?',
        )
        .run(
          JSON.stringify(next),
          Number(version),
          this.store.chainId,
          Number(uint(result.location.blockNumber)),
          result.location.blockHash,
        );
      return next;
    });
    if (latest) this.broker.publish({ type: 'REORG', location: latest.location, snapshot: latest });
    return latest;
  }
}
