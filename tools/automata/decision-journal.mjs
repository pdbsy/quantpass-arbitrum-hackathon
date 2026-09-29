import { DatabaseSync } from 'node:sqlite';
import { lstatSync } from 'node:fs';
import { resolve, dirname, parse } from 'node:path';
export class DecisionJournal {
  constructor(file) {
    if (file !== ':memory:') {
      file = resolve(file);
      let info;
      try {
        info = lstatSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1))
        throw new Error('Unsafe decision journal');
      let parent = dirname(file);
      while (parent !== parse(parent).root) {
        const info = lstatSync(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe journal directory');
        parent = dirname(parent);
      }
    }
    this.db = new DatabaseSync(file);
    this.db.exec(
      'PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS pending_decisions (key TEXT PRIMARY KEY, body TEXT NOT NULL)',
    );
  }
  load(key) {
    return this.db.prepare('SELECT body FROM pending_decisions WHERE key=?').get(key)?.body ?? null;
  }
  prepare(key, body) {
    if (typeof body !== 'string' || body.length > 32768) throw new Error('Invalid decision journal body');
    this.db.prepare('INSERT OR IGNORE INTO pending_decisions VALUES (?,?)').run(key, body);
    return this.load(key);
  }
  clear(key, body) {
    this.db.prepare('DELETE FROM pending_decisions WHERE key=? AND body=?').run(key, body);
  }
  close() {
    this.db.close();
  }
}
