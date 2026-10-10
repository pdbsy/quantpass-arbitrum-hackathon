import { readRegularBytes } from './bounded-file.ts';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** Runtime storage only. No historical deletion, automatic lock recovery, key storage or external paths. */
export function privateServerStorage(folder: string, maxBytes: number) {
  if (process.platform === 'win32') throw new Error('TESTNET_STORAGE_ACL_NOT_QUALIFIED');
  if (
    !isAbsolute(folder) ||
    folder !== resolve(folder) ||
    folder === resolve('/') ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1048576 ||
    maxBytes > 8000000000
  )
    throw new Error('TESTNET_STORAGE_INPUT');
  const parent = dirname(folder);
  if (realpathSync(parent) !== parent) throw new Error('TESTNET_STORAGE_UNSAFE');
  try {
    mkdirSync(folder, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const identity = lstatSync(folder, { bigint: true });
  if (
    !identity.isDirectory() ||
    realpathSync(folder) !== folder ||
    (identity.mode & 0o077n) !== 0n ||
    identity.uid !== BigInt(process.getuid!())
  )
    throw new Error('TESTNET_STORAGE_UNSAFE');
  const assertRoot = () => {
    const stat = lstatSync(folder, { bigint: true });
    if (
      !stat.isDirectory() ||
      stat.dev !== identity.dev ||
      stat.ino !== identity.ino ||
      realpathSync(folder) !== folder
    )
      throw new Error('TESTNET_STORAGE_UNSAFE');
  };
  const lock = join(folder, '.server.lock');
  let fd: number;
  try {
    fd = openSync(lock, 'wx', 0o600);
  } catch {
    throw new Error('TESTNET_STORAGE_LOCKED');
  }
  const lockIdentity = fstatSync(fd, { bigint: true });
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        kind: 'alphaforge-testnet-server',
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }) + '\n',
    );
  } catch (error) {
    const current = lstatSync(lock, { bigint: true });
    if (current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) unlinkSync(lock);
    throw error;
  } finally {
    closeSync(fd);
  }
  let closed = false;
  const inspectFile = (path: string) => {
    const s = lstatSync(path, { bigint: true });
    if (
      !s.isFile() ||
      s.nlink !== 1n ||
      realpathSync(path) !== path ||
      s.uid !== identity.uid ||
      (s.mode & 0o077n) !== 0n
    )
      throw new Error('TESTNET_STORAGE_UNSAFE');
    return s;
  };
  const bytes = () => {
    assertRoot();
    let total = 0n,
      entries = 0;
    const walk = (path: string, depth: number) => {
      if (depth > 8) throw new Error('TESTNET_STORAGE_UNSAFE');
      for (const name of readdirSync(path)) {
        if (++entries > 100000) throw new Error('TESTNET_STORAGE_UNSAFE');
        const file = join(path, name),
          stat = lstatSync(file, { bigint: true });
        if (stat.isDirectory()) {
          if (realpathSync(file) !== file || stat.uid !== identity.uid || (stat.mode & 0o077n) !== 0n)
            throw new Error('TESTNET_STORAGE_UNSAFE');
          walk(file, depth + 1);
        } else total += inspectFile(file).size;
      }
    };
    walk(folder, 0);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('TESTNET_STORAGE_UNSAFE');
    return Number(total);
  };
  return Object.freeze({
    folder,
    maxBytes,
    bytes,
    canWrite: (reserveBytes = 262144) => {
      try {
        return (
          Number.isSafeInteger(reserveBytes) &&
          reserveBytes >= 0 &&
          !closed &&
          bytes() + reserveBytes < maxBytes
        );
      } catch {
        return false;
      }
    },
    bindIdentity: (profile: string, digest: string) => {
      if (
        closed ||
        !['PUBLIC_TESTNET', 'RESTRICTED_TESTNET_EXECUTOR'].includes(profile) ||
        !/^0x[a-f0-9]{64}$/.test(digest) ||
        /^0x0+$/.test(digest)
      )
        throw new Error('TESTNET_STORAGE_NAMESPACE');
      assertRoot();
      const path = join(folder, 'network-identity.json');
      const encoded =
        JSON.stringify({
          schemaVersion: 1,
          environment: 'robinhood-chain-testnet',
          chainId: 46630,
          profile,
          digest,
        }) + '\n';
      try {
        inspectFile(path);
        const original = new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(path, 4096));
        if (original !== encoded) throw new Error('TESTNET_STORAGE_NAMESPACE');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (readdirSync(folder).some((name) => name !== '.server.lock'))
          throw new Error('TESTNET_STORAGE_NAMESPACE_MIGRATION_REQUIRED', { cause: error });
        const descriptor = openSync(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        try {
          writeFileSync(descriptor, encoded);
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        inspectFile(path);
        const parentDescriptor = openSync(folder, constants.O_RDONLY);
        try {
          fsyncSync(parentDescriptor);
        } finally {
          closeSync(parentDescriptor);
        }
      }
    },
    databasePath: (name: string, applicationId?: number) => {
      if (
        closed ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
        (applicationId !== undefined &&
          (!Number.isSafeInteger(applicationId) || applicationId < 1 || applicationId > 2147483647))
      )
        throw new Error('TESTNET_STORAGE_INPUT');
      assertRoot();
      const path = join(folder, name + '.sqlite');
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          inspectFile(path + suffix);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      let claimed = false;
      try {
        const file = openSync(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        closeSync(file);
        claimed = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const before = inspectFile(path);
      if (applicationId !== undefined) {
        const db = new DatabaseSync(path, { readOnly: !claimed });
        try {
          if (claimed) db.exec('PRAGMA application_id=' + applicationId);
          if (db.prepare('PRAGMA application_id').get()?.application_id !== applicationId)
            throw new Error('TESTNET_STORAGE_DATABASE_IDENTITY');
        } finally {
          db.close();
        }
        const after = inspectFile(path);
        if (before.dev !== after.dev || before.ino !== after.ino) throw new Error('TESTNET_STORAGE_UNSAFE');
      }
      return path;
    },
    close: () => {
      if (closed) return;
      closed = true;
      assertRoot();
      const current = inspectFile(lock);
      if (current.dev !== lockIdentity.dev || current.ino !== lockIdentity.ino)
        throw new Error('TESTNET_STORAGE_UNSAFE');
      unlinkSync(lock);
    },
  });
}
