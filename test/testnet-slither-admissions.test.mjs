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
