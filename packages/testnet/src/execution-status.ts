import { lstatSync, realpathSync } from 'node:fs';
import { readRegularBytes } from './bounded-file.ts';
import { walletAddress } from './address.ts';

export interface ExecutionStatusBinding {
  readonly file: string;
  readonly configurationDigest: string;
}
/** Sanitized cross-user status only. Does not expose signer files, raw transactions, RPC or other owners. */
export function readExecutionStatus(
  binding: ExecutionStatusBinding | undefined,
  owner: string,
  vault: string,
  now = Date.now(),
) {
  if (!binding) return { state: 'NOT_CONFIGURED', signingEnabled: false, observedAt: null };
  try {
    const before = lstatSync(binding.file);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size > 16384 ||
      realpathSync(binding.file) !== binding.file
    )
      throw new Error();
    const input = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(readRegularBytes(binding.file, 16384)),
    ) as Record<string, unknown>;
    const after = lstatSync(binding.file);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      input.schemaVersion !== 1 ||
      input.chainId !== 46630 ||
      input.configurationDigest !== binding.configurationDigest ||
      input.scope !== 'TEST_SUBSTITUTES_ONLY' ||
      typeof input.signingEnabled !== 'boolean' ||
      !Number.isSafeInteger(input.observedAt) ||
      Number(input.observedAt) > now ||
      now - Number(input.observedAt) > 90000 ||
      !Array.isArray(input.vaults) ||
      input.vaults.length > 16
    )
      throw new Error();
    const matches = input.vaults.filter(
      (v) =>
        v && typeof v === 'object' && walletAddress(v.owner) === owner && walletAddress(v.vault) === vault,
    );
    if (matches.length !== 1 || !/^([A-Z][A-Z0-9_]{0,63})$/.test(matches[0].state)) throw new Error();
    return Object.freeze({
      state: String(matches[0].state),
      signingEnabled: input.signingEnabled,
      observedAt: Number(input.observedAt),
    });
  } catch {
    return Object.freeze({ state: 'STATUS_UNAVAILABLE_OR_STALE', signingEnabled: false, observedAt: null });
  }
}
