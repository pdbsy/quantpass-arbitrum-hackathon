import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { normalizeReference, parseRegistry, requireValue, validateSelection } from './robinhood.ts';
import type { ReferenceObservation, Selection } from './robinhood.ts';
export type ReadTransport = (url: string, init: RequestInit) => Promise<Response>;
export interface SourceReceipt {
  url: string;
  receivedAt: number;
  body: string;
  sha256: string;
}
export interface ReferenceCapture {
  version: 'alphaforge-reference-1';
  status: 'ACCEPTED' | 'REJECTED';
  reason: string | null;
  selection: Selection;
  maxAgeMs: number;
  sources: SourceReceipt[];
  observation: ReferenceObservation | null;
}
const MAX_BYTES = 4 * 1024 * 1024;
const digest = (body: string) => createHash('sha256').update(body).digest('hex');
async function read(
  url: string,
  transport: ReadTransport,
  now: () => number,
  receipts: SourceReceipt[],
): Promise<unknown> {
  let response: Response;
  try {
    response = await transport(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new Error('HTTP_TRANSPORT_FAILED');
  }
  requireValue(response.ok && !response.redirected, 'HTTP_RESPONSE_REJECTED');
  requireValue(response.body, 'HTTP_EMPTY_BODY');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      requireValue(bytes <= MAX_BYTES, 'HTTP_BODY_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new Error('HTTP_INVALID_UTF8');
  }
  const receivedAt = now();
  requireValue(Number.isSafeInteger(receivedAt) && receivedAt >= 0, 'INVALID_CLOCK');
  receipts.push({ url, receivedAt, body, sha256: digest(body) });
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('HTTP_INVALID_JSON');
  }
}
export async function captureReference(
  selection: Selection,
  maxAgeMs: number,
  transport: ReadTransport = fetch,
  now: () => number = Date.now,
): Promise<ReferenceCapture> {
  const result: ReferenceCapture = {
    version: 'alphaforge-reference-1',
    status: 'REJECTED',
    reason: null,
    selection,
    maxAgeMs,
    sources: [],
    observation: null,
  };
  try {
    const requested = validateSelection(selection);
    result.selection = requested;
    requireValue(Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0, 'INVALID_TIME_POLICY');
    const first = parseRegistry(
      await read('https://api.robinhood.com/rhj/assets', transport, now, result.sources),
    );
    const rawQuote = await read(
      `https://api.robinhood.com/rhj/prices/${requested.symbol}`,
      transport,
      now,
      result.sources,
    );
    const last = parseRegistry(
      await read('https://api.robinhood.com/rhj/assets', transport, now, result.sources),
    );
    const receivedAt = result.sources[2]!.receivedAt;
    requireValue(
      result.sources.every(
        (receipt, i) => i === 0 || receipt.receivedAt >= result.sources[i - 1]!.receivedAt,
      ),
      'CLOCK_REGRESSION',
    );
    const a = normalizeReference(first, rawQuote, requested, receivedAt, maxAgeMs);
    const b = normalizeReference(last, rawQuote, requested, receivedAt, maxAgeMs);
    requireValue(JSON.stringify(a) === JSON.stringify(b), 'REGISTRY_CHANGED_DURING_CAPTURE');
    result.observation = b;
    result.status = 'ACCEPTED';
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    result.reason = /^[A-Z][A-Z0-9_]{1,80}$/.test(message) ? message : 'CAPTURE_FAILED';
  }
  return result;
}
// Recompute, do not trust a stored projection merely because its payload was hashed.
// This verifies consistency; source authenticity still depends on the trusted collector.
export function replayReference(capture: ReferenceCapture): ReferenceObservation {
  requireValue(
    capture?.version === 'alphaforge-reference-1' && capture.status === 'ACCEPTED' && capture.reason === null,
    'CAPTURE_NOT_ACCEPTED',
  );
  const selection = validateSelection(capture.selection);
  requireValue(Number.isSafeInteger(capture.maxAgeMs) && capture.maxAgeMs > 0, 'INVALID_TIME_POLICY');
  requireValue(Array.isArray(capture.sources) && capture.sources.length === 3, 'INVALID_CAPTURE_SOURCES');
  const urls = [
    'https://api.robinhood.com/rhj/assets',
    `https://api.robinhood.com/rhj/prices/${selection.symbol}`,
    'https://api.robinhood.com/rhj/assets',
  ];
  for (let i = 0; i < capture.sources.length; i++) {
    const source = capture.sources[i]!;
    requireValue(source && source.url === urls[i], 'SOURCE_IDENTITY_MISMATCH');
    requireValue(
      typeof source.body === 'string' &&
        Buffer.byteLength(source.body) <= MAX_BYTES &&
        digest(source.body) === source.sha256,
      'SOURCE_INTEGRITY_FAILED',
    );
    requireValue(
      Number.isSafeInteger(source.receivedAt) &&
        source.receivedAt >= 0 &&
        (i === 0 || source.receivedAt >= capture.sources[i - 1]!.receivedAt),
      'CLOCK_REGRESSION',
    );
  }
  const [before, quote, after] = capture.sources;
  const a = normalizeReference(
    parseRegistry(JSON.parse(before!.body)),
    JSON.parse(quote!.body),
    selection,
    after!.receivedAt,
    capture.maxAgeMs,
  );
  const b = normalizeReference(
    parseRegistry(JSON.parse(after!.body)),
    JSON.parse(quote!.body),
    selection,
    after!.receivedAt,
    capture.maxAgeMs,
  );
  requireValue(isDeepStrictEqual(a, b), 'REGISTRY_CHANGED_DURING_CAPTURE');
  requireValue(isDeepStrictEqual(b, capture.observation), 'OBSERVATION_MISMATCH');
  return b;
}

// Dedicated collector database. It never connects to the Vault ledger.
export class MarketJournal {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    const full = resolve(path);
    requireValue(realpathSync(dirname(full)) === dirname(full), 'JOURNAL_PARENT_SYMLINK');
    let existing = false;
    for (const item of [full, full + '-wal', full + '-shm']) {
      try {
        const stat = lstatSync(item);
        if (item === full) existing = true;
        requireValue(stat.isFile() && stat.nlink === 1, 'JOURNAL_UNSAFE_FILE');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (existing) {
      const probe = new DatabaseSync(full, { readOnly: true });
      try {
        requireValue(
          probe.prepare('PRAGMA application_id').get()?.application_id === 0x41464d44,
          'JOURNAL_IDENTITY_MISMATCH',
        );
      } finally {
        probe.close();
      }
    }
    this.#db = new DatabaseSync(full);
    this.#db.exec(`PRAGMA application_id=0x41464d44; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS reference_captures (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, sha256 TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS immutable_capture_update BEFORE UPDATE ON reference_captures BEGIN SELECT RAISE(ABORT,'immutable capture'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_capture_delete BEFORE DELETE ON reference_captures BEGIN SELECT RAISE(ABORT,'immutable capture'); END;`);
  }
  append(capture: ReferenceCapture): number {
    if (capture.status === 'ACCEPTED') replayReference(capture);
    const payload = JSON.stringify(capture);
    requireValue(Buffer.byteLength(payload) <= MAX_BYTES * 4, 'CAPTURE_TOO_LARGE');
    return Number(
      this.#db
        .prepare('INSERT INTO reference_captures(payload,sha256) VALUES (?,?)')
        .run(payload, digest(payload)).lastInsertRowid,
    );
  }
  read(id: number): ReferenceCapture {
    requireValue(Number.isSafeInteger(id) && id > 0, 'INVALID_CAPTURE_ID');
    const row = this.#db.prepare('SELECT payload,sha256 FROM reference_captures WHERE id=?').get(id);
    requireValue(
      row && typeof row.payload === 'string' && digest(row.payload) === row.sha256,
      'CAPTURE_INTEGRITY_FAILED',
    );
    const capture = JSON.parse(row.payload) as ReferenceCapture;
    requireValue(
      capture.sources.every((source) => digest(source.body) === source.sha256),
      'SOURCE_INTEGRITY_FAILED',
    );
    if (capture.status === 'ACCEPTED') replayReference(capture);
    return capture;
  }
  close(): void {
    this.#db.close();
  }
}
