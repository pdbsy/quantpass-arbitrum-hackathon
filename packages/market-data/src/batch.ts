import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { captureReference, replayReference } from './capture.ts';
import type { ReadTransport, ReferenceCapture } from './capture.ts';
import { requireValue, validateSelection } from './robinhood.ts';
import type { ReferenceObservation, Selection } from './robinhood.ts';
export interface BatchPolicy {
  selections: Selection[];
  maxAgeMs: number;
  maxQuoteSkewMs: number;
  maxCaptureSpanMs: number;
}
export interface ReferenceBatch {
  version: 'alphaforge-reference-batch-1';
  policy: BatchPolicy;
  startedAt: number;
  completedAt: number;
  status: 'ACCEPTED' | 'REJECTED';
  reason: string | null;
  captures: ReferenceCapture[];
  observations: ReferenceObservation[] | null;
}
export function exactFields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  requireValue(input !== null && typeof input === 'object' && !Array.isArray(input), 'INVALID_BATCH_CONFIG');
  requireValue(
    Object.keys(input).length === keys.length && keys.every((key) => Object.hasOwn(input, key)),
    'INVALID_BATCH_CONFIG',
  );
  return input as Record<string, unknown>;
}
export function batchInteger(input: unknown, allowZero = false): number {
  requireValue(
    typeof input === 'number' && Number.isSafeInteger(input) && input >= (allowZero ? 0 : 1),
    'INVALID_BATCH_POLICY',
  );
  return input;
}
export function parseBatchPolicy(input: unknown): BatchPolicy {
  const row = exactFields(input, ['selections', 'maxAgeMs', 'maxQuoteSkewMs', 'maxCaptureSpanMs']);
  requireValue(
    Array.isArray(row.selections) && row.selections.length >= 1 && row.selections.length <= 3,
    'INVALID_BATCH_SELECTIONS',
  );
  const selections = row.selections.map((item: unknown) => {
    const s = exactFields(item, ['chainId', 'contractAddress', 'symbol']);
    return validateSelection(s as unknown as Selection);
  });
  requireValue(
    new Set(selections.map((s) => s.chainId + ':' + s.contractAddress)).size === selections.length,
    'DUPLICATE_BATCH_IDENTITY',
  );
  requireValue(new Set(selections.map((s) => s.symbol)).size === selections.length, 'DUPLICATE_BATCH_SYMBOL');
  requireValue(new Set(selections.map((s) => s.chainId)).size === 1, 'MIXED_BATCH_SOURCE_CHAINS');
  const maxCaptureSpanMs = batchInteger(row.maxCaptureSpanMs);
  requireValue(maxCaptureSpanMs <= 2147483647, 'INVALID_BATCH_CAPTURE_SPAN');
  return {
    selections,
    maxAgeMs: batchInteger(row.maxAgeMs),
    maxQuoteSkewMs: batchInteger(row.maxQuoteSkewMs, true),
    maxCaptureSpanMs,
  };
}
function timestamp(value: unknown): asserts value is number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'INVALID_BATCH_CLOCK');
}
function inspect(batch: ReferenceBatch): BatchPolicy {
  requireValue(batch?.version === 'alphaforge-reference-batch-1', 'INVALID_BATCH_VERSION');
  const policy = parseBatchPolicy(batch.policy);
  timestamp(batch.startedAt);
  timestamp(batch.completedAt);
  requireValue(
    Array.isArray(batch.captures) && batch.captures.length <= policy.selections.length,
    'INVALID_BATCH_MEMBERS',
  );
  for (let i = 0; i < batch.captures.length; i++) {
    const c = batch.captures[i]!;
    requireValue(
      c?.version === 'alphaforge-reference-1' &&
        isDeepStrictEqual(c.selection, policy.selections[i]) &&
        c.maxAgeMs === policy.maxAgeMs,
      'BATCH_MEMBER_IDENTITY',
    );
    requireValue(c.status === 'ACCEPTED' || c.status === 'REJECTED', 'INVALID_BATCH_MEMBER_STATUS');
    requireValue(Array.isArray(c.sources) && c.sources.length <= 3, 'INVALID_CAPTURE_SOURCES');
    const urls = [
      'https://api.robinhood.com/rhj/assets',
      'https://api.robinhood.com/rhj/prices/' + c.selection.symbol,
      'https://api.robinhood.com/rhj/assets',
    ];
    for (let j = 0; j < c.sources.length; j++) {
      const s = c.sources[j]!;
      requireValue(s && s.url === urls[j], 'SOURCE_IDENTITY_MISMATCH');
      requireValue(
        typeof s.body === 'string' &&
          Buffer.byteLength(s.body) <= 4 * 1024 * 1024 &&
          createHash('sha256').update(s.body).digest('hex') === s.sha256,
        'SOURCE_INTEGRITY_FAILED',
      );
      timestamp(s.receivedAt);
    }
    if (c.status === 'ACCEPTED') replayReference(c);
    else
      requireValue(
        c.observation === null && typeof c.reason === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(c.reason),
        'INVALID_REJECTED_CAPTURE',
      );
  }
  return policy;
}
function derive(batch: ReferenceBatch): ReferenceObservation[] {
  const policy = inspect(batch);
  requireValue(
    batch.completedAt >= batch.startedAt &&
      batch.captures.every((c) =>
        c.sources.every((s) => s.receivedAt >= batch.startedAt && s.receivedAt <= batch.completedAt),
      ),
    'BATCH_CLOCK_REGRESSION',
  );
  requireValue(batch.completedAt - batch.startedAt <= policy.maxCaptureSpanMs, 'BATCH_CAPTURE_SPAN');
  requireValue(
    batch.captures.length === policy.selections.length &&
      batch.captures.every((c) => c.status === 'ACCEPTED'),
    'BATCH_MEMBER_REJECTED',
  );
  const observations = batch.captures.map(replayReference);
  requireValue(
    observations.every(
      (o) => o.generatedAt <= batch.completedAt && batch.completedAt - o.generatedAt <= policy.maxAgeMs,
    ),
    'BATCH_STALE_OR_FUTURE_QUOTE',
  );
  const times = observations.map((o) => o.generatedAt);
  requireValue(Math.max(...times) - Math.min(...times) <= policy.maxQuoteSkewMs, 'BATCH_QUOTE_SKEW');
  return observations;
}
/** Recomputes a complete reference batch. No whitelist or execution authority is inferred. */
export function replayReferenceBatch(batch: ReferenceBatch): ReferenceObservation[] {
  requireValue(batch?.status === 'ACCEPTED' && batch.reason === null, 'BATCH_NOT_ACCEPTED');
  const observations = derive(batch);
  requireValue(isDeepStrictEqual(observations, batch.observations), 'BATCH_OBSERVATION_MISMATCH');
  return observations;
}
export function validateReferenceBatch(batch: ReferenceBatch): void {
  if (batch?.status === 'ACCEPTED') {
    replayReferenceBatch(batch);
    return;
  }
  inspect(batch);
  requireValue(
    batch.status === 'REJECTED' &&
      batch.observations === null &&
      typeof batch.reason === 'string' &&
      /^[A-Z][A-Z0-9_]{1,80}$/.test(batch.reason),
    'INVALID_REJECTED_BATCH',
  );
}
export async function captureReferenceBatch(
  input: unknown,
  transport: ReadTransport = fetch,
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<ReferenceBatch> {
  const policy = parseBatchPolicy(input);
  const startedAt = now();
  timestamp(startedAt);
  const batch: ReferenceBatch = {
    version: 'alphaforge-reference-batch-1',
    policy,
    startedAt,
    completedAt: startedAt,
    status: 'REJECTED',
    reason: null,
    captures: [],
    observations: null,
  };
  if (signal?.aborted) return { ...batch, reason: 'BATCH_ABORTED' };
  const timeout = new AbortController(),
    denied = new AbortController();
  const timer = setTimeout(() => timeout.abort(), policy.maxCaptureSpanMs);
  const captureSignal = AbortSignal.any([timeout.signal, denied.signal, ...(signal ? [signal] : [])]);
  try {
    batch.captures = await Promise.all(
      policy.selections.map(async (selection) => {
        const captured = await captureReference(selection, policy.maxAgeMs, transport, now, captureSignal);
        if (captured.reason === 'HTTP_ACCESS_DENIED') denied.abort();
        return captured;
      }),
    );
  } finally {
    clearTimeout(timer);
  }
  batch.completedAt = now();
  timestamp(batch.completedAt);
  if (signal?.aborted) batch.reason = 'BATCH_ABORTED';
  else if (denied.signal.aborted) batch.reason = 'HTTP_ACCESS_DENIED';
  else if (timeout.signal.aborted) batch.reason = 'BATCH_TIMEOUT';
  else {
    try {
      batch.observations = derive(batch);
      batch.status = 'ACCEPTED';
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      batch.reason = /^[A-Z][A-Z0-9_]{1,80}$/.test(message) ? message : 'BATCH_FAILED';
    }
  }
  return batch;
}
