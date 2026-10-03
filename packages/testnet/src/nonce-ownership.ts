import { readRegularBytes } from './bounded-file.ts';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { walletAddress } from './address.ts';

/** Host-local signer ownership; crash locks remain until explicit canonical nonce reconciliation. */
export function claimNonceOwnership(folder: string, addresses: readonly string[], namespaceDigest: string) {
  if (
    process.platform === 'win32' ||
    !isAbsolute(folder) ||
    resolve(folder) !== folder ||
    realpathSync(folder) !== folder ||
    !addresses.length ||
    addresses.length > 2 ||
    !/^0x[a-f0-9]{64}$/.test(namespaceDigest) ||
    /^0x0+$/.test(namespaceDigest)
  )
    throw new Error('EXECUTOR_NONCE_OWNERSHIP_DIRECTORY');
  const root = lstatSync(folder, { bigint: true });
  if (!root.isDirectory() || root.uid !== BigInt(process.getuid!()) || (root.mode & 0o077n) !== 0n)
    throw new Error('EXECUTOR_NONCE_OWNERSHIP_DIRECTORY');
  const locks: { file: string; dev: bigint; ino: bigint }[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    const current = lstatSync(folder, { bigint: true });
    if (current.dev !== root.dev || current.ino !== root.ino || realpathSync(folder) !== folder)
      throw new Error('EXECUTOR_NONCE_OWNERSHIP_CHANGED');
    for (const lock of locks) {
      const stat = lstatSync(lock.file, { bigint: true });
      if (!stat.isFile() || stat.nlink !== 1n || stat.dev !== lock.dev || stat.ino !== lock.ino)
        throw new Error('EXECUTOR_NONCE_OWNERSHIP_CHANGED');
    }
    for (const lock of locks) unlinkSync(lock.file);
    closed = true;
  };
  try {
    for (const address of new Set(addresses.map(walletAddress))) {
      const file = join(folder, address.slice(2) + '.lock');
      let fd: number;
      try {
        fd = openSync(
          file,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
      } catch {
        throw new Error('EXECUTOR_NONCE_OWNERSHIP_LOCKED');
      }
      try {
        const stat = fstatSync(fd, { bigint: true });
        locks.push({ file, dev: stat.dev, ino: stat.ino });
        writeFileSync(
          fd,
          JSON.stringify({ schemaVersion: 1, address, pid: process.pid, createdAt: Date.now() }) + '\n',
        );
        fsyncSync(fd);
        const identityFile = join(folder, address.slice(2) + '.identity.json');
        const identity = JSON.stringify({ schemaVersion: 1, chainId: 46630, namespaceDigest }) + '\n';
        try {
          const before = lstatSync(identityFile);
          if (
            !before.isFile() ||
            before.nlink !== 1 ||
            before.uid !== process.getuid!() ||
            (before.mode & 0o077) !== 0 ||
            realpathSync(identityFile) !== identityFile ||
            new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(identityFile, 4096)) !==
              identity
          )
            throw new Error('EXECUTOR_NONCE_OWNERSHIP_IDENTITY');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          const identityFd = openSync(
            identityFile,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
            0o600,
          );
          try {
            writeFileSync(identityFd, identity);
            fsyncSync(identityFd);
          } finally {
            closeSync(identityFd);
          }
        }
      } finally {
        closeSync(fd);
      }
    }
    return Object.freeze({ close });
  } catch (error) {
    close();
    throw error;
  }
}
