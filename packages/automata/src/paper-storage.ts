import {
  mkdirSync,
  realpathSync,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireValue } from '../../market-data/src/robinhood.ts';
/** Local single-process ownership; not a defence against a malicious OS account. */
export class PaperStorage {
  readonly root: string;
  readonly maxBytes: number;
  readonly #token = randomUUID();
  #released = false;
  constructor(path: string, maxBytes: number) {
    requireValue(Number.isSafeInteger(maxBytes) && maxBytes >= 1024 * 1024, 'INVALID_PAPER_STORAGE_LIMIT');
    this.root = resolve(path);
    this.maxBytes = maxBytes;
    requireValue(realpathSync(dirname(this.root)) === dirname(this.root), 'PAPER_STORAGE_UNSAFE');
    if (!this.#exists(this.root)) mkdirSync(this.root, { mode: 0o700 });
    requireValue(
      realpathSync(this.root) === this.root && lstatSync(this.root).isDirectory(),
      'PAPER_STORAGE_UNSAFE',
    );
    this.usage();
    const file = join(this.root, 'service.lock');
    if (this.#exists(file)) {
      const stat = lstatSync(file);
      requireValue(stat.isFile() && stat.nlink === 1 && stat.size <= 1024, 'PAPER_STORAGE_UNSAFE');
      let lease: unknown;
      try {
        lease = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        throw new Error('PAPER_SERVICE_BUSY');
      }
      const pid = (lease as { pid?: unknown })?.pid;
      requireValue(Number.isSafeInteger(pid) && (pid as number) > 0, 'PAPER_SERVICE_BUSY');
      try {
        process.kill(pid as number, 0);
        throw new Error('PAPER_SERVICE_BUSY');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
          throw new Error('PAPER_SERVICE_BUSY', { cause: error });
      }
      const current = lstatSync(file);
      requireValue(current.ino === stat.ino && current.dev === stat.dev, 'PAPER_SERVICE_BUSY');
      unlinkSync(file);
    }
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, token: this.#token }), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch {
      throw new Error('PAPER_SERVICE_BUSY');
    }
  }
  #exists(path: string): boolean {
    try {
      lstatSync(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  usage(): number {
    let bytes = 0,
      count = 0;
    const walk = (path: string, depth: number) => {
      requireValue(depth <= 4, 'PAPER_STORAGE_UNSAFE');
      for (const entry of readdirSync(path)) {
        requireValue(++count <= 100000, 'PAPER_STORAGE_SCAN_LIMIT');
        const full = join(path, entry),
          stat = lstatSync(full);
        requireValue(!stat.isSymbolicLink(), 'PAPER_STORAGE_UNSAFE');
        if (stat.isDirectory()) walk(full, depth + 1);
        else {
          requireValue(stat.isFile() && stat.nlink === 1, 'PAPER_STORAGE_UNSAFE');
          bytes += stat.size;
          requireValue(Number.isSafeInteger(bytes), 'PAPER_STORAGE_SCAN_LIMIT');
        }
      }
    };
    walk(this.root, 0);
    return bytes;
  }
  reserve(bytes: number): void {
    requireValue(Number.isSafeInteger(bytes) && bytes >= 0, 'INVALID_PAPER_STORAGE_LIMIT');
    requireValue(this.usage() + bytes <= this.maxBytes, 'PAPER_STORAGE_LIMIT');
  }
  release(): void {
    if (this.#released) return;
    const file = join(this.root, 'service.lock');
    const stat = lstatSync(file);
    requireValue(stat.isFile() && stat.nlink === 1 && stat.size <= 1024, 'PAPER_STORAGE_UNSAFE');
    const lease = JSON.parse(readFileSync(file, 'utf8')) as { token: unknown };
    requireValue(lease.token === this.#token, 'PAPER_SERVICE_BUSY');
    unlinkSync(file);
    this.#released = true;
  }
}
