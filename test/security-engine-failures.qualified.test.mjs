import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { installScanner, selectPlatform, verifyBytes } from '../tools/security/bootstrap.mjs';
import { verifyRuleFixtures } from '../tools/ci/check-semgrep.mjs';

const root = resolve(import.meta.dirname, '..');

test('qualified Semgrep detects missing positives and contaminated negatives with its real engine', async (t) => {
  const lock = JSON.parse(readFileSync(join(root, 'planning/security-scanners.lock.json')));
  const platform = selectPlatform(process.platform, process.arch);
  const selected = lock.semgrep.platforms[platform];
  // This is an explicit native qualification command. Missing cached prerequisites
  // fail before bootstrap; this test never starts an implicit artifact download.
  for (const name of selected.wheelFiles) {
    const path = join(root, '.checks/security-scanners/downloads', name);
    assert.ok(existsSync(path), 'qualified scanner wheel cache is required');
    verifyBytes(readFileSync(path), lock.semgrep.wheels[name].sha256);
  }
  const tool = await installScanner('semgrep');
  t.after(() => tool.cleanup());
  const config = join(root, 'tools/security/semgrep.yml');
  const original = JSON.parse(readFileSync(join(root, 'tools/security/rule-fixtures.json')));
  const attempt = (name, fixtures) => {
    const directory = join(tool.directory, name);
    mkdirSync(directory);
    return () => verifyRuleFixtures({ ...tool, directory }, config, JSON.stringify(fixtures));
  };
  assert.deepEqual(attempt('control', original)(), { rules: 22, fixtures: 44 });
  assert.throws(attempt('missing-rule', original.slice(1)), /fixture coverage mismatch/);
  const invalidLanguage = structuredClone(original);
  invalidLanguage[0].language = 'unqualified-language';
  assert.throws(attempt('invalid-language', invalidLanguage), /Invalid Semgrep fixture/);
  const missingPositives = original.map((row) => ({ ...row, bad: row.good }));
  assert.throws(attempt('missing-positives', missingPositives), /did not detect rule canaries completely/);
  const contaminatedNegative = structuredClone(original);
  contaminatedNegative[0].good = contaminatedNegative[0].bad;
  assert.throws(attempt('contaminated-negative', contaminatedNegative), /positive\/negative rule regression/);
});
