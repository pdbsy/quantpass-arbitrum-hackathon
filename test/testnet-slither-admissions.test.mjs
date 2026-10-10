import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateSlitherAdmissions } from '../tools/ci/slither-review.mjs';

test('exact reviewed fixture retains raw findings and blocks missing approval, new severity, source or expired scope', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-slither-review-')));
  try {
    mkdirSync(join(root, 'contracts/src'), { recursive: true });
    const file = join(root, 'contracts/src/Fixture.sol'),
      source = 'function test_attack() {}\n';
    writeFileSync(file, source);
    const finding = {
      id: 'a'.repeat(64),
      check: 'timestamp',
      impact: 'Low',
      confidence: 'Medium',
      elements: [
        {
          type: 'function',
          name: 'execute',
          type_specific_fields: { parent: { name: 'Fixture' } },
          source_mapping: { filename_relative: 'src/Fixture.sol' },
        },
      ],
    };
    const report = { success: true, error: null, results: { detectors: [finding] } };
    const entry = {
      id: finding.id,
      check: finding.check,
      impact: finding.impact,
      confidence: finding.confidence,
      function: 'Fixture.execute',
      reviewState: 'APPROVED_BY_USER',
      rationale: 'Fixture only; this is not an actual approval.',
      evidence: ['contracts/src/Fixture.sol#test_attack'],
    };
    const review = {
      schemaVersion: 1,
      slitherVersion: '0.11.3',
      expiresAt: '2026-11-01T00:00:00Z',
      approvalRef: 'docs/specs/AF-TESTNET-SLITHER-REVIEW.md',
      sourceHashes: [
        { path: 'contracts/src/Fixture.sol', sha256: createHash('sha256').update(source).digest('hex') },
      ],
      findings: [entry],
    };
    const before = JSON.stringify(report),
      clock = Date.parse('2026-10-02T00:00:00Z');
    assert.equal(evaluateSlitherAdmissions(report, review, root, clock).admitted, 1);
    assert.equal(JSON.stringify(report), before);
    for (const mutation of [
      { ...review, expiresAt: '2026-09-01T00:00:00Z' },
      { ...review, findings: [{ ...entry, reviewState: 'PENDING_USER' }] },
      { ...review, findings: [{ ...entry, evidence: ['contracts/src/Fixture.sol#unknown_test'] }] },
    ])
      assert.throws(() => evaluateSlitherAdmissions(report, mutation, root, clock));
    assert.throws(() =>
      evaluateSlitherAdmissions(
        { ...report, results: { detectors: [{ ...finding, impact: 'High' }] } },
        review,
        root,
        clock,
      ),
    );
    assert.throws(() =>
      evaluateSlitherAdmissions(
        { ...report, results: { detectors: [finding, { ...finding, id: 'b'.repeat(64) }] } },
        review,
        root,
        clock,
      ),
    );
    writeFileSync(file, 'changed');
    assert.throws(() => evaluateSlitherAdmissions(report, review, root, clock), /SLITHER_SOURCE_CHANGED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const scope = {
  chainId: 46630,
  environment: 'ONCHAIN_TESTNET',
  mainnetAuthorized: false,
  authorization: 'RESIDUAL_RISK_ACCEPTANCE_ONLY',
};
const clock = Date.parse('2026-10-10T00:00:00Z');

function scopedFixture(elementType, check, run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'alphaforge-scoped-slither-')));
  try {
    mkdirSync(join(root, 'contracts/src'), { recursive: true });
    mkdirSync(join(root, 'contracts/test'), { recursive: true });
    const source = 'function test_attack() {}\n';
    writeFileSync(join(root, 'contracts/src/Fixture.sol'), source);
    const element = {
      type: elementType,
      name: elementType === 'contract' ? 'Fixture' : 'execute',
      type_specific_fields: { parent: { name: 'Fixture' } },
      source_mapping: { filename_relative: 'src/Fixture.sol' },
    };
    const finding = {
      id: 'a'.repeat(64),
      check,
      impact: 'Informational',
      confidence: 'High',
      elements: [element],
    };
    const report = { success: true, error: null, results: { detectors: [finding] } };
    const entry = {
      id: finding.id,
      check,
      impact: finding.impact,
      confidence: finding.confidence,
      function: elementType === 'contract' ? 'Fixture' : 'Fixture.execute',
      reviewState: 'APPROVED_BY_USER',
      rationale: 'Fixture only; not an actual user approval.',
      evidence: ['contracts/src/Fixture.sol#test_attack'],
      elementType,
    };
    const review = {
      schemaVersion: 2,
      slitherVersion: '0.11.3',
      expiresAt: '2026-11-01T00:00:00Z',
      approvalRef: 'docs/specs/AF-TESTNET-SLITHER-REVIEW.md',
      approvalScope: scope,
      findingSourcePaths: { [finding.id]: 'contracts/src/Fixture.sol' },
      sourceHashes: [
        {
          path: 'contracts/src/Fixture.sol',
          sha256: createHash('sha256').update(source).digest('hex'),
        },
      ],
      findings: [entry],
    };
    run({ root, report, review, entry, element, finding });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('v2 binds only chain 46630 residual-risk acceptance and never grants deployment authority', () => {
  scopedFixture('function', 'timestamp', ({ root, report, review }) => {
    const before = JSON.stringify(report);
    const result = evaluateSlitherAdmissions(report, review, root, clock, {
      chainId: 46630,
      environment: 'ONCHAIN_TESTNET',
    });
    assert.equal(result.admitted, 1);
    assert.equal(result.deploymentAuthorized, false);
    assert.deepEqual(result.approvalScope, scope);
    assert.equal(JSON.stringify(report), before);
    for (const approvalScope of [
      { ...scope, chainId: 1 },
      { ...scope, chainId: '46630' },
      { ...scope, environment: 'MAINNET' },
      { ...scope, mainnetAuthorized: true },
      { ...scope, authorization: 'DEPLOYMENT' },
      { ...scope, extraPermission: true },
      { chainId: 46630 },
      null,
    ])
      assert.throws(
        () => evaluateSlitherAdmissions(report, { ...review, approvalScope }, root, clock),
        /SLITHER_APPROVAL_SCOPE/,
      );
    const { approvalScope: omitted, ...missingScope } = review;
    assert.ok(omitted);
    assert.throws(() => evaluateSlitherAdmissions(report, missingScope, root, clock));
    for (const executionContext of [
      { chainId: 1, environment: 'ONCHAIN_TESTNET' },
      { chainId: 46630, environment: 'MAINNET' },
      { chainId: 46630, environment: 'ONCHAIN_TESTNET', extraPermission: true },
      null,
    ])
      assert.throws(
        () => evaluateSlitherAdmissions(report, review, root, clock, executionContext),
        /SLITHER_EXECUTION_SCOPE/,
      );
  });
});

test('v2 contract findings match exact contract type, identity, detector and source without a function fallback', () => {
  scopedFixture('contract', 'missing-inheritance', ({ root, report, review, entry, element, finding }) => {
    assert.equal(evaluateSlitherAdmissions(report, review, root, clock).admitted, 1);
    for (const mutatedEntry of [
      { ...entry, function: 'OtherContract' },
      { ...entry, elementType: 'function' },
      { ...entry, elementType: 'event' },
      { ...entry, elementType: null },
      { ...entry, check: 'timestamp' },
      { ...entry, reviewState: 'PENDING_USER' },
    ])
      assert.throws(() =>
        evaluateSlitherAdmissions(report, { ...review, findings: [mutatedEntry] }, root, clock),
      );
    for (const mutatedElement of [
      { ...element, name: 'OtherContract' },
      { ...element, type: 'function' },
      { ...element, source_mapping: { filename_relative: 'src/Other.sol' } },
    ])
      assert.throws(() =>
        evaluateSlitherAdmissions(
          { ...report, results: { detectors: [{ ...finding, elements: [mutatedElement] }] } },
          review,
          root,
          clock,
        ),
      );
    const { approvalScope: omitted, ...legacy } = review;
    assert.ok(omitted);
    assert.throws(() => evaluateSlitherAdmissions(report, { ...legacy, schemaVersion: 1 }, root, clock));
  });
});

test('v2 freezes the complete Solidity source and test set, including newly added files', () => {
  scopedFixture('function', 'timestamp', ({ root, report, review }) => {
    assert.equal(evaluateSlitherAdmissions(report, review, root, clock).admitted, 1);
    writeFileSync(join(root, 'contracts/test/NewTest.sol'), 'function test_other() {}\n');
    assert.throws(() => evaluateSlitherAdmissions(report, review, root, clock), /SLITHER_SOURCE_SET_CHANGED/);
  });
});

test('v2 rejects relabeling a finding to another file that is already reviewed and hash bound', () => {
  for (const [elementType, check] of [
    ['function', 'timestamp'],
    ['contract', 'missing-inheritance'],
  ])
    scopedFixture(elementType, check, ({ root, report, review, element, finding }) => {
      const otherSource = 'function test_other() {}\n';
      writeFileSync(join(root, 'contracts/src/Other.sol'), otherSource);
      const boundReview = {
        ...review,
        sourceHashes: [
          ...review.sourceHashes,
          {
            path: 'contracts/src/Other.sol',
            sha256: createHash('sha256').update(otherSource).digest('hex'),
          },
        ],
      };
      assert.equal(evaluateSlitherAdmissions(report, boundReview, root, clock).admitted, 1);
      assert.throws(
        () =>
          evaluateSlitherAdmissions(
            {
              ...report,
              results: {
                detectors: [
                  {
                    ...finding,
                    elements: [
                      {
                        ...element,
                        source_mapping: { filename_relative: 'src/Other.sol' },
                      },
                    ],
                  },
                ],
              },
            },
            boundReview,
            root,
            clock,
          ),
        /SLITHER_UNREVIEWED_FINDING/,
      );
      for (const findingSourcePaths of [
        {},
        { ...review.findingSourcePaths, ['b'.repeat(64)]: 'contracts/src/Other.sol' },
        { [finding.id]: 'contracts/src/NotReviewed.sol' },
      ])
        assert.throws(
          () => evaluateSlitherAdmissions(report, { ...boundReview, findingSourcePaths }, root, clock),
          /SLITHER_FINDING_SOURCE_BINDING/,
        );
    });
});
