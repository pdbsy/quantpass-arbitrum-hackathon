import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import {
  closeSync,
  copyFileSync,
  constants,
  fstatSync,
  readSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRegularBytes } from './bounded-file.ts';
import { EvidenceJournal } from './evidence-journal.ts';
import { OrderJournal } from './order-journal.ts';
import { BatchJournal } from '../../market-data/src/batch-journal.ts';
import { createReferenceEngine, advanceReferenceEngine, type ReferenceTerms } from './reference-engine.ts';
import type { privateServerStorage } from './private-storage.ts';

interface Source {
  readonly referenceTerms?: readonly ReferenceTerms[];
  readonly name: string;
  readonly db: DatabaseSync;
  readonly evidenceIdentity?: string;
}
interface Tables {
  readonly [name: string]: { rows: number; sha256: string };
}
interface BackupFile {
  referenceTerms?: readonly ReferenceTerms[];
  name: string;
  bytes: number;
  sha256: string;
  tables: Tables;
  evidenceIdentity: string | null;
}
export interface ServerBackupReport {
  schemaVersion: 1;
  id: string;
  identity: string;
  createdAt: number;
  kind: 'MANUAL' | 'AUTOMATIC';
  state: 'VERIFIED';
  files: BackupFile[];
}
const namePattern = /^[a-z][a-z0-9-]{0,63}$/;
function safeFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path || stat.size > 8e9)
    throw new Error('BACKUP_FILE_UNSAFE');
  return stat;
}
function fileDigest(path: string) {
  const before = safeFile(path),
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile() || opened.nlink !== 1)
      throw new Error('BACKUP_CHANGED');
    const buffer = Buffer.alloc(65536),
      digest = createHash('sha256');
    let size = 0,
      n: number;
    while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, n));
      size += n;
    }
    const after = fstatSync(fd),
      current = safeFile(path);
    if (
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      current.dev !== before.dev ||
      current.ino !== before.ino
    )
      throw new Error('BACKUP_CHANGED');
    return digest.digest('hex');
  } finally {
    closeSync(fd);
  }
}
function fingerprints(db: DatabaseSync): Tables {
  if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
    throw new Error('BACKUP_DATABASE_CORRUPT');
  const tables: Record<string, { rows: number; sha256: string }> = {};
  for (const row of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").iterate()) {
    const name = String(row.name);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error('BACKUP_SCHEMA');
    const columns = db
      .prepare(`PRAGMA table_info("${name}")`)
      .all()
      .map((c) => String(c.name));
    if (!columns.length || columns.some((c) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(c)))
      throw new Error('BACKUP_SCHEMA');
    const digest = createHash('sha256');
    let rows = 0;
    for (const data of db
      .prepare(`SELECT * FROM "${name}" ORDER BY ${columns.map((c) => `"${c}"`).join(',')}`)
      .iterate()) {
      if (++rows > 1000000) throw new Error('BACKUP_ROW_CAPACITY');
      digest.update(JSON.stringify(data) + '\n');
    }
    tables[name] = { rows, sha256: digest.digest('hex') };
  }
  return tables;
}
async function verifyFiles(folder: string, report: ServerBackupReport) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-backup-restore-')));
  try {
    const seen = new Set<string>();
    const replay: Record<string, unknown>[] = [];
    for (const file of report.files) {
      if (
        !namePattern.test(file.name) ||
        seen.has(file.name) ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 ||
        !/^[a-f0-9]{64}$/.test(file.sha256)
      )
        throw new Error('BACKUP_MANIFEST');
      seen.add(file.name);
      const source = join(folder, file.name + '.sqlite'),
        stat = safeFile(source);
      if (stat.size !== file.bytes || fileDigest(source) !== file.sha256)
        throw new Error('BACKUP_DIGEST_MISMATCH');
      const target = join(scratch, file.name + '.sqlite');
      copyFileSync(source, target, constants.COPYFILE_EXCL);
      const copied = new DatabaseSync(target, { readOnly: true });
      try {
        if (JSON.stringify(fingerprints(copied)) !== JSON.stringify(file.tables))
          throw new Error('BACKUP_ROW_MISMATCH');
      } finally {
        copied.close();
      }
      if (file.evidenceIdentity) {
        const evidence = new EvidenceJournal(target, file.evidenceIdentity);
        try {
          replay.push({ name: file.name, ...evidence.verify() });
        } finally {
          evidence.close();
        }
      }
      if (file.name === 'orders') {
        const orders = new OrderJournal(target, report.identity);
        try {
          orders.verifyOutcomes();
          replay.push({
            name: file.name,
            attempts: orders.attempts(),
            outcomes: Number(orders.db.prepare('SELECT count(*) AS n FROM order_outcomes').get()!.n),
            integrity: 'VERIFIED',
          });
        } finally {
          orders.close();
        }
      }
      if (file.name === 'reference-batches') {
        if (!file.referenceTerms) throw new Error('BACKUP_REFERENCE_TERMS');
        const batches = new BatchJournal(target, { readOnly: true });
        try {
          let engine = createReferenceEngine(file.referenceTerms);
          for (let entry = batches.next(0); entry; entry = batches.next(entry.id))
            engine = advanceReferenceEngine(engine, entry.batch).state;
          replay.push({
            name: file.name,
            lastMinute: engine.lastMinute,
            ema: engine.ema,
            terms: engine.terms,
            referencePaused: engine.paused,
            sourceDigests: 'VERIFIED',
          });
        } finally {
          batches.close();
        }
      }
      const after = safeFile(source);
      if (after.dev !== stat.dev || after.ino !== stat.ino || fileDigest(source) !== file.sha256)
        throw new Error('BACKUP_CHANGED');
    }
    return Object.freeze({
      state: 'VERIFIED' as const,
      id: report.id,
      createdAt: report.createdAt,
      files: report.files.length,
      originalBackups: 'UNCHANGED',
      restore: 'INDEPENDENT_TEMPORARY_COPIES',
      replay,
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
function validateReport(report: ServerBackupReport, identity: string) {
  if (!report || typeof report !== 'object') throw new Error('BACKUP_MANIFEST');
  if (
    Object.keys(report).length !== 7 ||
    Object.keys(report).some(
      (k) => !['schemaVersion', 'id', 'identity', 'createdAt', 'kind', 'state', 'files'].includes(k),
    ) ||
    report.schemaVersion !== 1 ||
    report.identity !== identity ||
    report.state !== 'VERIFIED' ||
    !/^[a-f0-9-]{36}$/.test(report.id) ||
    !Number.isSafeInteger(report.createdAt) ||
    report.createdAt < 0 ||
    !['MANUAL', 'AUTOMATIC'].includes(report.kind) ||
    !Array.isArray(report.files) ||
    report.files.length < 1 ||
    report.files.length > 64
  )
    throw new Error('BACKUP_MANIFEST');
  for (const file of report.files) {
    if (
      !file ||
      typeof file !== 'object' ||
      Object.keys(file).some(
        (k) => !['name', 'bytes', 'sha256', 'tables', 'evidenceIdentity', 'referenceTerms'].includes(k),
      ) ||
      Object.keys(file).length !== 5 + (file.referenceTerms ? 1 : 0) ||
      !namePattern.test(file.name) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 1 ||
      file.bytes > 8e9 ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      (file.evidenceIdentity !== null && !/^0x[a-f0-9]{64}$/.test(file.evidenceIdentity)) ||
      !file.tables ||
      typeof file.tables !== 'object' ||
      Array.isArray(file.tables)
    )
      throw new Error('BACKUP_MANIFEST');
  }
  if (new Set(report.files.map((f) => f.name)).size !== report.files.length)
    throw new Error('BACKUP_MANIFEST');
}
export async function verifyServerBackup(folder: string, identity: string) {
  if (realpathSync(folder) !== folder || !lstatSync(folder).isDirectory())
    throw new Error('BACKUP_DIRECTORY');
  const path = join(folder, 'manifest.json'),
    stat = safeFile(path);
  if (stat.size > 262144) throw new Error('BACKUP_MANIFEST');
  const report = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(path)),
  ) as ServerBackupReport;
  validateReport(report, identity);
  return verifyFiles(folder, report);
}
/** The host quiesces all ledger writers around create(). No historical backup is deleted. */
export class ServerBackups {
  readonly storage: ReturnType<typeof privateServerStorage>;
  readonly identity: string;
  readonly sources: readonly Source[];
  #last: ServerBackupReport | null = null;
  #running = false;
  #failure: string | null = null;
  #verified = false;
  constructor(
    storage: ReturnType<typeof privateServerStorage>,
    identity: string,
    sources: readonly Source[],
  ) {
    if (
      !/^0x[0-9a-f]{64}$/.test(identity) ||
      !sources.length ||
      sources.length > 64 ||
      new Set(sources.map((s) => s.name)).size !== sources.length ||
      sources.some((s) => !namePattern.test(s.name))
    )
      throw new Error('BACKUP_CONFIGURATION');
    this.storage = storage;
    this.identity = identity;
    this.sources = sources;
    const root = join(storage.folder, 'backups');
    try {
      const stat = lstatSync(root);
      if (!stat.isDirectory() || realpathSync(root) !== root) throw new Error('BACKUP_DIRECTORY');
      for (const id of readdirSync(root)) {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('BACKUP_DIRECTORY');
        const path = join(root, id, 'manifest.json');
        try {
          const size = safeFile(path).size;
          if (size > 262144) throw new Error('BACKUP_MANIFEST');
          const report = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(path)),
          ) as ServerBackupReport;
          validateReport(report, identity);
          if (
            JSON.stringify(
              report.files
                .map((f) => ({
                  name: f.name,
                  evidenceIdentity: f.evidenceIdentity,
                  referenceTerms: f.referenceTerms ?? null,
                }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            ) !==
            JSON.stringify(
              sources
                .map((f) => ({
                  name: f.name,
                  evidenceIdentity: f.evidenceIdentity ?? null,
                  referenceTerms: f.referenceTerms ?? null,
                }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            )
          )
            throw new Error('BACKUP_SOURCE_IDENTITY');
          if (
            report.identity !== identity ||
            report.id !== id ||
            report.state !== 'VERIFIED' ||
            !Number.isSafeInteger(report.createdAt)
          )
            throw new Error('BACKUP_IDENTITY');
          if (!this.#last || report.createdAt > this.#last.createdAt) this.#last = report;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  status() {
    return Object.freeze({
      lastVerifiedAt: this.#last?.createdAt ?? null,
      lastBackupId: this.#last?.id ?? null,
      state: this.#running
        ? 'RUNNING'
        : (this.#failure ??
          (this.#last ? (this.#verified ? 'VERIFIED' : 'VERIFICATION_PENDING') : 'NOT_RUN')),
    });
  }
  async verifyLatest() {
    if (!this.#last) return;
    await verifyServerBackup(join(this.storage.folder, 'backups', this.#last.id), this.identity);
    this.#verified = true;
  }
  due(now: number) {
    return !this.#last || now - this.#last.createdAt >= 86400000;
  }
  async create(now: number, kind: 'MANUAL' | 'AUTOMATIC') {
    if (this.#running || !Number.isSafeInteger(now) || now < 0 || !['MANUAL', 'AUTOMATIC'].includes(kind))
      throw new Error('BACKUP_INPUT');
    const projected = this.sources.reduce(
      (total, source) =>
        total +
        Number(source.db.prepare('PRAGMA page_count').get()!.page_count) *
          Number(source.db.prepare('PRAGMA page_size').get()!.page_size),
      262144,
    );
    if (!this.storage.canWrite() || this.storage.bytes() + projected > this.storage.maxBytes)
      throw new Error('BACKUP_CAPACITY');
    this.#running = true;
    this.#failure = null;
    const id = randomUUID(),
      root = join(this.storage.folder, 'backups'),
      folder = join(root, id);
    try {
      mkdirSync(root, { mode: 0o700, recursive: true });
      if (realpathSync(root) !== root) throw new Error('BACKUP_DIRECTORY');
      mkdirSync(folder, { mode: 0o700 });
      const files: BackupFile[] = [];
      for (const source of this.sources) {
        const tables = fingerprints(source.db),
          target = join(folder, source.name + '.sqlite');
        closeSync(openSync(target, 'wx', 0o600));
        await backup(source.db, target);
        const stat = safeFile(target);
        files.push({
          ...(source.referenceTerms ? { referenceTerms: source.referenceTerms } : {}),
          name: source.name,
          bytes: stat.size,
          sha256: fileDigest(target),
          tables,
          evidenceIdentity: source.evidenceIdentity ?? null,
        });
      }
      const report: ServerBackupReport = {
        schemaVersion: 1,
        id,
        identity: this.identity,
        createdAt: now,
        kind,
        state: 'VERIFIED',
        files,
      };
      await verifyFiles(folder, report);
      writeFileSync(join(folder, 'manifest.json'), JSON.stringify(report) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      this.#last = report;
      this.#verified = true;
      return Object.freeze(report);
    } catch (error) {
      this.#failure = 'FAILED';
      throw error;
    } finally {
      this.#running = false;
    }
  }
}
