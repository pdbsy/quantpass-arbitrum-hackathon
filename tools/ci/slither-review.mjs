import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
export function evaluateSlitherAdmissions(report, review, repository, now = Date.now(), executionContext) {
  const version = review?.schemaVersion;
  const keys = ['schemaVersion', 'slitherVersion', 'expiresAt', 'approvalRef', 'sourceHashes', 'findings'];
  if (version === 2) keys.push('approvalScope', 'findingSourcePaths');
  if (
    !exact(review, keys) ||
    ![1, 2].includes(version) ||
    review.slitherVersion !== '0.11.3' ||
    review.approvalRef !== 'docs/specs/AF-TESTNET-SLITHER-REVIEW.md' ||
    !Number.isFinite(Date.parse(review.expiresAt)) ||
    Date.parse(review.expiresAt) <= now ||
    !Array.isArray(review.sourceHashes) ||
    !review.sourceHashes.length
  )
    throw new Error('SLITHER_REVIEW_INVALID');
  // This qualifies static residual-risk acceptance, never a deployment grant.
  // Execution consumers must independently authorize the operation and supply
  // the actual observed chain/environment, rather than trust the review label.
  const scope = {
    chainId: 46630,
    environment: 'ONCHAIN_TESTNET',
    mainnetAuthorized: false,
    authorization: 'RESIDUAL_RISK_ACCEPTANCE_ONLY',
  };
  if (
    version === 2 &&
    (!exact(review.approvalScope, Object.keys(scope)) ||
      Object.keys(scope).some((key) => review.approvalScope[key] !== scope[key]))
  )
    throw new Error('SLITHER_APPROVAL_SCOPE');
  if (
    executionContext !== undefined &&
    (version !== 2 ||
      !exact(executionContext, ['chainId', 'environment']) ||
      executionContext.chainId !== scope.chainId ||
      executionContext.environment !== scope.environment)
  )
    throw new Error('SLITHER_EXECUTION_SCOPE');
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
  if (version === 2) {
    const currentSources = new Set();
    const collect = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = resolve(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error('SLITHER_SOURCE_INVALID');
        if (entry.isDirectory()) collect(file);
        else if (entry.isFile() && entry.name.endsWith('.sol'))
          currentSources.add(relative(repository, file).split(sep).join('/'));
      }
    };
    for (const name of ['contracts/src', 'contracts/test']) {
      const directory = resolve(repository, name);
      if (lstatSync(directory).isSymbolicLink()) throw new Error('SLITHER_SOURCE_INVALID');
      collect(directory);
    }
    if (currentSources.size !== sources.size || [...currentSources].some((name) => !sources.has(name)))
      throw new Error('SLITHER_SOURCE_SET_CHANGED');
  }
  const accepted = new Map();
  for (const item of review.findings) {
    const entryKeys = [
      'id',
      'check',
      'impact',
      'confidence',
      'function',
      'reviewState',
      'rationale',
      'evidence',
    ];
    if (version === 2 && Object.hasOwn(item ?? {}, 'elementType')) entryKeys.push('elementType');
    if (
      !exact(item, entryKeys) ||
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
    const elementType = Object.hasOwn(item, 'elementType') ? item.elementType : 'function';
    if (
      !['function', 'contract'].includes(elementType) ||
      (elementType === 'contract' && item.check !== 'missing-inheritance')
    )
      throw new Error('SLITHER_UNREVIEWED_FINDING');
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
  if (
    version === 2 &&
    (!exact(review.findingSourcePaths, [...accepted.keys()]) ||
      Object.values(review.findingSourcePaths).some((path) => typeof path !== 'string' || !sources.has(path)))
  )
    throw new Error('SLITHER_FINDING_SOURCE_BINDING');
  const seen = new Set();
  for (const finding of report.results.detectors) {
    const entry = accepted.get(finding?.id);
    const elementType = entry && Object.hasOwn(entry, 'elementType') ? entry.elementType : 'function';
    const first = finding?.elements?.find((item) => item.type === elementType);
    const identity =
      elementType === 'function'
        ? `${first?.type_specific_fields?.parent?.name}.${first?.name}`
        : first?.name;
    const sourcePath = 'contracts/' + first?.source_mapping?.filename_relative;
    if (
      !entry ||
      seen.has(finding.id) ||
      ['check', 'impact', 'confidence'].some((key) => finding[key] !== entry[key]) ||
      !first ||
      identity !== entry.function ||
      !sources.has(sourcePath) ||
      (version === 2 && review.findingSourcePaths[finding.id] !== sourcePath)
    )
      throw new Error('SLITHER_UNREVIEWED_FINDING');
    seen.add(finding.id);
  }
  return {
    admitted: seen.size,
    reviewSha256: createHash('sha256').update(JSON.stringify(review)).digest('hex'),
    ...(version === 2 ? { approvalScope: scope, deploymentAuthorized: false } : {}),
  };
}
