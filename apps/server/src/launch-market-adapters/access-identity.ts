import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyRequest } from 'fastify';

export interface TrustedVerifiedIdentity {
  email: string;
  subject: string;
  verified: true;
}

// Only existing Google-verified sessions qualify. The website login and demo cookie
// have no verified email and never authorize a voucher. No request identity header is trusted.
export class AccessIdentityBridge {
  readonly #db: DatabaseSync;
  readonly #now: () => number;
  constructor(dbPath: string, now = () => Math.floor(Date.now() / 1000)) {
    this.#db = new DatabaseSync(dbPath, { readOnly: true });
    this.#now = now;
  }

  identity(request: FastifyRequest): TrustedVerifiedIdentity | null {
    const token = request.cookies['__Host-ikol_session'];
    if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
    const hash = createHash('sha256').update(token).digest('hex');
    const now = this.#now();
    const row = this.#db
      .prepare(
        `SELECT s.email,s.subject,s.csrf_token
      FROM sessions s JOIN whitelist w ON w.email=s.email
      JOIN identities i ON i.email=s.email AND i.subject=s.subject
      WHERE s.token_hash=? AND s.expires_at>?
      AND NOT EXISTS (SELECT 1 FROM revoked_sessions r
        WHERE r.token_hash=s.token_hash AND r.expires_at>?)`,
      )
      .get(hash, now, now);
    if (!row || typeof row.email !== 'string' || typeof row.subject !== 'string') return null;
    if (!['GET', 'HEAD'].includes(request.method)) {
      const supplied = request.headers['x-csrf-token'];
      if (typeof supplied !== 'string' || typeof row.csrf_token !== 'string') return null;
      const a = Buffer.from(supplied);
      const b = Buffer.from(row.csrf_token);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    }
    return { email: row.email, subject: row.subject, verified: true };
  }

  /** The console remains authoritative. Missing, malformed or unavailable policy requires verification. */
  verificationRequired(): boolean {
    try {
      return (
        this.#db.prepare('SELECT value FROM metadata WHERE key=?').get('access_verification_required')
          ?.value !== '0'
      );
    } catch {
      return true;
    }
  }

  close(): void {
    this.#db.close();
  }
}
