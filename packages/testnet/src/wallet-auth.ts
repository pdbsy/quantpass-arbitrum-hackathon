import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { verifyMessage } from 'ethers';
import { walletAddress } from './address.ts';
import { loginMessage } from './login-message.ts';
export { walletAddress } from './address.ts';

export interface AuthPolicy {
  readonly challengeTtlMs: number;
  readonly sessionTtlMs: number;
  readonly maxRows: number;
}
const tables = [
  `CREATE TABLE auth_identity (id INTEGER PRIMARY KEY CHECK(id=1), origin TEXT NOT NULL, chain_id INTEGER NOT NULL CHECK(chain_id=46630)) STRICT`,
  `CREATE TABLE auth_challenges (nonce TEXT PRIMARY KEY, owner TEXT NOT NULL, message TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL CHECK(consumed IN(0,1))) STRICT`,
  `CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT`,
];
const time = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000)
    throw new Error('AUTH_TIME');
};
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function verifyWalletMessage(message: string, signature: string, expectedOwner: string): boolean {
  if (message.length > 2048 || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
  try {
    return walletAddress(verifyMessage(message, signature)) === walletAddress(expectedOwner);
  } catch {
    return false;
  }
}

/** Ephemeral login state only. This database contains no ledger, key or execution authority. */
export class WalletAuthStore {
  readonly db: DatabaseSync;
  readonly origin: string;
  readonly policy: AuthPolicy;
  constructor(path: string, origin: string, policy: AuthPolicy) {
    const url = new URL(origin);
    if (
      url.protocol !== 'https:' ||
      url.origin !== origin ||
      url.username ||
      url.password ||
      !Number.isSafeInteger(policy.challengeTtlMs) ||
      policy.challengeTtlMs < 1000 ||
      policy.challengeTtlMs > 300000 ||
      !Number.isSafeInteger(policy.sessionTtlMs) ||
      policy.sessionTtlMs < 1000 ||
      policy.sessionTtlMs > 28800000 ||
      !Number.isSafeInteger(policy.maxRows) ||
      policy.maxRows < 1 ||
      policy.maxRows > 10000
    )
      throw new Error('AUTH_CONFIGURATION');
    this.origin = origin;
    this.policy = Object.freeze({ ...policy });
    this.db = new DatabaseSync(path);
    try {
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      const existing = this.db
        .prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name")
        .all();
      if (version === 0 && existing.length === 0) {
        this.db.exec('BEGIN IMMEDIATE');
        for (const ddl of tables) this.db.exec(ddl);
        this.db.prepare('INSERT INTO auth_identity VALUES(1,?,46630)').run(origin);
        this.db.exec('PRAGMA user_version=1; COMMIT');
      } else {
        const wanted = [...tables].sort();
        const actual = existing.map((row) => String(row.sql)).sort();
        if (version !== 1 || JSON.stringify(actual) !== JSON.stringify(wanted))
          throw new Error('AUTH_DATABASE_SCHEMA');
        const identity = this.db.prepare('SELECT origin,chain_id FROM auth_identity WHERE id=1').get();
        if (identity?.origin !== origin || identity.chain_id !== 46630)
          throw new Error('AUTH_DATABASE_IDENTITY');
        if (this.db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
          throw new Error('AUTH_DATABASE_CORRUPT');
      }
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }
  private prune(now: number) {
    time(now);
    this.db.prepare('DELETE FROM auth_challenges WHERE expires_at<=?').run(now);
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(now);
  }
  private count(table: 'auth_challenges' | 'auth_sessions') {
    return Number(this.db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count);
  }
  issue(address: string, now: number) {
    const owner = walletAddress(address);
    this.prune(now);
    this.db.prepare('DELETE FROM auth_challenges WHERE owner=?').run(owner);
    if (this.count('auth_challenges') >= this.policy.maxRows) throw new Error('AUTH_CAPACITY');
    const nonce = randomBytes(24).toString('hex');
    const expiresAt = now + this.policy.challengeTtlMs;
    time(expiresAt);
    const message = loginMessage(this.origin, owner, nonce, now, expiresAt);
    this.db
      .prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,0)')
      .run(nonce, owner, message, now, expiresAt);
    return Object.freeze({ nonce, message, expiresAt });
  }
  consume(nonce: string, address: string, now: number): Readonly<{ owner: string; message: string }> | null {
    time(now);
    if (!/^[a-f0-9]{48}$/.test(nonce)) return null;
    const owner = walletAddress(address);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare(
          'SELECT message,owner FROM auth_challenges WHERE nonce=? AND owner=? AND consumed=0 AND issued_at<=? AND expires_at>?',
        )
        .get(nonce, owner, now, now);
      if (row) this.db.prepare('UPDATE auth_challenges SET consumed=1 WHERE nonce=?').run(nonce);
      this.db.exec('COMMIT');
      return row ? Object.freeze({ owner, message: String(row.message) }) : null;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  /** Call only after verifying the exact consumed message. Sessions authorize API identity, never funds. */
  createSession(address: string, now: number) {
    const owner = walletAddress(address);
    this.prune(now);
    this.db.prepare('DELETE FROM auth_sessions WHERE owner=?').run(owner);
    if (this.count('auth_sessions') >= this.policy.maxRows) throw new Error('AUTH_CAPACITY');
    const token = randomBytes(32).toString('hex');
    const expiresAt = now + this.policy.sessionTtlMs;
    time(expiresAt);
    this.db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(tokenHash(token), owner, now, expiresAt);
    return Object.freeze({ token, expiresAt });
  }
  owner(token: string, now: number): string | null {
    time(now);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const row = this.db
      .prepare('SELECT owner FROM auth_sessions WHERE token_hash=? AND issued_at<=? AND expires_at>?')
      .get(tokenHash(token), now, now);
    return row ? walletAddress(String(row.owner)) : null;
  }
  logout(token: string) {
    if (/^[a-f0-9]{64}$/.test(token))
      this.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(token));
  }
  close() {
    if (this.db.isOpen) this.db.close();
  }
}
