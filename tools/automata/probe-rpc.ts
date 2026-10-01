import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { capturePinnedState, parsePinnedStateRequest } from '../../packages/market-data/src/pinned-rpc.ts';
const usage =
  'READ_ONLY: probe-rpc.ts REQUEST_JSON NEW_OUTPUT_JSON (AF_READONLY_RPC_URL must be configured locally; no signing or broadcasts)';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') console.log(usage);
else if (args.length !== 2 || !process.env.AF_READONLY_RPC_URL) {
  console.error(usage);
  process.exitCode = 2;
} else {
  let temp: string | undefined;
  let descriptor: number | undefined;
  try {
    const input = openSync(resolve(args[0]!), constants.O_RDONLY);
    let request: ReturnType<typeof parsePinnedStateRequest>;
    try {
      if (!fstatSync(input).isFile()) throw new Error('INVALID_REQUEST_FILE');
      const buffer = Buffer.alloc(131073);
      let size = 0;
      while (size < buffer.length) {
        const n = readSync(input, buffer, size, buffer.length - size, null);
        if (n === 0) break;
        size += n;
      }
      if (size > 131072) throw new Error('REQUEST_TOO_LARGE');
      request = parsePinnedStateRequest(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))),
      );
    } finally {
      closeSync(input);
    }
    const output = resolve(args[1]!);
    const parent = dirname(output);
    if (realpathSync(parent) !== parent) throw new Error('UNSAFE_OUTPUT_PARENT');
    try {
      lstatSync(output);
      throw new Error('OUTPUT_EXISTS');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    temp = resolve(parent, `.alphaforge-rpc-${randomUUID()}.tmp`);
    descriptor = openSync(temp, 'wx', 0o600);
    const result = await capturePinnedState(request, process.env.AF_READONLY_RPC_URL!);
    writeFileSync(descriptor, JSON.stringify(result, null, 2) + '\n');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    // Atomic publication without replacing an existing path, including a symlink.
    linkSync(temp, output);
    unlinkSync(temp);
    temp = undefined;
    console.log(
      JSON.stringify({
        status: result.status,
        reason: result.reason,
        block: result.block,
        requests: result.receipts.length,
      }),
    );
    if (result.status !== 'CAPTURED') process.exitCode = 1;
  } catch {
    console.error('RPC_PROBE_INPUT_OR_OUTPUT_FAILED');
    process.exitCode = 1;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (temp)
      try {
        unlinkSync(temp);
      } catch {
        /* Keep a failed cleanup visible as a nonzero result. */ process.exitCode = 1;
      }
  }
}
