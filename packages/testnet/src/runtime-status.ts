import type { PublicTestnetAppOptions } from '../../../apps/server/src/testnet-app.ts';

export interface ReleaseIdentity {
  readonly schemaVersion: 1;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly lockSha256: string;
  readonly releaseDigest: string;
}
export interface ArchivedTestResults {
  readonly schemaVersion: 1;
  readonly sourceCommit: string;
  readonly observedAt: number;
  readonly tests: number;
  readonly pass: number;
  readonly fail: number;
  readonly skipped: number;
  readonly rawLogSha256: string;
}
export interface RuntimeStatusOptions {
  readonly configurationDigest: string;
  readonly releaseIdentity?: ReleaseIdentity;
  readonly archivedTestResults?: ArchivedTestResults;
  readonly networkDigest?: string;
}
const hash = (v: unknown, size: number) =>
  typeof v === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(v) && !/^0+$/.test(v);
const digest = (v: unknown) => typeof v === 'string' && /^0x[a-f0-9]{64}$/.test(v) && !/^0x0+$/.test(v);
export function parseReleaseIdentity(input: unknown): ReleaseIdentity {
  const v = input as ReleaseIdentity;
  if (
    !v ||
    v.schemaVersion !== 1 ||
    !hash(v.sourceCommit, 40) ||
    !hash(v.sourceTree, 40) ||
    !hash(v.lockSha256, 64) ||
    !digest(v.releaseDigest)
  )
    throw new Error('RELEASE_IDENTITY_REJECTED');
  return Object.freeze({
    schemaVersion: 1,
    sourceCommit: v.sourceCommit,
    sourceTree: v.sourceTree,
    lockSha256: v.lockSha256,
    releaseDigest: v.releaseDigest,
  });
}
export function parseArchivedTestResults(input: unknown, now = Date.now()): ArchivedTestResults {
  const v = input as ArchivedTestResults;
  if (
    !v ||
    v.schemaVersion !== 1 ||
    !hash(v.sourceCommit, 40) ||
    !hash(v.rawLogSha256, 64) ||
    !Number.isSafeInteger(v.observedAt) ||
    v.observedAt < 1 ||
    v.observedAt > now ||
    ![v.tests, v.pass, v.fail, v.skipped].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1000000) ||
    v.tests !== v.pass + v.fail + v.skipped
  )
    throw new Error('ARCHIVED_TEST_RESULTS_REJECTED');
  return Object.freeze({
    schemaVersion: 1,
    sourceCommit: v.sourceCommit,
    observedAt: v.observedAt,
    tests: v.tests,
    pass: v.pass,
    fail: v.fail,
    skipped: v.skipped,
    rawLogSha256: v.rawLogSha256,
  });
}
const codes = new Set([
  'NOT_STARTED',
  'NO_ACTION',
  'NO_ACTIVE_VAULT',
  'WARMUP',
  'READY',
  'BROADCAST_UNCERTAIN',
  'PAUSED_AUTHORIZATION_EXPIRED',
  'PAUSED_EXECUTOR_ERROR',
  'PAUSED_GAS_BUDGET',
  'PAUSED_REFERENCE_DATA',
  'PAUSED_REFERENCE_NEEDS_NEW_SAMPLE',
  'PAUSED_REFERENCE_REVIEW',
  'PAUSED_STORAGE',
  'PAUSED_STORAGE_OR_BACKUP',
  'PAUSED_TERMS_CHANGED',
  'PAUSED_UNCERTAIN_SUBMISSION',
  'PREPARED_SIGNING_DISABLED',
  'PAUSED_POOL_PRICE_DEVIATION',
]);
export function projectExecutionStatus(input: unknown, now: number) {
  const v = input as Record<string, unknown> | undefined;
  if (
    !v ||
    !codes.has(String(v.state)) ||
    typeof v.signingEnabled !== 'boolean' ||
    !Number.isSafeInteger(v.observedAt) ||
    Number(v.observedAt) > now ||
    now - Number(v.observedAt) > 90000
  )
    return {
      state: v?.state === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'STATUS_UNAVAILABLE_OR_STALE',
      signingEnabled: false,
      observedAt: null,
    };
  return {
    state: String(v.state),
    signingEnabled: v.signingEnabled,
    observedAt: Number(v.observedAt),
    ...(v.runtime ? { runtime: projectExecutionRuntime(v.runtime, now) } : {}),
  };
}
export function projectExecutionRuntime(input: unknown, now: number) {
  const value = input as Record<string, unknown>;
  const reference = value?.reference as Record<string, unknown>;
  const backups = value?.backups as Record<string, unknown>;
  const lastMinute =
    Number.isSafeInteger(reference?.lastMinute) && Number(reference.lastMinute) <= now
      ? Number(reference.lastMinute)
      : null;
  const backupStates = [
    'VERIFIED',
    'NOT_RUN',
    'RUNNING',
    'VERIFICATION_PENDING',
    'BACKUP_FAILED',
    'BACKUP_STORAGE_BLOCKED',
    'FAILED',
  ];
  return {
    process: value?.process === 'RUNNING' ? 'RUNNING' : 'UNAVAILABLE',
    reference: {
      state:
        reference?.state === 'PAUSED'
          ? 'PAUSED'
          : reference?.state === 'CURRENT' && lastMinute !== null && now - lastMinute <= 90000
            ? 'CURRENT'
            : 'UNAVAILABLE',
      lastMinute,
    },
    backups: {
      state: backupStates.includes(String(backups?.state)) ? String(backups.state) : 'UNAVAILABLE',
      lastVerifiedAt:
        Number.isSafeInteger(backups?.lastVerifiedAt) && Number(backups.lastVerifiedAt) <= now
          ? Number(backups.lastVerifiedAt)
          : null,
    },
  };
}

/** Explicit projection, never recursive serialization of a provider, database or RPC result. */
export function liveRuntimeViews(options: PublicTestnetAppOptions, owner: string, now: number) {
  const context = options.runtimeStatus;
  const release = context?.releaseIdentity ? parseReleaseIdentity(context.releaseIdentity) : null;
  const currentSource = release ?? { state: 'NOT_CONFIGURED' };
  const provenance = {
    kind: 'CURRENT_PROCESS_OBSERVATION',
    observedAt: now,
    currentSource,
    configurationDigest: digest(context?.configurationDigest) ? context!.configurationDigest : null,
    networkDigest: digest(context?.networkDigest) ? context!.networkDigest : null,
    releaseIdentityVerification: release ? 'OPERATOR_SUPPLIED_DESCRIPTOR' : 'NOT_CONFIGURED',
  };
  const backup = options.backupStatus?.();
  const backupStates = [
    'NOT_CONFIGURED',
    'NOT_RUN',
    'VERIFIED',
    'FAILED',
    'BLOCKED',
    'BACKUP_FAILED',
    'AVAILABLE',
    'RUNNING',
    'VERIFICATION_PENDING',
  ];
  const backups = {
    state: backup && backupStates.includes(backup.state) ? backup.state : 'NOT_CONFIGURED',
    lastVerifiedAt:
      Number.isSafeInteger(backup?.lastVerifiedAt) && Number(backup!.lastVerifiedAt) <= now
        ? backup!.lastVerifiedAt
        : null,
  };
  const vaults = (options.runtimes ?? [])
    .filter((entry) => entry.runtime.inventory.owner === owner)
    .slice(0, 16)
    .map(({ id, runtime }) => {
      const observation = runtime.observation();
      const execution = projectExecutionStatus(
        options.executionStatus?.(owner, runtime.manifest.contractAddress),
        now,
      );
      let snapshot = null;
      try {
        snapshot = runtime.ownedView(owner).snapshot;
      } catch {
        /* Withhold unqualified projections. */
      }
      return {
        id,
        vault: runtime.manifest.contractAddress,
        manifestDigest: runtime.manifest.manifestDigest,
        chain: {
          state: snapshot ? 'CANONICAL_SNAPSHOT_QUALIFIED' : observation.state,
          observedAt: observation.observedAt,
          blockNumber: snapshot?.blockNumber ?? null,
          blockHash: snapshot?.blockHash ?? null,
          finality: 'L2_SOFT_CONFIRMATIONS_ONLY',
          l1Finality: 'UNKNOWN',
        },
        marketData: {
          state: snapshot
            ? snapshot.valuation === 'VALID' &&
              snapshot.stocks.every(
                (stock) =>
                  Number(stock.observedAt) * 1000 <= now && now - Number(stock.observedAt) * 1000 <= 30000,
              )
              ? 'VALID'
              : 'STALE_REFERENCE'
            : 'UNAVAILABLE',
          observedAt: snapshot?.blockTimestamp ?? null,
        },
        execution,
      };
    });
  const signingEnabled = vaults.some((v) => v.execution.signingEnabled);
  const data = options.canWrite && !options.canWrite() ? 'BLOCKED' : 'AVAILABLE';
  const blockers = [
    !release && 'RELEASE_IDENTITY_NOT_CONFIGURED',
    !digest(context?.configurationDigest) && 'CONFIGURATION_IDENTITY_NOT_CONFIGURED',
    !digest(context?.networkDigest) && 'NETWORK_IDENTITY_NOT_CONFIGURED',
    !vaults.length && 'OWNER_DEPLOYMENT_NOT_CONFIGURED',
    data === 'BLOCKED' && 'STORAGE_BLOCKED',
    vaults.some((v) => v.chain.state !== 'CANONICAL_SNAPSHOT_QUALIFIED') && 'CHAIN_UNAVAILABLE_OR_STALE',
    vaults.some((v) => v.marketData.state !== 'VALID') && 'MARKET_DATA_UNAVAILABLE_OR_STALE',
    vaults.some((v) => ['NOT_CONFIGURED', 'STATUS_UNAVAILABLE_OR_STALE'].includes(v.execution.state)) &&
      'EXECUTOR_STATUS_UNAVAILABLE',
    backups.state !== 'VERIFIED' && 'BACKUP_NOT_VERIFIED',
    'EXTERNAL_DEPLOYMENT_ACCEPTANCE_NOT_RECORDED',
  ].filter(Boolean);
  const status = {
    schemaVersion: 1,
    provenance,
    scope: 'OWNER_TESTNET_ONLY',
    chainId: 46630,
    process: 'RUNNING',
    liveProcessMonitoring: true,
    heartbeatAvailable: true,
    signingEnabled,
    data,
    backups,
    vaults,
    mainnet: 'DISABLED_UNCONFIGURED',
  };
  const readiness = {
    schemaVersion: 1,
    provenance,
    state: 'BLOCKED_FOR_PERSISTENT_TESTNET',
    signingEnabled,
    blockers,
    heartbeatProves: 'PROCESS_LIVENESS_ONLY',
    externalChainAcceptance: 'NOT_RUN',
    sustainedWindow: 'NOT_RUN',
  };
  const archive = context?.archivedTestResults
    ? parseArchivedTestResults(context.archivedTestResults, now)
    : null;
  const testResults = {
    schemaVersion: 1,
    currentSource,
    liveTestExecution: false,
    provenance: archive
      ? {
          kind: 'RECORDED_TEST_SNAPSHOT',
          sourceCommit: archive.sourceCommit,
          observedAt: archive.observedAt,
          ageMs: now - archive.observedAt,
          rawLogSha256: archive.rawLogSha256,
          verification: 'OPERATOR_SUPPLIED_ARCHIVE',
        }
      : { kind: 'NOT_CONFIGURED' },
    results: archive
      ? { tests: archive.tests, pass: archive.pass, fail: archive.fail, skipped: archive.skipped }
      : null,
  };
  return { status, readiness, testResults };
}
