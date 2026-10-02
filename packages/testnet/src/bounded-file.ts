import { constants, openSync, closeSync, fstatSync, lstatSync, readSync, realpathSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';

/** Read only bounded private regular inputs; operator content never enters error output. */
export function readRegularBytes(path: string, maxBytes = 256 * 1024): Uint8Array {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024)
    throw new Error('INVALID_INPUT');
  const parent = realpathSync(dirname(resolve(path)));
  const filePath = join(parent, basename(path));
  const before = lstatSync(filePath, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maxBytes))
    throw new Error('INVALID_INPUT');
  const fd = openSync(
    filePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error('INVALID_INPUT');
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const length = readSync(fd, bytes, size, bytes.length - size, null);
      if (!length) break;
      size += length;
    }
    const after = fstatSync(fd, { bigint: true });
    const current = lstatSync(filePath, { bigint: true });
    if (
      BigInt(size) !== opened.size ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      !current.isFile() ||
      current.nlink !== 1n
    )
      throw new Error('INVALID_INPUT');
    return bytes.subarray(0, size);
  } finally {
    closeSync(fd);
  }
}
