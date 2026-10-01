import {
  readFileSync,
  copyFileSync,
  constants,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  readdirSync,
  lstatSync,
  existsSync,
  openSync,
  closeSync,
  readSync,
  fstatSync,
} from 'node:fs';
import { join } from 'node:path';
import { open as openFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { BatchJournal } from '../../market-data/src/batch-journal.ts';
import type { BatchEntry } from '../../market-data/src/batch-journal.ts';
import { captureReferenceBatch, exactFields, batchInteger } from '../../market-data/src/batch.ts';
import type { ReadTransport } from '../../market-data/src/capture.ts';
import { encodeBatchPayload } from '../../market-data/src/batch-codec.ts';
import { requireValue } from '../../market-data/src/robinhood.ts';
import { PaperJournal, parsePaperControl } from './reference-paper-journal.ts';
import type { PaperHistory } from './reference-paper-journal.ts';
import { parsePaperConfig, createPaper, paperNav, paperReturn } from './reference-paper.ts';
import type { PaperConfig, PaperState } from './reference-paper.ts';
import { PaperStorage } from './paper-storage.ts';
export interface PaperServiceConfig {
  version: 'alphaforge-reference-paper-service-1';
  sourceMode: 'OFFICIAL_REFERENCE' | 'OFFLINE_FIXTURE';
  owner: 'alice' | 'bob';
  paper: PaperConfig;
  intervalMs: number;
  maxBytes: number;
  backupIntervalMs: number | null;
}
export function parsePaperServiceConfig(input: unknown): PaperServiceConfig {
  const r = exactFields(input, [
    'version',
    'sourceMode',
    'owner',
    'paper',
    'intervalMs',
    'maxBytes',
    'backupIntervalMs',
  ]);
  requireValue(
    r.version === 'alphaforge-reference-paper-service-1' &&
      (r.sourceMode === 'OFFICIAL_REFERENCE' || r.sourceMode === 'OFFLINE_FIXTURE') &&
      (r.owner === 'alice' || r.owner === 'bob'),
    'INVALID_PAPER_SERVICE_CONFIG',
  );
  const intervalMs = batchInteger(r.intervalMs),
    maxBytes = batchInteger(r.maxBytes),
    backupIntervalMs = r.backupIntervalMs === null ? null : batchInteger(r.backupIntervalMs);
  requireValue(
    intervalMs <= 2147483647 &&
      maxBytes >= 1024 * 1024 &&
      (backupIntervalMs === null || backupIntervalMs <= 2147483647),
    'INVALID_PAPER_SERVICE_CONFIG',
  );
  return {
    version: r.version,
    sourceMode: r.sourceMode,
    owner: r.owner,
    paper: parsePaperConfig(r.paper),
    intervalMs,
    maxBytes,
    backupIntervalMs,
  };
}
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function fileDigest(path: string): { bytes: number; sha256: string } {
  const before = lstatSync(path);
  requireValue(before.isFile() && before.nlink === 1, 'PAPER_STORAGE_UNSAFE');
  const fd = openSync(path, 'r'),
    hash = createHash('sha256'),
    buffer = Buffer.alloc(65536);
  try {
    const opened = fstatSync(fd);
    requireValue(opened.ino === before.ino && opened.dev === before.dev, 'PAPER_STORAGE_UNSAFE');
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(fd);
    requireValue(after.size === opened.size && after.mtimeMs === opened.mtimeMs, 'PAPER_BACKUP_INTEGRITY');
    return { bytes: opened.size, sha256: hash.digest('hex') };
  } finally {
    closeSync(fd);
  }
}
async function fileDigestAsync(
  path: string,
  signal: AbortSignal,
): Promise<{ bytes: number; sha256: string }> {
  const before = lstatSync(path);
  requireValue(before.isFile() && before.nlink === 1, 'PAPER_STORAGE_UNSAFE');
  const file = await openFile(path, 'r'),
    hash = createHash('sha256'),
    buffer = Buffer.alloc(65536);
  try {
    const opened = await file.stat();
    requireValue(opened.ino === before.ino && opened.dev === before.dev, 'PAPER_STORAGE_UNSAFE');
    for (;;) {
      requireValue(!signal.aborted, 'PAPER_REPLAY_CANCELLED');
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat();
    requireValue(after.size === opened.size && after.mtimeMs === opened.mtimeMs, 'PAPER_BACKUP_INTEGRITY');
    return { bytes: opened.size, sha256: hash.digest('hex') };
  } finally {
    await file.close();
  }
}
function code(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)
    ? error.message
    : 'PAPER_SERVICE_FAILED';
}
export interface PaperBackup {
  id: string;
  createdAt: number;
  revision: number;
  cursor: number;
  verified: true;
}
export interface PaperServiceView {
  accountId: string;
  mode: 'REFERENCE_PAPER';
  sourceMode: PaperServiceConfig['sourceMode'];
  owner: string;
  at: number;
  initialized: boolean;
  revision: number;
  cursor: number;
  account: PaperState;
  nav6: string | null;
  unitValue: { numerator: string; denominator: string } | null;
  warmup: { validMinutes: number; requiredMinutes: 30 };
  health: {
    phase: 'blocked' | 'data_paused' | 'warming_up' | 'running' | 'liquidating' | 'stopped';
    reason: string | null;
    lastCaptureAt: number | null;
    lastAcceptedAt: number | null;
    collecting: boolean;
    backupInProgress: boolean;
  };
  storage: { usedBytes: number; maxBytes: number };
  history: PaperHistory;
  fills: PaperHistory['items'];
  backups: PaperBackup[];
}
export class ReferencePaperService {
  readonly config: PaperServiceConfig;
  readonly #accountId: string;
  readonly #storage: PaperStorage;
  readonly #source: BatchJournal;
  readonly #now: () => number;
  readonly #transport: ReadTransport;
  #paper: PaperJournal | null = null;
  #anchorCompletedAt: number | null = null;
  #lastRecordedCursor = 0;
  #tail: Promise<unknown> = Promise.resolve();
  #loop: Promise<void> | null = null;
  #controller = new AbortController();
  #round: AbortController | null = null;
  #pendingStops = 0;
  #backingUp = false;
  #closed = false;
  #fatal: string | null = null;
  #dataReason: string | null = 'WAITING_FOR_REFERENCE';
  #lastCaptureAt: number | null = null;
  #lastAcceptedAt: number | null = null;
  #backups: PaperBackup[] = [];
  #backupJobs = new Map<string, Promise<PaperBackup & { replayed: boolean }>>();
  #closing: Promise<void> | null = null;
  constructor(path: string, input: unknown, options: { transport?: ReadTransport; now?: () => number } = {}) {
    this.config = parsePaperServiceConfig(input);
    requireValue(
      this.config.sourceMode !== 'OFFLINE_FIXTURE' || options.transport !== undefined,
      'PAPER_FIXTURE_TRANSPORT_REQUIRED',
    );
    this.#now = options.now ?? Date.now;
    this.#transport = options.transport ?? fetch;
    this.#storage = new PaperStorage(path, this.config.maxBytes);
    let source: BatchJournal | undefined;
    try {
      const binding = JSON.stringify({
        version: this.config.version,
        sourceMode: this.config.sourceMode,
        owner: this.config.owner,
        paper: this.config.paper,
      });
      const file = join(this.#storage.root, 'account.json');
      if (existsSync(file)) {
        requireValue(lstatSync(file).size <= 1024 * 1024, 'PAPER_SERVICE_CONFIG_MISMATCH');
        const stored = exactFields(JSON.parse(readFileSync(file, 'utf8')), ['binding', 'accountId']);
        requireValue(
          stored.binding === binding &&
            typeof stored.accountId === 'string' &&
            /^[0-9a-f-]{36}$/.test(stored.accountId),
          'PAPER_SERVICE_CONFIG_MISMATCH',
        );
        this.#accountId = stored.accountId;
      } else {
        this.#accountId = randomUUID();
        writeFileSync(file, JSON.stringify({ binding, accountId: this.#accountId }), {
          flag: 'wx',
          mode: 0o600,
        });
      }
      source = new BatchJournal(join(this.#storage.root, 'source.sqlite'));
      this.#source = source;
      this.#ensurePaper();
      this.#catchUp();
      const backups = join(this.#storage.root, 'backups');
      if (existsSync(backups)) {
        for (const id of readdirSync(backups).sort()) {
          if (id.startsWith('.pending-')) continue; // preserved interrupted evidence; counted in quota
          const manifest = this.#readBackup(id);
          this.#backups.push({
            id,
            createdAt: manifest.createdAt,
            revision: manifest.revision,
            cursor: manifest.cursor,
            verified: true,
          });
        }
      }
    } catch (error) {
      this.#paper?.close();
      source?.close();
      this.#storage.release();
      throw error;
    }
  }
  #ensurePaper(): void {
    if (this.#anchorCompletedAt === null)
      this.#anchorCompletedAt = this.#source.next(0)?.batch.completedAt ?? null;
    if (!this.#paper && this.#anchorCompletedAt !== null)
      this.#paper = new PaperJournal(
        join(this.#storage.root, 'paper.sqlite'),
        this.config.paper,
        this.#source,
        { owner: this.config.owner },
      );
  }
  #record(entry: BatchEntry): void {
    const result = this.#paper!.consume(entry);
    this.#lastCaptureAt = entry.batch.completedAt;
    this.#lastRecordedCursor = entry.id;
    const rejected = result.events.find((e) => e.kind === 'REFERENCE_REJECTED');
    this.#dataReason = rejected ? String(rejected.reason) : null;
    if (!rejected && entry.batch.status === 'ACCEPTED') this.#lastAcceptedAt = entry.batch.completedAt;
    if (entry.batch.reason === 'HTTP_ACCESS_DENIED') this.#fatal = 'HTTP_ACCESS_DENIED';
  }
  #catchUp(): void {
    if (!this.#paper) return;
    this.#paper.refresh();
    const previous = this.#paper.snapshot().cursor;
    if (previous > 0 && previous !== this.#lastRecordedCursor) {
      const entry = this.#source.entry(previous);
      this.#lastCaptureAt = entry.batch.completedAt;
      // Derive diagnostic state from the exact persisted paper step, not raw acceptance alone.
      const history = this.#paper.history(undefined, 100);
      const recent = history.items.flatMap((item) => item.events);
      const rejected = recent.find((e) => e.kind === 'REFERENCE_REJECTED' || e.kind === 'NAV');
      this.#dataReason =
        rejected?.kind === 'REFERENCE_REJECTED'
          ? String(rejected.reason)
          : entry.batch.status === 'REJECTED'
            ? entry.batch.reason
            : null;
      const accepted = recent.find((e) => e.kind === 'NAV');
      this.#lastAcceptedAt = accepted ? (accepted.at as number) : null;
      if (entry.batch.reason === 'HTTP_ACCESS_DENIED') this.#fatal = 'HTTP_ACCESS_DENIED';
    }
    for (;;) {
      const entry = this.#source.next(this.#paper.snapshot().cursor);
      if (!entry) break;
      this.#storage.reserve(4 * 1024 * 1024);
      this.#record(entry);
    }
  }
  #serialize<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.#tail.then(() => {
      requireValue(!this.#closed, 'PAPER_SERVICE_CLOSED');
      return work();
    });
    this.#tail = result.catch(() => {});
    return result;
  }
  cycle(): Promise<void> {
    return this.#serialize(async () => {
      if (this.#fatal || this.#controller.signal.aborted) return;
      try {
        this.#catchUp();
        this.#storage.reserve(8 * 1024 * 1024);
        this.#round = new AbortController();
        if (this.#pendingStops > 0) this.#round.abort();
        const batch = await captureReferenceBatch(
          this.config.paper.market,
          this.#transport,
          this.#now,
          AbortSignal.any([this.#controller.signal, this.#round.signal]),
        );
        this.#round = null;
        const bytes = Buffer.byteLength(encodeBatchPayload(JSON.stringify(batch)));
        this.#storage.reserve(3 * bytes + 8 * 1024 * 1024);
        const id = this.#source.append(batch);
        this.#ensurePaper();
        this.#record(this.#source.entry(id));
        this.#source.checkpoint();
        this.#paper!.checkpoint();
        this.#storage.reserve(0);
        if (this.config.backupIntervalMs !== null && !this.#fatal) {
          const last = this.#backups.reduce(
            (last, b) => Math.max(last, b.createdAt),
            this.#anchorCompletedAt!,
          );
          if (this.#now() - last >= this.config.backupIntervalMs && this.#backupJobs.size === 0)
            void this.#requestBackup('auto-' + String(this.#now())).catch((error) => {
              if (!this.#controller.signal.aborted && code(error) !== 'PAPER_BACKUP_CANCELLED_FOR_STOP')
                this.#fatal = code(error);
            });
        }
      } catch (error) {
        if (code(error) !== 'PAPER_BACKUP_CANCELLED_FOR_STOP') this.#fatal = code(error);
      } finally {
        this.#round = null;
      }
    });
  }
  start(): void {
    requireValue(!this.#closed && !this.#loop, 'PAPER_SERVICE_ALREADY_STARTED');
    this.#loop = (async () => {
      while (!this.#controller.signal.aborted && !this.#fatal) {
        await this.cycle();
        if (this.#fatal || this.#controller.signal.aborted) break;
        try {
          await delay(this.config.intervalMs, undefined, { signal: this.#controller.signal });
        } catch (error) {
          if (!this.#controller.signal.aborted) this.#fatal = code(error);
        }
      }
    })();
  }
  #authorize(owner: string): void {
    requireValue(owner === this.config.owner, 'PAPER_NOT_FOUND');
  }
  control(owner: string, input: unknown): Promise<{ revision: number; replayed: boolean }> {
    this.#authorize(owner);
    const request = parsePaperControl(input),
      stopping = request.action.type === 'stop';
    if (stopping) {
      this.#pendingStops++;
      this.#round?.abort();
    }
    const work = () => {
      requireValue(!this.#closed, 'PAPER_SERVICE_CLOSED');
      requireValue(this.#paper, 'PAPER_NOT_READY');
      const previous = this.#paper.receipt(request);
      if (previous) return previous;
      this.#storage.reserve(2 * 1024 * 1024);
      const result = this.#paper.control(request, this.#now());
      if (!this.#backingUp) this.#paper.checkpoint();
      return result;
    };
    const result = stopping && this.#backingUp ? Promise.resolve().then(work) : this.#serialize(work);
    return result.finally(() => {
      if (stopping) this.#pendingStops--;
    });
  }
  history(owner: string, before?: number, limit = 100): PaperHistory {
    this.#authorize(owner);
    return this.#paper?.history(before, limit) ?? { items: [], nextBefore: null };
  }
  view(owner: string): PaperServiceView {
    this.#authorize(owner);
    const snapshot = this.#paper?.snapshot(),
      account = snapshot?.state ?? createPaper(this.config.paper),
      at = Math.max(this.#now(), account.clock),
      ids = Object.keys(account.positions);
    const fresh = ids.every((id) => {
      const q = account.quotes[id];
      return q && at >= q.generatedAt && at - q.generatedAt <= this.config.paper.market.maxAgeMs;
    });
    const validMinutes = Math.min(...Object.values(account.emas).map((e) => e.slow.count));
    const reason = this.#fatal ?? this.#dataReason ?? (!fresh ? 'STALE_REFERENCE' : null);
    const phase = this.#fatal
      ? 'blocked'
      : account.status === 'stopped'
        ? 'stopped'
        : account.status === 'liquidating'
          ? 'liquidating'
          : reason
            ? 'data_paused'
            : validMinutes < 30
              ? 'warming_up'
              : 'running';
    return {
      accountId: this.#accountId,
      mode: 'REFERENCE_PAPER',
      sourceMode: this.config.sourceMode,
      owner: this.config.owner,
      at,
      initialized: !!this.#paper,
      revision: snapshot?.revision ?? 0,
      cursor: snapshot?.cursor ?? 0,
      account,
      nav6: paperNav(account, at),
      unitValue: paperReturn(account, at),
      warmup: { validMinutes, requiredMinutes: 30 },
      health: {
        phase,
        reason,
        lastCaptureAt: this.#lastCaptureAt,
        lastAcceptedAt: this.#lastAcceptedAt,
        collecting: !!this.#loop && !this.#fatal && !this.#closed,
        backupInProgress: this.#backupJobs.size > 0,
      },
      storage: { usedBytes: this.#storage.usage(), maxBytes: this.config.maxBytes },
      history: this.history(owner),
      fills: this.#paper?.fills() ?? [],
      backups: structuredClone(this.#backups),
    };
  }
  backup(owner: string, id: string): Promise<PaperBackup & { replayed: boolean }> {
    this.#authorize(owner);
    return this.#requestBackup(id);
  }
  #readBackup(id: string, verifyFiles = true): BackupManifest {
    requireValue(/^[a-zA-Z0-9_-]{1,80}$/.test(id), 'INVALID_PAPER_BACKUP');
    const root = join(this.#storage.root, 'backups', id),
      file = join(root, 'manifest.json');
    requireValue(lstatSync(file).size <= 4096, 'PAPER_BACKUP_INTEGRITY');
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as BackupManifest;
    requireValue(
      ['alphaforge-paper-backup-1', 'alphaforge-paper-backup-2'].includes(manifest.version) &&
        manifest.id === id &&
        manifest.owner === this.config.owner &&
        manifest.configHash === sha(JSON.stringify(this.config.paper)) &&
        Number.isSafeInteger(manifest.createdAt) &&
        manifest.createdAt >= 0 &&
        Number.isSafeInteger(manifest.revision) &&
        manifest.revision > 0 &&
        Number.isSafeInteger(manifest.cursor) &&
        manifest.cursor > 0 &&
        typeof manifest.tipHash === 'string' &&
        /^[0-9a-f]{64}$/.test(manifest.tipHash),
      'PAPER_BACKUP_INTEGRITY',
    );
    if (manifest.version === 'alphaforge-paper-backup-2') {
      requireValue(
        manifest.accountId === this.#accountId && manifest.sourceMode === this.config.sourceMode,
        'PAPER_BACKUP_INTEGRITY',
      );
      requireValue(lstatSync(join(root, 'account.json')).size <= 1024 * 1024, 'PAPER_BACKUP_INTEGRITY');
      requireValue(
        readFileSync(join(root, 'account.json'), 'utf8') ===
          readFileSync(join(this.#storage.root, 'account.json'), 'utf8'),
        'PAPER_BACKUP_INTEGRITY',
      );
    }
    for (const name of this.#backupFiles(manifest)) {
      const info = manifest.files?.[name],
        data = verifyFiles ? fileDigest(join(root, name)) : info;
      requireValue(
        info &&
          data &&
          Number.isSafeInteger(info.bytes) &&
          info.bytes >= 0 &&
          /^[0-9a-f]{64}$/.test(info.sha256) &&
          data.bytes === info.bytes &&
          data.sha256 === info.sha256,
        'PAPER_BACKUP_INTEGRITY',
      );
    }
    return manifest;
  }
  #backupFiles(manifest: BackupManifest): ('source.sqlite' | 'paper.sqlite' | 'account.json')[] {
    return manifest.version === 'alphaforge-paper-backup-2'
      ? ['source.sqlite', 'paper.sqlite', 'account.json']
      : ['source.sqlite', 'paper.sqlite'];
  }
  #requestBackup(id: string): Promise<PaperBackup & { replayed: boolean }> {
    requireValue(/^[a-zA-Z0-9_-]{1,80}$/.test(id), 'INVALID_PAPER_BACKUP');
    requireValue(!this.#closed && !this.#controller.signal.aborted, 'PAPER_SERVICE_CLOSED');
    const pending = this.#backupJobs.get(id);
    if (pending) return pending.then((result) => ({ ...result, replayed: true }));
    requireValue(this.#backupJobs.size === 0, 'PAPER_BACKUP_BUSY');
    const job = (async () => {
      this.#storage.usage();
      const existing = this.#backups.find((b) => b.id === id);
      if (existing) {
        const manifest = this.#readBackup(id, false);
        for (const name of this.#backupFiles(manifest)) {
          const data = await fileDigestAsync(
            join(this.#storage.root, 'backups', id, name),
            this.#controller.signal,
          );
          requireValue(isDeepStrictEqual(data, manifest.files[name]), 'PAPER_BACKUP_INTEGRITY');
        }
        return { ...existing, replayed: true };
      }
      const prepared = await this.#serialize(async () => {
        requireValue(this.#paper, 'PAPER_NOT_READY');
        requireValue(!this.#controller.signal.aborted, 'PAPER_SERVICE_CLOSED');
        const state = this.#paper.snapshot(),
          createdAt = this.#now(),
          destination = join(this.#storage.root, 'backups');
        const total =
          lstatSync(join(this.#storage.root, 'source.sqlite')).size +
          lstatSync(join(this.#storage.root, 'paper.sqlite')).size;
        this.#storage.reserve(total * 2 + 8 * 1024 * 1024);
        if (!existsSync(destination)) mkdirSync(destination, { mode: 0o700 });
        const pending = mkdtempSync(join(destination, '.pending-'));
        this.#backingUp = true;
        const unchanged = () =>
          requireValue(this.#paper!.snapshot().tipHash === state.tipHash, 'PAPER_BACKUP_CANCELLED_FOR_STOP');
        try {
          copyFileSync(
            join(this.#storage.root, 'account.json'),
            join(pending, 'account.json'),
            constants.COPYFILE_EXCL,
          );
          await this.#source.backupTo(join(pending, 'source.sqlite'));
          unchanged();
          await this.#paper.backupTo(join(pending, 'paper.sqlite'));
          unchanged();
          this.#storage.reserve(0);
          return { state, createdAt, destination, pending };
        } catch (error) {
          rmSync(pending, { recursive: true, force: true });
          throw error;
        } finally {
          this.#backingUp = false;
        }
      });
      const { state, createdAt, destination, pending: directory } = prepared;
      try {
        const source = new BatchJournal(join(directory, 'source.sqlite'), { readOnly: true });
        let copy: PaperJournal | undefined;
        try {
          copy = new PaperJournal(join(directory, 'paper.sqlite'), this.config.paper, source, {
            owner: this.config.owner,
            deferReplay: true,
          });
          await copy.replayAsync(this.#controller.signal);
          requireValue(isDeepStrictEqual(copy.snapshot(), state), 'PAPER_BACKUP_REPLAY_FAILED');
        } finally {
          copy?.close();
          source.close();
        }
        const files = {} as BackupManifest['files'];
        for (const name of ['source.sqlite', 'paper.sqlite', 'account.json'] as const)
          files[name] = await fileDigestAsync(join(directory, name), this.#controller.signal);
        const manifest: BackupManifest = {
          version: 'alphaforge-paper-backup-2',
          id,
          owner: this.config.owner,
          accountId: this.#accountId,
          sourceMode: this.config.sourceMode,
          createdAt,
          configHash: sha(JSON.stringify(this.config.paper)),
          revision: state.revision,
          cursor: state.cursor,
          tipHash: state.tipHash,
          files,
        };
        this.#storage.reserve(4096);
        writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest), {
          flag: 'wx',
          mode: 0o600,
        });
        requireValue(!existsSync(join(destination, id)), 'PAPER_BACKUP_CONFLICT');
        renameSync(directory, join(destination, id));
        const result: PaperBackup = {
          id,
          createdAt,
          revision: state.revision,
          cursor: state.cursor,
          verified: true,
        };
        this.#backups.push(result);
        return { ...result, replayed: false };
      } catch (error) {
        rmSync(directory, { recursive: true, force: true });
        throw error;
      }
    })();
    this.#backupJobs.set(id, job);
    void job.finally(() => this.#backupJobs.delete(id)).catch(() => {});
    return job;
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#controller.abort();
    this.#closing = (async () => {
      await this.#loop;
      await this.#tail;
      await Promise.allSettled([...this.#backupJobs.values()]);
      this.#closed = true;
      this.#paper?.close();
      this.#source.close();
      this.#storage.release();
    })();
    return this.#closing;
  }
}
interface BackupManifest {
  version: 'alphaforge-paper-backup-1' | 'alphaforge-paper-backup-2';
  id: string;
  owner: string;
  accountId?: string;
  sourceMode?: PaperServiceConfig['sourceMode'];
  createdAt: number;
  configHash: string;
  revision: number;
  cursor: number;
  tipHash: string;
  files: Record<'source.sqlite' | 'paper.sqlite', { bytes: number; sha256: string }> & {
    'account.json'?: { bytes: number; sha256: string };
  };
}
