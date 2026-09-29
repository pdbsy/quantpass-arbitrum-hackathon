import { openSync, closeSync, fstatSync, readSync, lstatSync, constants } from 'node:fs';
import { resolve } from 'node:path';
/** Reject special files before open; read only bounded UTF-8 JSON from the same regular file. */
export function readCollectionInput(path: string): unknown {
  const input = resolve(path);
  const before = lstatSync(input);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 131072)
    throw new Error('INVALID_COLLECTION_INPUT');
  const fd = openSync(input, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
      throw new Error('INVALID_COLLECTION_INPUT');
    const bytes = Buffer.alloc(131073);
    let count = 0;
    while (count < bytes.length) {
      const n = readSync(fd, bytes, count, bytes.length - count, null);
      if (n === 0) break;
      count += n;
    }
    if (count > 131072) throw new Error('INVALID_COLLECTION_INPUT');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count))) as unknown;
  } finally {
    closeSync(fd);
  }
}
