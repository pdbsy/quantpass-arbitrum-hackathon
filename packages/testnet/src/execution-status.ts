import { projectExecutionStatus, projectExecutionRuntime } from './runtime-status.ts';
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
    if (
      matches.length !== 1 ||
      projectExecutionStatus(
        { ...matches[0], signingEnabled: input.signingEnabled, observedAt: input.observedAt },
        now,
      ).observedAt === null
    )
      throw new Error();
    return Object.freeze({
      state: String(matches[0].state),
      signingEnabled: input.signingEnabled,
      observedAt: Number(input.observedAt),
      ...(input.runtime ? { runtime: projectExecutionRuntime(input.runtime, now) } : {}),
    });
  } catch {
    return Object.freeze({ state: 'STATUS_UNAVAILABLE_OR_STALE', signingEnabled: false, observedAt: null });
  }
}

/** Only this allowlisted envelope crosses from the private executor to the public reader group. */
export function executionStatusExport(report: {
  configurationDigest: string;
  observedAt: number;
  signingEnabled: boolean;
  state: string;
  referencePaused: boolean;
  lastMinute: number | null;
  backups: { state: string; lastVerifiedAt: number | null; lastBackupId: string | null };
  vaults: readonly { owner: string; vault: string; state: string }[];
  [key: string]: unknown;
}) {
  return {
    schemaVersion: 1,
    chainId: 46630,
    configurationDigest: report.configurationDigest,
    observedAt: report.observedAt,
    signingEnabled: report.signingEnabled,
    vaults: report.vaults.map((v) => ({
      owner: walletAddress(v.owner),
      vault: walletAddress(v.vault),
      state: projectExecutionStatus(
        { state: v.state, signingEnabled: report.signingEnabled, observedAt: report.observedAt },
        report.observedAt,
      ).state,
    })),
    runtime: projectExecutionRuntime(
      {
        process: 'RUNNING',
        reference: { state: report.referencePaused ? 'PAUSED' : 'CURRENT', lastMinute: report.lastMinute },
        backups: report.backups,
      },
      report.observedAt,
    ),
    scope: 'TEST_SUBSTITUTES_ONLY',
  };
}
