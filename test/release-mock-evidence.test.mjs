import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeTap, acceptanceState } from '../tools/testing/alphaforge-release-mock/evidence.mjs';

test('evidence parser requires observed positive tests, complete TAP totals and exit zero', () => {
  const pass = '# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(summarizeTap(pass, 0), {
    tests: 3,
    pass: 3,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    eligible: true,
  });
  assert.equal(summarizeTap(pass, 1).eligible, false);
  assert.equal(
    summarizeTap('# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n', 0).eligible,
    false,
  );
  assert.equal(summarizeTap('# tests 3\n# pass 3\n# fail 0\n', 0).eligible, false);
  assert.equal(
    summarizeTap(pass.replace('# pass 3', '# pass 2').replace('# skipped 0', '# skipped 1'), 0).eligible,
    false,
  );
});

test('no dirty source, missing browser, failed phase or changed source can publish release PASS', () => {
  const input = {
    sourceEligible: true,
    sourceUnchanged: true,
    browserRun: true,
    phases: [{ exitCode: 0, eligible: true }],
  };
  assert.equal(acceptanceState(input), 'PASS');
  assert.equal(acceptanceState({ ...input, sourceEligible: false }), 'DIAGNOSTIC_ONLY');
  assert.equal(acceptanceState({ ...input, sourceUnchanged: false }), 'FAIL');
  assert.equal(acceptanceState({ ...input, browserRun: false }), 'NOT_RUN_BROWSER');
  assert.equal(acceptanceState({ ...input, phases: [{ exitCode: 1, eligible: false }] }), 'FAIL');
  assert.equal(acceptanceState({ ...input, phases: [] }), 'FAIL');
});
