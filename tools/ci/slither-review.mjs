import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
export function evaluateSlitherAdmissions(report, review, repository, now = Date.now()) {
  if (
    !exact(review, [
      'schemaVersion',
      'slitherVersion',
      'expiresAt',
      'approvalRef',
      'sourceHashes',
      'findings',
    ]) ||
    review.schemaVersion !== 1 ||
    review.slitherVersion !== '0.11.3' ||
    review.approvalRef !== 'docs/specs/AF-TESTNET-SLITHER-REVIEW.md' ||
    !Number.isFinite(Date.parse(review.expiresAt)) ||
    Date.parse(review.expiresAt) <= now ||
    !Array.isArray(review.sourceHashes) ||
    !review.sourceHashes.length
  )
    throw new Error('SLITHER_REVIEW_INVALID');
  if (
    !report ||
    report.success !== true ||
    report.error !== null ||
    !report.results ||
    !Array.isArray(report.results.detectors) ||
    !report.results.detectors.length ||
    !Array.isArray(review.findings) ||
    review.findings.length !== report.results.detectors.length
  )
    throw new Error('SLITHER_FINDINGS_CHANGED');
  const sources = new Set();
  for (const item of review.sourceHashes) {
    if (
      !exact(item, ['path', 'sha256']) ||
      typeof item.path !== 'string' ||
      !/^contracts\/(?:src|test)\/[a-zA-Z0-9_./-]+\.sol$/.test(item.path) ||
      sources.has(item.path) ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      throw new Error('SLITHER_SOURCE_INVALID');
    const file = resolve(repository, item.path),
      stat = lstatSync(file);
    if (
      realpathSync(file) !== file ||
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > 2 * 1024 * 1024 ||
      !file.startsWith(resolve(repository, 'contracts') + sep) ||
      createHash('sha256').update(readFileSync(file)).digest('hex') !== item.sha256
    )
      throw new Error('SLITHER_SOURCE_CHANGED');
    sources.add(item.path);
  }
  const accepted = new Map();
  for (const item of review.findings) {
    if (
      !exact(item, [
        'id',
        'check',
        'impact',
        'confidence',
        'function',
        'reviewState',
        'rationale',
        'evidence',
      ]) ||
      !/^[a-f0-9]{64}$/.test(item.id) ||
      accepted.has(item.id) ||
      item.reviewState !== 'APPROVED_BY_USER' ||
      typeof item.rationale !== 'string' ||
      !item.rationale.length ||
      item.rationale.length > 2000 ||
      !Array.isArray(item.evidence) ||
      !item.evidence.length
    )
      throw new Error('SLITHER_USER_APPROVAL_REQUIRED');
    for (const evidence of item.evidence) {
      if (typeof evidence !== 'string') throw new Error('SLITHER_EVIDENCE_INVALID');
      const split = evidence.split('#');
      if (
        split.length !== 2 ||
        !sources.has(split[0]) ||
        !/^[a-zA-Z0-9_]+$/.test(split[1]) ||
        !readFileSync(resolve(repository, split[0]), 'utf8').includes(`function ${split[1]}(`)
      )
        throw new Error('SLITHER_EVIDENCE_INVALID');
    }
    accepted.set(item.id, item);
  }
  const seen = new Set();
  for (const finding of report.results.detectors) {
    const entry = accepted.get(finding?.id);
    const first = finding?.elements?.find((item) => item.type === 'function');
    if (
      !entry ||
      seen.has(finding.id) ||
      ['check', 'impact', 'confidence'].some((key) => finding[key] !== entry[key]) ||
      !first ||
      `${first.type_specific_fields?.parent?.name}.${first.name}` !== entry.function ||
      !sources.has('contracts/' + first.source_mapping?.filename_relative)
    )
      throw new Error('SLITHER_UNREVIEWED_FINDING');
    seen.add(finding.id);
  }
  return {
    admitted: seen.size,
    reviewSha256: createHash('sha256').update(JSON.stringify(review)).digest('hex'),
  };
}
