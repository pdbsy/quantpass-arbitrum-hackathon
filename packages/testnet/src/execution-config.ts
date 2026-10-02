import { parsePublicTestnetConfig, type TradingVaultBinding } from './public-config.ts';
import { walletAddress } from './address.ts';
import { validateSubmissionPolicy, type SubmissionPolicy } from './restricted-submission.ts';
import { createReferenceEngine, type ReferenceTerms } from './reference-engine.ts';
import { evidenceHash } from './executor-plan.ts';

export interface ExecutorConfig {
  readonly schemaVersion: 1;
  readonly profile: 'RESTRICTED_TESTNET_EXECUTOR';
  readonly chainId: 46630;
  readonly dataDirectory: string;
  readonly maxStorageBytes: number;
  readonly executor: string;
  readonly keeper: string;
  readonly minOrderUsdc: string;
  readonly deadlineSeconds: number;
  readonly gas: SubmissionPolicy;
  readonly maxTotalGasCostWei: string;
  readonly referenceFile: string;
  readonly referenceDigest: string;
  readonly vaults: readonly TradingVaultBinding[];
}
function object(input: unknown, keys: string[]) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== keys.length ||
    Object.keys(input).some((k) => !keys.includes(k))
  )
    throw new Error('EXECUTOR_CONFIGURATION');
  return input as Record<string, unknown>;
}
export function parseExecutorConfig(input: unknown): ExecutorConfig {
  const v = object(input, [
    'schemaVersion',
    'profile',
    'chainId',
    'dataDirectory',
    'maxStorageBytes',
    'executor',
    'keeper',
    'minOrderUsdc',
    'deadlineSeconds',
    'gas',
    'maxTotalGasCostWei',
    'referenceFile',
    'referenceDigest',
    'vaults',
  ]);
  if (
    typeof v.maxTotalGasCostWei !== 'string' ||
    !/^[1-9][0-9]{0,77}$/.test(v.maxTotalGasCostWei) ||
    BigInt(v.maxTotalGasCostWei) >= 2n ** 256n
  )
    throw new Error('EXECUTOR_GAS_BUDGET');
  if (
    v.schemaVersion !== 1 ||
    v.profile !== 'RESTRICTED_TESTNET_EXECUTOR' ||
    v.chainId !== 46630 ||
    typeof v.minOrderUsdc !== 'string' ||
    !/^[1-9][0-9]{0,77}$/.test(v.minOrderUsdc) ||
    BigInt(v.minOrderUsdc) >= 2n ** 256n ||
    typeof v.deadlineSeconds !== 'number' ||
    !Number.isSafeInteger(v.deadlineSeconds) ||
    v.deadlineSeconds < 1 ||
    v.deadlineSeconds > 30 ||
    typeof v.referenceFile !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,95}\.json$/.test(v.referenceFile) ||
    typeof v.referenceDigest !== 'string' ||
    !/^0x[0-9a-f]{64}$/.test(v.referenceDigest) ||
    /^0x0+$/.test(v.referenceDigest)
  )
    throw new Error('EXECUTOR_CONFIGURATION');
  // Reuse the qualified directory, capacity and deployment binding boundary, never the public origin.
  const bound = parsePublicTestnetConfig({
    schemaVersion: 1,
    profile: 'PUBLIC_TESTNET',
    chainId: 46630,
    origin: 'https://offline.invalid',
    dataDirectory: v.dataDirectory,
    syncIntervalMs: 5000,
    challengeTtlMs: 1000,
    sessionTtlMs: 1000,
    maxAuthRows: 1,
    maxStorageBytes: v.maxStorageBytes,
    vaults: v.vaults,
  });
  if (
    bound.vaults.length === 0 ||
    bound.vaults.some((b) => [b.manifestFile, b.inventoryFile].includes(String(v.referenceFile)))
  )
    throw new Error('EXECUTOR_CONFIGURATION');
  return Object.freeze({
    schemaVersion: 1,
    profile: 'RESTRICTED_TESTNET_EXECUTOR',
    chainId: 46630,
    dataDirectory: bound.dataDirectory,
    maxStorageBytes: bound.maxStorageBytes,
    executor: walletAddress(String(v.executor)),
    keeper: walletAddress(String(v.keeper)),
    minOrderUsdc: v.minOrderUsdc,
    deadlineSeconds: v.deadlineSeconds,
    gas: validateSubmissionPolicy(v.gas as SubmissionPolicy),
    maxTotalGasCostWei: v.maxTotalGasCostWei,
    referenceFile: v.referenceFile,
    referenceDigest: v.referenceDigest,
    vaults: bound.vaults,
  });
}
/** Operator-reviewed classification record; kept separate from canonical-token execution admission. */
export function parseReferenceAdmission(
  input: unknown,
  expectedDigest: string,
  now: number,
): readonly ReferenceTerms[] {
  if (evidenceHash(input) !== expectedDigest) throw new Error('REFERENCE_ADMISSION_DIGEST');
  const v = object(input, [
    'schemaVersion',
    'kind',
    'reviewer',
    'reviewedAt',
    'validUntil',
    'terms',
    'sources',
  ]);
  if (
    v.schemaVersion !== 1 ||
    v.kind !== 'TEST_SUBSTITUTE_REFERENCE' ||
    typeof v.reviewer !== 'string' ||
    !v.reviewer.trim() ||
    v.reviewer.length > 128 ||
    !Number.isSafeInteger(v.reviewedAt) ||
    !Number.isSafeInteger(v.validUntil) ||
    Number(v.reviewedAt) > now ||
    Number(v.reviewedAt) < 1 ||
    Number(v.validUntil) <= now ||
    !Array.isArray(v.terms) ||
    !Array.isArray(v.sources) ||
    v.sources.length !== 3
  )
    throw new Error('REFERENCE_ADMISSION');
  const terms = v.terms.map(
    (t) => object(t, ['identity', 'assetId', 'symbol', 'multiplier']) as unknown as ReferenceTerms,
  );
  createReferenceEngine(terms);
  v.sources.forEach((source, i) => {
    const s = object(source, [
      'symbol',
      'underlyingType',
      'exchange',
      'kind',
      'url',
      'sha256',
      'archiveFile',
    ]);
    if (
      s.symbol !== terms[i]!.symbol ||
      s.underlyingType !== 'COMMON_STOCK' ||
      !['NASDAQ', 'NYSE', 'NYSE_AMERICAN'].includes(String(s.exchange)) ||
      !['ISSUER', 'EXCHANGE'].includes(String(s.kind)) ||
      typeof s.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(s.sha256) ||
      typeof s.archiveFile !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(s.archiveFile)
    )
      throw new Error('REFERENCE_ADMISSION');
    const url = new URL(String(s.url));
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('REFERENCE_ADMISSION');
  });
  return Object.freeze(terms.map((t) => Object.freeze({ ...t })));
}
